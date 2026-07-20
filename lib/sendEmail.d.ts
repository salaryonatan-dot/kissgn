// Type declarations for the runtime module lib/sendEmail.js (nodemailer wrapper).
// sendEmail resolves to the sent message id; sendAlertDigest returns null when
// there are no alerts, otherwise the same { messageId } shape.

/** Minimal alert shape sendAlertDigest reads when rendering the digest. */
export interface DigestAlertLike {
  severity: string;
  title: string;
  message: string;
}

export function sendEmail(to: string, subject: string, html: string): Promise<{ messageId: string }>;
export function sendAlertDigest(
  to: string,
  bizName: string,
  alerts: DigestAlertLike[]
): Promise<{ messageId: string } | null>;
