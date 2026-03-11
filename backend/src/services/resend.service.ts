// ── Resend Email Service ────────────────────────────────────────
// Sends team invitation emails via Resend (replacing Clerk's default emails).

import { Resend } from 'resend';
import { config } from '../config/env.js';

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!config.resendApiKey) return null;
  if (!resend) resend = new Resend(config.resendApiKey);
  return resend;
}

export async function sendInviteEmail(params: {
  to: string;
  orgName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresInDays?: number;
}): Promise<{ success: boolean; error?: string }> {
  const client = getResend();
  if (!client) {
    return { success: false, error: 'Resend not configured' };
  }

  const { to, orgName, inviterName, role, acceptUrl, expiresInDays = 7 } = params;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation to join ${orgName}</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
  <div style="max-width:480px;margin:32px auto;padding:32px;background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111;">You're invited to ${orgName}</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.6;">
      ${inviterName} has invited you to join <strong>${orgName}</strong> on Havoc as <strong>${role}</strong>.
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.6;">
      Click the button below to accept the invitation and get started.
    </p>
    <a href="${acceptUrl}" style="display:inline-block;padding:12px 24px;background:#111;color:white;text-decoration:none;font-size:14px;font-weight:500;border-radius:8px;">
      Accept Invitation
    </a>
    <p style="margin:24px 0 0;font-size:12px;color:#888;">
      This invitation expires in ${expiresInDays} days. If you didn't expect this invitation, you can safely ignore this email.
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#888;">
      — Havoc Team
    </p>
  </div>
</body>
</html>
  `.trim();

  try {
    const result = await client.emails.send({
      from: config.resendFromEmail,
      to: [to],
      subject: `${inviterName} invited you to ${orgName} on Havoc`,
      html,
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to send email' };
  }
}

export function isResendConfigured(): boolean {
  return !!config.resendApiKey;
}
