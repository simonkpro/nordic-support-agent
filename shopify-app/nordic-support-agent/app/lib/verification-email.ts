import type { EmailSender } from '@nordic-support/agent';
import { ConsoleEmailSender } from '@nordic-support/agent';

/**
 * Sends the customer identity-verification code (the 6-digit code the widget
 * asks for before releasing order PII at verification tier 2).
 *
 * Production uses Resend (same creds as the handoff sender). When
 * RESEND_API_KEY / RESEND_FROM_ADDRESS are unset — dev/preview — we fall
 * back to ConsoleEmailSender so the code prints to the terminal. NOTE: the
 * fallback logs the code, so tier-2 verification must only be relied upon in
 * an environment where Resend is actually configured.
 */
class ResendVerificationEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendVerificationCode(email: string, code: string): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [email],
        subject: `Din verifieringskod: ${code}`,
        text: [
          `Din verifieringskod är: ${code}`,
          ``,
          `Ange koden i chatten inom 10 minuter för att verifiera din identitet.`,
          ``,
          `Om du inte bad om den här koden kan du ignorera det här meddelandet.`,
        ].join('\n'),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Surface server-side; the tool turns any throw into a generic
      // "couldn't send the code" for the customer.
      throw new Error(`resend ${res.status}: ${body.slice(0, 300)}`);
    }
  }
}

let cached: EmailSender | null = null;

export function getVerificationEmailSender(): EmailSender {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_ADDRESS;
  cached = apiKey && from
    ? new ResendVerificationEmailSender(apiKey, from)
    : new ConsoleEmailSender();
  return cached;
}
