// Type declarations for the runtime module lib/sendEmail.js (nodemailer wrapper).
// sendEmail resolves to the sent message id; sendAlertDigest returns null when
// there are no alerts, otherwise the same { messageId } shape.

/** Minimal alert shape sendAlertDigest reads when rendering the digest. */
export interface DigestAlertLike {
  severity: string;
  title: string;
  message: string;
}

/** Bounded SMTP session timeouts passed to nodemailer (ms). */
export const SMTP_TIMEOUTS: Readonly<{ connectionTimeout: number; greetingTimeout: number; socketTimeout: number; dnsTimeout: number }>;
/** Backstop deadline for one provider call (ms); its outcome is then unknown. */
export const SEND_DEADLINE_MS: number;

export function sendEmail(to: string, subject: string, html: string): Promise<{ messageId: string }>;
export function sendAlertDigest(
  to: string,
  bizName: string,
  alerts: DigestAlertLike[]
): Promise<{ messageId: string } | null>;
