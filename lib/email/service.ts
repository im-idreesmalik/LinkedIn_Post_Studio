/**
 * Email delivery over SMTP (Nodemailer). No paid email provider.
 * Synchronous result only: we record `sent` (accepted) or `failed`.
 */
import nodemailer from "nodemailer";
import { render } from "@react-email/render";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { DailyDigest, type DailyDigestProps } from "./templates/daily-digest";

let transport: nodemailer.Transporter | null = null;
function getTransport() {
  if (!transport) {
    if (!env.SMTP_URL) {
      throw new Error("SMTP_URL is not configured — cannot send email.");
    }
    transport = nodemailer.createTransport(env.SMTP_URL);
  }
  return transport;
}

export interface SendResult {
  messageId: string;
  accepted: boolean;
}

export async function sendDailyDigest(
  to: string,
  props: DailyDigestProps,
): Promise<SendResult> {
  const html = await render(DailyDigest(props));
  const info = await getTransport().sendMail({
    from: env.EMAIL_FROM,
    to,
    subject: "✅ Today's LinkedIn post is ready to review",
    html,
    headers: { "List-Unsubscribe": `<${env.APP_URL}/settings>` },
  });
  const accepted = (info.accepted?.length ?? 0) > 0;
  log.info("email.sent", { to, accepted, messageId: info.messageId });
  return { messageId: info.messageId, accepted };
}
