import { NextRequest, NextResponse } from "next/server";
import { contactSchema } from "@/lib/validation/schemas";
import { checkRateLimit } from "@/lib/rateLimit";
import { getClientIp } from "@/lib/request";
import { getMailer } from "@/lib/mail/mailer";
import { getEnv } from "@/lib/env";

const CONTACT_LIMIT_PER_HOUR = 5;

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = await checkRateLimit(`contact:${ip}`, CONTACT_LIMIT_PER_HOUR, 60 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many messages sent. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { name, email, subject, message } = parsed.data;
  const env = getEnv();
  const supportInbox = env.SUPPORT_EMAIL ?? env.SMTP_USER;

  if (!supportInbox) {
    return NextResponse.json(
      { error: "The contact form isn't configured yet. Please try again later." },
      { status: 503 },
    );
  }

  await getMailer().send({
    to: supportInbox,
    replyTo: email,
    subject: `[HelixQL Contact] ${subject}`,
    text: `From: ${name} <${email}>\n\n${message}`,
    html: `
      <p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>
      <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
    `,
  });

  return NextResponse.json({ message: "Thanks — we'll get back to you soon." });
}
