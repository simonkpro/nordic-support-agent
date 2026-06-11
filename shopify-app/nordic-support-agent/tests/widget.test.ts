// @vitest-environment happy-dom
//
// Boots the real public/widget.js in a DOM and exercises the client-side
// protocol: config fetch auth, SSE text-delta rendering, server error
// events, and the expired-token re-mint path. fetch is stubbed; no network.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WIDGET_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../public/widget.js'),
  'utf8',
);

const API_URL = 'https://app.example.com/api/chat';
const ASSISTANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function fakeToken(): string {
  const payload = Buffer.from(
    JSON.stringify({ shop: 's', iat: 0, exp: 9999999999, aid: ASSISTANT_ID, ep: 1 }),
  )
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${payload}.sig`;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Build a text/event-stream Response from raw SSE chunk objects. */
function sseResponse(events: unknown[], headers: Record<string, string> = {}) {
  const body = events
    .map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`)
    .join('');
  return new Response(new Blob([body]).stream(), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', ...headers },
  });
}

function bootWidget() {
  // The widget is an IIFE over window/document; evaluate it fresh per test.
  new Function(WIDGET_SRC)();
}

function widgetRoot(): HTMLElement {
  const host = document.querySelector('[data-nordic-support]');
  if (!host?.shadowRoot) throw new Error('widget not mounted');
  const root = host.shadowRoot.querySelector('.ns-root');
  if (!root) throw new Error('ns-root missing');
  return root as HTMLElement;
}

function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openAndSend(root: HTMLElement, message: string): Promise<void> {
  (root.querySelector('#launcher') as HTMLElement).click();
  const input = root.querySelector('#input') as HTMLTextAreaElement;
  input.value = message;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  (root.querySelector('#send') as HTMLElement).click();
  // Let the fetch chain + stream pump settle.
  await flush(50);
  await flush(50);
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  // happy-dom lacks scrollTo on elements; the widget calls it after appends.
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).__NORDIC_SUPPORT_LOADED__;
  delete (window as unknown as Record<string, unknown>).NORDIC_SUPPORT;
});

describe('widget boot (inline config path)', () => {
  it('fetches widget-config with the token in the Authorization header, not the URL', async () => {
    (window as unknown as Record<string, unknown>).NORDIC_SUPPORT = {
      token: fakeToken(),
      apiUrl: API_URL,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { widget: {} }));

    bootWidget();
    await flush(20);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://app.example.com/api/widget-config');
    expect(String(url)).not.toContain('token=');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: `Bearer ${fakeToken()}`,
    });
    expect(widgetRoot().querySelector('#launcher')).toBeTruthy();
  });
});

describe('chat streaming', () => {
  async function bootInline(): Promise<HTMLElement> {
    (window as unknown as Record<string, unknown>).NORDIC_SUPPORT = {
      token: fakeToken(),
      apiUrl: API_URL,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { widget: {} }));
    bootWidget();
    await flush(20);
    return widgetRoot();
  }

  it('renders streamed text-delta events into an assistant bubble', async () => {
    const root = await bootInline();
    fetchMock.mockResolvedValueOnce(
      sseResponse(
        [
          { type: 'start' },
          { type: 'text-delta', id: '1', delta: 'Hej ' },
          { type: 'text-delta', id: '1', delta: 'där!' },
          { type: 'finish' },
          '[DONE]',
        ],
        { 'X-Conversation-Id': 'conv-123' },
      ),
    );

    await openAndSend(root, 'Hej!');

    const bubbles = root.querySelectorAll('.ns-bubble.in');
    const last = bubbles[bubbles.length - 1];
    expect(last?.textContent).toContain('Hej där!');
    // Modal stays hidden on success.
    expect(root.querySelector('.ns-modal-backdrop')!.classList.contains('ns-hidden')).toBe(true);

    // Second send must resume the conversation the server named.
    fetchMock.mockResolvedValueOnce(
      sseResponse([{ type: 'text-delta', id: '2', delta: 'Svar 2' }]),
    );
    await openAndSend(root, 'En till fråga');
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(body.sessionId).toBe('conv-123');
  });

  it('shows an error (and drops the optimistic row) when the stream only emits an error event', async () => {
    const root = await bootInline();
    fetchMock.mockResolvedValueOnce(
      sseResponse([{ type: 'start' }, { type: 'error', errorText: 'model exploded' }]),
    );

    await openAndSend(root, 'Hej?');

    // No assistant bubble, no stranded user bubble, error modal visible.
    expect(root.querySelector('.ns-bubble.in')).toBeNull();
    expect(root.querySelector('.ns-bubble.out')).toBeNull();
    expect(root.querySelector('.ns-modal-backdrop')!.classList.contains('ns-hidden')).toBe(false);
  });

  it('keeps partial text but still surfaces an error event arriving mid-stream', async () => {
    const root = await bootInline();
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: 'text-delta', id: '1', delta: 'Halvt svar' },
        { type: 'error', errorText: 'boom' },
      ]),
    );

    await openAndSend(root, 'Hej?');

    const bubbles = root.querySelectorAll('.ns-bubble.in');
    expect(bubbles[bubbles.length - 1]?.textContent).toContain('Halvt svar');
    expect(root.querySelector('.ns-modal-backdrop')!.classList.contains('ns-hidden')).toBe(false);
  });
});

describe('public-token path (one-liner install)', () => {
  function installScriptTag(): void {
    const tag = document.createElement('script');
    tag.setAttribute('data-assistant', ASSISTANT_ID);
    // Non-JS type keeps happy-dom from trying to fetch the src; the widget
    // only reads the attributes.
    tag.type = 'text/x-widget-stub';
    tag.src = 'https://app.example.com/widget.js';
    document.head.appendChild(tag);
  }

  it('re-mints the token and replays the message on 401', async () => {
    installScriptTag();
    // boot: mint + config
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: fakeToken(), apiUrl: API_URL }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { widget: {} }));
    bootWidget();
    await flush(20);
    const root = widgetRoot();

    // send: expired token -> 401, re-mint -> fresh token, replay -> stream
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_widget_token' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'fresh.token', apiUrl: API_URL }));
    fetchMock.mockResolvedValueOnce(
      sseResponse([{ type: 'text-delta', id: '1', delta: 'Funkar igen' }]),
    );

    await openAndSend(root, 'Hej efter 24h');
    await flush(50);

    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes('/api/widget-public-token')).length).toBe(2);
    const replay = fetchMock.mock.calls.at(-1)!;
    expect(String(replay[0])).toContain('/api/chat/stream');
    expect((replay[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer fresh.token',
    });
    const bubbles = root.querySelectorAll('.ns-bubble.in');
    expect(bubbles[bubbles.length - 1]?.textContent).toContain('Funkar igen');
    expect(root.querySelector('.ns-modal-backdrop')!.classList.contains('ns-hidden')).toBe(true);
  });

  it('gives up after one re-mint attempt and shows the unconfigured error', async () => {
    installScriptTag();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: fakeToken(), apiUrl: API_URL }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { widget: {} }));
    bootWidget();
    await flush(20);
    const root = widgetRoot();

    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_widget_token' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'fresh.token', apiUrl: API_URL }));
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_widget_token' }));

    await openAndSend(root, 'Hej');
    await flush(50);

    // 401 -> re-mint -> 401 again -> error modal, no infinite loop.
    const streamCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/chat/stream'),
    );
    expect(streamCalls.length).toBe(2);
    expect(root.querySelector('.ns-modal-backdrop')!.classList.contains('ns-hidden')).toBe(false);
  });
});
