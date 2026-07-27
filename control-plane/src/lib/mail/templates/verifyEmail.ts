export function verifyEmailTemplate(params: { name: string; verifyUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const { name, verifyUrl } = params;
  const subject = "Verify your HelixQL account";
  const text = `Hi ${name},\n\nConfirm your HelixQL account by visiting the link below. This link expires in 24 hours.\n\n${verifyUrl}\n\nIf you didn't create a HelixQL account, you can ignore this email.`;
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #0f172a;">
      <h2 style="color:#0d9488;">Confirm your HelixQL account</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Click the button below to verify your email address. This link expires in 24 hours.</p>
      <p style="text-align:center; margin: 32px 0;">
        <a href="${verifyUrl}" style="background:#0d9488; color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:600;">
          Verify Email
        </a>
      </p>
      <p style="font-size: 13px; color: #64748b;">If the button doesn't work, copy and paste this link into your browser:<br/>${escapeHtml(verifyUrl)}</p>
      <p style="font-size: 13px; color: #64748b;">If you didn't create a HelixQL account, you can safely ignore this email.</p>
    </div>
  `;
  return { subject, html, text };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
