import { env } from '../../config/env';

// The ONLY file that knows how to talk to Brevo (https://developers.brevo.com).
// Uses Node's built-in fetch against their transactional REST endpoint — the
// official SDK adds nothing we need. Swapping providers later means replacing
// this file, nothing else.

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

export interface SendEmailInput {
  to: { email: string; name?: string };
  subject: string;
  html: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(env.BREVO_API_KEY);
}

// Throws on failure — the caller decides whether that's fatal (it never is
// for auth flows; see email.service.ts).
export async function sendViaBrevo(input: SendEmailInput): Promise<void> {
  if (!env.BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not configured');
  }

  const res = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: env.EMAIL_FROM_ADDRESS, name: env.EMAIL_FROM_NAME },
      to: [input.to],
      subject: input.subject,
      htmlContent: input.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Brevo responded ${res.status}: ${body.slice(0, 500)}`);
  }
}
