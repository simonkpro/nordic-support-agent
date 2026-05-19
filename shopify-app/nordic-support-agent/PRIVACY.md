# Privacy & data handling

This document describes what data the Nordic Support Agent collects, how
long we keep it, which subprocessors touch it, and how customers and
merchants exercise GDPR rights. It is intended for both legal review and
day-to-day operational reference.

## Who is who

The merchant (the Shopify store running the widget) is the **data
controller**. We operate the platform as a **data processor** on the
merchant's behalf. A Data Processing Agreement is signed per merchant.

## What we collect

| Surface | Data | Why |
| --- | --- | --- |
| Chat messages | Free-text typed by the customer + the agent's replies | Required to answer the question |
| Conversation metadata | Shop, language, country, timestamps | Routing, retention, debugging |
| Verified email (optional, opt-in per assistant) | Email address + short-TTL one-time code | Identity verification before revealing PII or performing mutations |
| Token-spend ledger | Per-shop daily LLM token totals | Cost guardrails |
| DSAR audit | Email, request kind, timestamps | Compliance evidence and one-shot guard on magic links |

We do **not** collect: IP address (beyond the in-memory rate-limit
bucket), browser fingerprint, cookies, page URL, referrer, or
cross-domain identifiers.

## Retention windows

- **Conversations**: 24 hours from last activity. A daily cron job
  hard-deletes expired rows.
- **Verification codes**: 10 minutes, then purged. Codes are stored
  hashed.
- **DSAR audit rows**: kept indefinitely for compliance evidence; they
  contain no message content.
- **Shop daily usage**: kept indefinitely for billing reconciliation;
  no PII.

## Subprocessors

| Vendor | Role | Region | Data shared |
| --- | --- | --- | --- |
| Anthropic (via Vercel AI Gateway) | LLM inference | EU routing where possible; ZDR enabled | Conversation messages and tool outputs at inference time |
| Cohere | Multilingual embeddings (RAG) | EU | Knowledge-base text chunks at index time |
| Neon | Postgres database | EU | All collected data above |
| Resend | Transactional email (handoffs, DSAR magic links) | EU/US (configured per env) | Recipient email, subject, body |
| Cloudflare | Turnstile bot defence on public token endpoint | Global edge | Coarse signal only; no PII |
| Vercel | Hosting | EU regions | All HTTP traffic |

The Vercel AI Gateway is configured with **zero data retention**: prompt
and completion bodies are not stored at the provider after the request
finishes.

## Customer rights (GDPR)

Customers exercise rights via the self-service link in the widget
footer (`Privacy & data`). The flow:

1. Customer enters their email and selects **Export** or **Erase**.
2. We email a single-use, HMAC-signed link valid for 24 hours.
3. Clicking the link performs the action and marks the request
   complete. A leaked link cannot be reused after completion.

**Export** returns a JSON file with all conversations the customer's
verified email is attached to. **Erase** hard-deletes the same set,
plus any outstanding verification codes for that email.

Customers who chatted anonymously (without verifying an email) are not
linked to an identifiable person from our side; their data is purged on
the 24-hour rolling window and is out of scope for DSAR by design.

## Merchant rights

Merchants can revoke all outstanding widget tokens for an assistant
(epoch bump), toggle the public-token endpoint off (`published` flag),
or restrict it to specific origins (`allowedOrigins`). On uninstall,
the cleanup webhook removes the shop's assistants, knowledge, and
conversations.

## Logging

Success-path conversation bodies are **never** logged. Error-path logs
route through `app/lib/redact.ts`, which scrubs emails, Swedish
personnummer, phone-like numbers, and Luhn-valid card-like digit runs
before emit.

## Security overview

- Widget tokens are HMAC-SHA256 signed; secret is 32+ char env var.
- Public-token endpoint is rate-limited per IP and gated by Cloudflare
  Turnstile (invisible).
- Origin allowlist supported per assistant; empty list = no
  restriction.
- Per-shop daily LLM token cap (default 200k) returns 503 when
  exceeded.
- Shadow DOM widget isolates merchant-site CSS from widget DOM and vice
  versa.

## Contact

For any privacy question, write to **simon@bakersfield.ae**.
