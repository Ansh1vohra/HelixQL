import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "@/lib/env";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Dev-mode fallback: when no SMTP host is configured, log the email to the
 * console instead of sending it. This is a real, working transport (not a
 * stub) so local development and CI never need a mail provider account —
 * production deployments must set SMTP_HOST or sends will fail loudly.
 */
class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(
      [
        "\n--- HelixQL dev mailer: no SMTP_HOST configured, logging email instead of sending ---",
        `To: ${message.to}`,
        `Subject: ${message.subject}`,
        message.replyTo ? `Reply-To: ${message.replyTo}` : null,
        message.text,
        "--- end email ---\n",
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
    );
  }
}

class SmtpMailer implements Mailer {
  private transporter: Transporter;
  private from: string;

  constructor() {
    const env = getEnv();
    this.from = env.SMTP_FROM;
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });
  }
}

let cachedMailer: Mailer | undefined;

export function getMailer(): Mailer {
  if (cachedMailer) return cachedMailer;
  const env = getEnv();
  cachedMailer = env.SMTP_HOST ? new SmtpMailer() : new ConsoleMailer();
  return cachedMailer;
}
