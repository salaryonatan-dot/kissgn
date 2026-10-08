// DE1 R3 — the provider contract the resolved-result classifier relies on, observed on the REAL installed nodemailer (the
// adapter lib/sendEmail.js uses: one recipient, SMTP, not LMTP) against an in-process SMTP responder on 127.0.0.1 (no network,
// no provider, no e-mail leaves the process). It records which outcomes RESOLVE and which REJECT, and feeds each real result
// to the classifiers:
//   PC-01  RCPT 250 + end-of-DATA 250 → RESOLVES with accepted=[to], rejected=[], a 250 response, envelope.to=[to] → accepted
//   PC-02  RCPT 550 (the sole recipient refused) → REJECTS (EENVELOPE, RCPT TO, 550) before DATA → failed, final
//   PC-03  RCPT 250 + end-of-DATA 550 → REJECTS (EMESSAGE, DATA, 550) → failed, final
//   PC-04  RCPT 250 + end-of-DATA 421 → REJECTS (EMESSAGE, DATA, 421) → failed, retryable deferral
//   PC-05  consequently no real single-recipient SMTP result RESOLVES with the recipient in `rejected`: the reviewed shape
//          { rejected: [to], response: "250 …" } cannot come from this adapter, and is classified unknown (inconsistent)
// The test is skipped (not failed) when the sandbox forbids a localhost listener.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import nodemailer from "nodemailer";
import { classifyTransportInfo, classifyTransportError } from "../../lib/emailDelivery.js";

const TO = "owner@example.test";
function responder({ rcpt = "250 2.1.5 OK", dataEnd = "250 2.0.0 OK queued" } = {}) {
  const seen = [];
  const server = net.createServer((sock) => {
    let inData = false, buf = "";
    sock.write("220 localhost ESMTP test\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) { if (line === ".") { inData = false; seen.push("END"); sock.write(dataEnd + "\r\n"); } continue; }
        const cmd = line.split(" ")[0].toUpperCase();
        seen.push(cmd === "RCPT" || cmd === "MAIL" ? line.split(":")[0].toUpperCase() : cmd);
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250-localhost\r\n250 8BITMIME\r\n");
        else if (cmd === "MAIL") sock.write("250 2.1.0 OK\r\n");
        else if (cmd === "RCPT") sock.write(rcpt + "\r\n");
        else if (cmd === "DATA") { inData = true; sock.write("354 go ahead\r\n"); }
        else if (cmd === "QUIT") { sock.write("221 bye\r\n"); sock.end(); }
        else if (cmd === "RSET") sock.write("250 OK\r\n");
        else sock.write("502 unknown\r\n");
      }
    });
    sock.on("error", () => {});
  });
  return { server, seen };
}
async function listen(server) {
  return new Promise((resolve) => {
    server.once("error", (e) => resolve({ error: e }));
    server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port }));
  });
}
async function send(opts) {
  const { server, seen } = responder(opts);
  const l = await listen(server);
  if (l.error) return { skipped: String(l.error.code || l.error) };
  const transport = nodemailer.createTransport({ host: "127.0.0.1", port: l.port, secure: false, ignoreTLS: true, connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000 });
  try {
    const info = await transport.sendMail({ from: "Marjin <sender@example.test>", to: TO, subject: "s", html: "<p>x</p>", messageId: "<pc@delivery.marjin.app>" });
    return { info, seen };
  } catch (error) { return { error, seen }; }
  finally { transport.close(); server.close(); }
}
const probe = await send();
const SKIP = probe.skipped ? "localhost listener unavailable: " + probe.skipped : false;

test("PC-01 RCPT 250 + end-of-DATA 250 resolves with exactly the recipient accepted → accepted", { skip: SKIP }, async () => {
  const r = await send();
  assert.equal(r.error, undefined);
  assert.deepEqual([r.info.accepted, r.info.rejected, r.info.envelope.to], [[TO], [], [TO]]);
  assert.equal(r.info.rejectedErrors, undefined);
  assert.match(r.info.response, /^250 /);
  assert.deepEqual(r.seen.filter((x) => x === "END").length, 1, "DATA was sent once");
  assert.deepEqual(classifyTransportInfo(r.info, TO), { outcome: "accepted", responseCode: 250 });
});

test("PC-02 the sole RCPT refused (550) REJECTS before DATA → a definite, final refusal", { skip: SKIP }, async () => {
  const r = await send({ rcpt: "550 5.1.1 no such user" });
  assert.ok(r.error, "the promise rejects");
  assert.deepEqual([r.error.code, r.error.command, r.error.responseCode], ["EENVELOPE", "RCPT TO", 550]);
  assert.ok(!r.seen.includes("DATA"), "DATA is never sent when the sole recipient is refused");
  const c = classifyTransportError(r.error);
  assert.deepEqual([c.outcome, c.code, c.retryable], ["failed", "provider_rejected_550", false]);
});

test("PC-03 end-of-DATA 550 REJECTS (EMESSAGE / DATA) → a definite, final refusal", { skip: SKIP }, async () => {
  const r = await send({ dataEnd: "550 5.7.1 message refused" });
  assert.deepEqual([r.error?.code, r.error?.command, r.error?.responseCode], ["EMESSAGE", "DATA", 550]);
  assert.deepEqual([classifyTransportError(r.error).outcome, classifyTransportError(r.error).code], ["failed", "provider_rejected_550"]);
});

test("PC-04 end-of-DATA 421 REJECTS (EMESSAGE / DATA) → a retryable deferral", { skip: SKIP }, async () => {
  const r = await send({ dataEnd: "421 4.7.0 try later" });
  assert.deepEqual([r.error?.code, r.error?.command, r.error?.responseCode], ["EMESSAGE", "DATA", 421]);
  const c = classifyTransportError(r.error);
  assert.deepEqual([c.outcome, c.code, c.retryable, c.inRunRetry], ["failed", "provider_deferred_421", true, true]);
});

test("PC-05 no resolved single-recipient result lists the recipient as rejected; the reviewed shape is unknown", { skip: SKIP }, async () => {
  for (const opts of [{}, { rcpt: "550 5.1.1 no" }, { rcpt: "450 4.2.0 busy" }, { dataEnd: "550 5.7.1 no" }, { dataEnd: "451 4.3.0 later" }]) {
    const r = await send(opts);
    if (r.info) assert.deepEqual(r.info.rejected, [], "a RESOLVED result never lists the sole recipient as rejected: " + JSON.stringify(opts));
  }
  const reviewed = classifyTransportInfo({ accepted: [], rejected: [TO], response: "250 2.0.0 OK" }, TO);
  assert.deepEqual([reviewed.outcome, reviewed.code], ["unknown", "provider_result_inconsistent"]);
});
