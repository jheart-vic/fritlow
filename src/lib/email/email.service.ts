import { env } from '../../config/env';
import { isEmailConfigured, sendViaBrevo, type SendEmailInput } from './brevo.provider';

// The single entry point the rest of the app uses to send email. Rules:
//  - Email is best-effort: a failed send is logged, never thrown. Registration
//    or password reset must NEVER fail because the email provider is down.
//  - Without BREVO_API_KEY the send is skipped quietly (dev flows log tokens
//    to the console instead — see auth.service.ts).

export { isEmailConfigured };

async function sendSafely(input: SendEmailInput, kind: string): Promise<void> {
  if (!isEmailConfigured()) {
    console.warn(`[email] Skipped ${kind} to ${input.to.email} — BREVO_API_KEY not set`);
    return;
  }
  try {
    await sendViaBrevo(input);
    console.log(`[email] Sent ${kind} to ${input.to.email}`);
  } catch (err) {
    console.error(`[email] FAILED ${kind} to ${input.to.email}:`, err);
  }
}

// Shared shell so every email looks consistent. Inline styles only — email
// clients ignore <style> blocks and external CSS.
function layout(title: string, bodyHtml: string): string {
  return `
  <div style="background:#f4f5f7;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px">
      <h2 style="margin:0 0 16px;color:#111827;font-size:20px">${title}</h2>
      ${bodyHtml}
      <p style="margin:24px 0 0;color:#9ca3af;font-size:12px">
        Fritlow — from idea to launch. One workspace. One source of truth.
      </p>
    </div>
  </div>`;
}

function button(href: string, label: string): string {
  return `
  <p style="margin:24px 0">
    <a href="${href}" style="background:#111827;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-size:14px">${label}</a>
  </p>
  <p style="margin:0;color:#6b7280;font-size:13px">
    Or paste this link into your browser:<br>
    <a href="${href}" style="color:#2563eb;word-break:break-all">${href}</a>
  </p>`;
}

export async function sendVerificationEmail(
  to: { email: string; name?: string },
  token: string,
): Promise<void> {
  const link = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendSafely(
    {
      to,
      subject: 'Verify your email — Fritlow',
      html: layout(
        'Verify your email address',
        `<p style="margin:0;color:#374151;font-size:14px;line-height:1.6">
           Hi${to.name ? ` ${to.name}` : ''}, confirm this is your email address to finish setting up
           your Fritlow account. This link expires in 24 hours.
         </p>
         ${button(link, 'Verify email')}`,
      ),
    },
    'verification email',
  );
}

export async function sendWorkspaceInviteEmail(
  to: { email: string; name?: string },
  details: { workspaceName: string; inviterName?: string; role: string; token?: string },
): Promise<void> {
  // ONE landing page for every invitation, whether or not the recipient has an
  // account. The page reads the token via the public lookup endpoint and
  // decides what to show — sign in, sign up, accept, or "wrong account".
  //
  // Branching here instead would bake in whether they had an account at SEND
  // time, and that can change before they click: someone invited without an
  // account may well have signed up by the time they open the email.
  //
  // Legacy invites carry no token; they land on the in-app list instead.
  const link = details.token
    ? `${env.APP_URL}/invitations/${encodeURIComponent(details.token)}`
    : `${env.APP_URL}/invitations`;
  const inviter = details.inviterName ? `${details.inviterName} has invited you` : 'You have been invited';
  const roleLabel = details.role.toLowerCase();
  await sendSafely(
    {
      to,
      subject: `${details.inviterName ? `${details.inviterName} invited you` : "You're invited"} to ${details.workspaceName} — Fritlow`,
      html: layout(
        `Join ${details.workspaceName} on Fritlow`,
        `<p style="margin:0;color:#374151;font-size:14px;line-height:1.6">
           Hi${to.name ? ` ${to.name}` : ''}, ${inviter} to collaborate in the
           <strong>${details.workspaceName}</strong> workspace on Fritlow as a <strong>${roleLabel}</strong>.
           You'll get access to every project in that workspace once you accept.
         </p>
         ${button(link, 'View invitation')}`,
      ),
    },
    'workspace invite email',
  );
}

export async function sendWorkspaceSignupInviteEmail(
  to: { email: string },
  details: { workspaceName: string; inviterName?: string; role: string; token?: string },
): Promise<void> {
  // Same landing page as the has-an-account email — see the note there. The
  // page sends them on to register with this token, and registering through it
  // counts as accepting. (Registering WITHOUT the token leaves the invitation
  // pending: signing up is not by itself consent to join someone's workspace.)
  //
  // The old `/register?email=…&invitation=…` shape still works and still
  // auto-accepts, so invites already sitting in inboxes keep resolving.
  const link = details.token
    ? `${env.APP_URL}/invitations/${encodeURIComponent(details.token)}`
    : `${env.APP_URL}/register?email=${encodeURIComponent(to.email)}`;
  const inviter = details.inviterName ? `${details.inviterName} has invited you` : 'You have been invited';
  const roleLabel = details.role.toLowerCase();
  await sendSafely(
    {
      to,
      subject: `${details.inviterName ? `${details.inviterName} invited you` : 'You are invited'} to ${details.workspaceName} — Fritlow`,
      html: layout(
        `Join ${details.workspaceName} on Fritlow`,
        `<p style="margin:0;color:#374151;font-size:14px;line-height:1.6">
           ${inviter} to collaborate in the <strong>${details.workspaceName}</strong> workspace on
           Fritlow as a <strong>${roleLabel}</strong>. Create your free account with this email
           address to join — you'll get access to every project in that workspace.
         </p>
         ${button(link, 'View invitation')}`,
      ),
    },
    'workspace signup invite email',
  );
}

export async function sendPasswordResetEmail(
  to: { email: string; name?: string },
  token: string,
): Promise<void> {
  const link = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendSafely(
    {
      to,
      subject: 'Reset your password — Fritlow',
      html: layout(
        'Reset your password',
        `<p style="margin:0;color:#374151;font-size:14px;line-height:1.6">
           Hi${to.name ? ` ${to.name}` : ''}, we received a request to reset your Fritlow password.
           This link expires in 30 minutes. If you didn't ask for this, you can safely ignore this email.
         </p>
         ${button(link, 'Reset password')}`,
      ),
    },
    'password reset email',
  );
}
