import type { HandoffPayload, HandoffSender, HandoffSendResult } from '@nordic-support/agent';

/**
 * Plain-text email sender for escalation handoffs.
 *
 * Two implementations:
 *  - `ResendHandoffSender` — used in production when RESEND_API_KEY is set.
 *    The `from` address must be on a verified domain in Resend; we default
 *    to RESEND_FROM_ADDRESS env (e.g. "Support Bot <bot@yourdomain.tld>").
 *  - `ConsoleHandoffSender` — fallback for dev / preview. Logs the email
 *    to stdout so you can see exactly what would have been sent.
 *
 * `getHandoffSender()` picks one based on env so the route doesn't need
 * any conditionals.
 */

class ResendHandoffSender implements HandoffSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(payload: HandoffPayload): Promise<HandoffSendResult> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [payload.to],
          subject: payload.subject,
          text: payload.body,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: `resend ${res.status}: ${body.slice(0, 300)}` };
      }
      const data = (await res.json()) as { id?: string };
      return { ok: true, messageId: data.id };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

class ConsoleHandoffSender implements HandoffSender {
  async send(payload: HandoffPayload): Promise<HandoffSendResult> {
    const banner = '─'.repeat(60);
    console.log(
      `\n${banner}\n[handoff] (dev, no RESEND_API_KEY)\nTo:      ${payload.to}\nSubject: ${payload.subject}\n${banner}\n${payload.body}\n${banner}\n`,
    );
    return { ok: true, messageId: `console_${Date.now()}` };
  }
}

let cached: HandoffSender | null = null;
export function getHandoffSender(): HandoffSender {
  if (cached) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_ADDRESS;
  if (apiKey && from) {
    cached = new ResendHandoffSender(apiKey, from);
  } else {
    cached = new ConsoleHandoffSender();
  }
  return cached;
}
