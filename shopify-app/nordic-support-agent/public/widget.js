/**
 * Nordic Support Agent — storefront chat widget.
 *
 * Minimal merchant snippet (paste in theme.liquid before </body>):
 *
 *   <script>
 *     window.NORDIC_SUPPORT = {
 *       token:  "<server-signed widget token>",
 *       apiUrl: "https://app.example.com/api/chat"
 *     };
 *   </script>
 *   <script src="https://app.example.com/widget.js" async defer></script>
 *
 * The CSS + DOM are a verbatim port of widget-design/index.html so the
 * production widget renders byte-identically to the Claude Design source.
 * Per-merchant tokens (brand, accent, name, language) flow in via
 * /api/widget-config and are applied as inline CSS variables + textContent
 * on the design's hooks (#hdr-title, #hdr-subtitle, etc.).
 *
 * Vanilla JS — no framework, no build step, no third-party deps.
 */
(function () {
  'use strict';

  if (window.__NORDIC_SUPPORT_LOADED__) return;

  // Two install paths:
  //   1. Explicit:  window.NORDIC_SUPPORT = { token, apiUrl, brand?, text?, language?, country? }
  //   2. One-liner: <script src="…/widget.js" data-assistant="ID" async defer>
  //      → widget fetches a short-lived public token from the script origin's
  //        /api/widget-public-token?a=ID endpoint and uses that.
  var inlineConfig = /** @type {any} */ (window.NORDIC_SUPPORT) || {};
  var TOKEN;
  var API_URL;
  var CONFIG_URL;
  var STREAM_URL;
  var ASSISTANT_ID = null;
  var SCRIPT_ORIGIN = null;

  resolveConfig(inlineConfig).then(continueBoot, function (err) {
    console.warn('[nordic-support]', (err && err.message) || String(err));
  });

  function resolveConfig(inline) {
    if (typeof inline.token === 'string' && typeof inline.apiUrl === 'string') {
      // Peek at the token payload (no verification — server still verifies)
      // to recover assistant id + origin, so the privacy footer link works
      // in the inline-config path too. Without this, the widget falls back
      // to the "Drivs av {brand}" footer.
      try {
        var payloadB64 = inline.token.split('.')[0];
        if (payloadB64) {
          var json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
          var payload = JSON.parse(json);
          if (payload && typeof payload.aid === 'string') {
            ASSISTANT_ID = payload.aid;
          }
        }
        SCRIPT_ORIGIN = new URL(inline.apiUrl).origin;
      } catch (_) { /* footer falls back to powered-by */ }
      return Promise.resolve({ token: inline.token, apiUrl: inline.apiUrl });
    }
    var scriptTag = document.querySelector('script[data-assistant][src]');
    if (!scriptTag) {
      return Promise.reject(
        new Error(
          'missing config; expected window.NORDIC_SUPPORT = { token, apiUrl } OR <script data-assistant="ID">',
        ),
      );
    }
    var assistantId = scriptTag.getAttribute('data-assistant');
    var origin;
    try { origin = new URL(scriptTag.src).origin; }
    catch (_) { return Promise.reject(new Error('cannot resolve script origin')); }
    if (!assistantId) return Promise.reject(new Error('empty data-assistant'));
    ASSISTANT_ID = assistantId;
    SCRIPT_ORIGIN = origin;
    return mintPublicToken(origin, assistantId, null);
  }

  function mintPublicToken(origin, assistantId, turnstileToken) {
    var url = origin + '/api/widget-public-token?a=' + encodeURIComponent(assistantId);
    if (turnstileToken) url += '&t=' + encodeURIComponent(turnstileToken);
    return fetch(url, { method: 'GET', credentials: 'omit' }).then(function (res) {
      return res.json().then(function (data) {
        if (res.ok && data && typeof data.token === 'string') {
          return {
            token: data.token,
            apiUrl: typeof data.apiUrl === 'string' ? data.apiUrl : origin + '/api/chat',
          };
        }
        if (
          res.status === 403 &&
          data &&
          (data.error === 'bot_check_required' || data.error === 'bot_check_failed') &&
          typeof data.siteKey === 'string' &&
          !turnstileToken
        ) {
          return solveTurnstile(data.siteKey).then(function (t) {
            return mintPublicToken(origin, assistantId, t);
          });
        }
        throw new Error((data && data.error) || 'public-token http_' + res.status);
      });
    });
  }

  function solveTurnstile(siteKey) {
    return loadTurnstileApi().then(function () {
      return new Promise(function (resolve, reject) {
        var container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;';
        document.body.appendChild(container);
        var cleanup = function () { try { document.body.removeChild(container); } catch (_) {} };
        try {
          window.turnstile.render(container, {
            sitekey: siteKey,
            size: 'invisible',
            callback: function (token) { cleanup(); resolve(token); },
            'error-callback': function (e) { cleanup(); reject(new Error('turnstile-error: ' + (e || 'unknown'))); },
            'timeout-callback': function () { cleanup(); reject(new Error('turnstile-timeout')); },
          });
        } catch (e) { cleanup(); reject(e); }
      });
    });
  }

  function loadTurnstileApi() {
    if (window.turnstile) return Promise.resolve();
    if (window.__NORDIC_TURNSTILE_LOADING__) return window.__NORDIC_TURNSTILE_LOADING__;
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.defer = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('failed to load turnstile api')); };
      document.head.appendChild(s);
    });
    window.__NORDIC_TURNSTILE_LOADING__ = p;
    return p;
  }

  function continueBoot(cfg) {
    if (window.__NORDIC_SUPPORT_LOADED__) return;
    window.__NORDIC_SUPPORT_LOADED__ = true;
    TOKEN = cfg.token;
    API_URL = cfg.apiUrl;
    CONFIG_URL = API_URL.replace(/\/api\/chat\/?$/, '/api/widget-config');
    STREAM_URL = /\/api\/chat\/stream\/?$/.test(API_URL)
      ? API_URL
      : API_URL.replace(/\/api\/chat\/?$/, '/api/chat/stream');
    fetchRemoteConfig().then(init, function () { init({}); });
  }

  var STORAGE_KEY = 'nordic_support_session';
  var MAX_CHARS = 1000;

  // Default UI strings per language. Merchant config + inline text override.
  var STRING_DEFAULTS = {
    sv: {
      placeholder: 'Skriv din fråga…',
      thinking: 'Tänker…',
      sendLabel: 'Skicka',
      closeLabel: 'Stäng',
      openLabel: 'Öppna support',
      errRateLimit: 'För många meddelanden. Prova igen om {n} sekunder.',
      errUnconfigured: 'Chatten är inte konfigurerad. Kontakta butiken.',
      errGeneric: 'Kunde inte skicka. Prova igen om en stund.',
      errNetwork: 'Nätverksfel. Kontrollera din anslutning och prova igen.',
      errTooLong: 'Ditt meddelande är för långt. Förkorta det och prova igen.',
      errTooManyTurns: 'Konversationen har blivit lång. Starta en ny för att fortsätta.',
      charCount: '{n}/{max} tecken',
      privacyLabel: 'Sekretess & data',
      todayLabel: 'Idag',
      poweredBy: 'Drivs av',
      defaultGreeting: 'Hej! Hur kan jag hjälpa dig idag?',
      defaultSubtitle: 'Svarar oftast inom några minuter',
      delivered: 'Levererad',
    },
    en: {
      placeholder: 'Type a message…',
      thinking: 'Thinking…',
      sendLabel: 'Send',
      closeLabel: 'Close',
      openLabel: 'Open support chat',
      errRateLimit: 'Too many messages. Try again in {n} seconds.',
      errUnconfigured: 'Chat is not configured correctly. Please contact the store.',
      errGeneric: "Couldn't send. Please try again in a moment.",
      errNetwork: 'Network problem. Please check your connection and try again.',
      errTooLong: 'Your message is too long. Please shorten it and try again.',
      errTooManyTurns: 'This conversation got long. Start a new one to continue.',
      charCount: '{n}/{max} characters',
      privacyLabel: 'Privacy & data',
      todayLabel: 'Today',
      poweredBy: 'Powered by',
      defaultGreeting: 'Hi there! How can I help today?',
      defaultSubtitle: 'Usually replies in a few minutes',
      delivered: 'Delivered',
    },
    no: {
      placeholder: 'Skriv spørsmålet ditt…',
      thinking: 'Tenker…',
      sendLabel: 'Send',
      closeLabel: 'Lukk',
      openLabel: 'Åpne support',
      errRateLimit: 'For mange meldinger. Prøv igjen om {n} sekunder.',
      errUnconfigured: 'Chatten er ikke konfigurert. Kontakt butikken.',
      errGeneric: 'Kunne ikke sende. Prøv igjen om et øyeblikk.',
      errNetwork: 'Nettverksfeil. Sjekk tilkoblingen og prøv igjen.',
      errTooLong: 'Meldingen er for lang. Kort den ned og prøv igjen.',
      errTooManyTurns: 'Samtalen har blitt lang. Start en ny for å fortsette.',
      charCount: '{n}/{max} tegn',
      privacyLabel: 'Personvern & data',
      todayLabel: 'I dag',
      poweredBy: 'Drevet av',
      defaultGreeting: 'Hei! Hvordan kan jeg hjelpe deg i dag?',
      defaultSubtitle: 'Svarer vanligvis innen noen minutter',
      delivered: 'Levert',
    },
    da: {
      placeholder: 'Skriv dit spørgsmål…',
      thinking: 'Tænker…',
      sendLabel: 'Send',
      closeLabel: 'Luk',
      openLabel: 'Åbn support',
      errRateLimit: 'For mange beskeder. Prøv igen om {n} sekunder.',
      errUnconfigured: 'Chatten er ikke konfigureret. Kontakt butikken.',
      errGeneric: 'Kunne ikke sende. Prøv igen om et øjeblik.',
      errNetwork: 'Netværksfejl. Tjek forbindelsen og prøv igen.',
      errTooLong: 'Din besked er for lang. Forkort den og prøv igen.',
      errTooManyTurns: 'Samtalen er blevet lang. Start en ny for at fortsætte.',
      charCount: '{n}/{max} tegn',
      privacyLabel: 'Privatliv & data',
      todayLabel: 'I dag',
      poweredBy: 'Drevet af',
      defaultGreeting: 'Hej! Hvordan kan jeg hjælpe dig i dag?',
      defaultSubtitle: 'Svarer normalt inden for et par minutter',
      delivered: 'Leveret',
    },
    fi: {
      placeholder: 'Kirjoita kysymyksesi…',
      thinking: 'Mietin…',
      sendLabel: 'Lähetä',
      closeLabel: 'Sulje',
      openLabel: 'Avaa tukikeskustelu',
      errRateLimit: 'Liian monta viestiä. Yritä uudelleen {n} sekunnin kuluttua.',
      errUnconfigured: 'Chatia ei ole määritetty. Ota yhteyttä kauppaan.',
      errGeneric: 'Lähetys epäonnistui. Yritä hetken kuluttua uudelleen.',
      errNetwork: 'Verkkovirhe. Tarkista yhteytesi ja yritä uudelleen.',
      errTooLong: 'Viestisi on liian pitkä. Lyhennä sitä ja yritä uudelleen.',
      errTooManyTurns: 'Keskustelu venyi. Aloita uusi jatkaaksesi.',
      charCount: '{n}/{max} merkkiä',
      privacyLabel: 'Yksityisyys & tiedot',
      todayLabel: 'Tänään',
      poweredBy: 'Tuottaa',
      defaultGreeting: 'Hei! Miten voin auttaa sinua tänään?',
      defaultSubtitle: 'Vastaa yleensä muutamassa minuutissa',
      delivered: 'Toimitettu',
    },
  };

  function fetchRemoteConfig() {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error('timeout')); }, 2500);
      fetch(CONFIG_URL + '?token=' + encodeURIComponent(TOKEN), { method: 'GET', credentials: 'omit' })
        .then(function (res) {
          clearTimeout(timer);
          if (!res.ok) return reject(new Error('http_' + res.status));
          res.json().then(resolve, reject);
        })
        .catch(function (err) { clearTimeout(timer); reject(err); });
    });
  }

  // ============================================================
  // Widget CSS — verbatim port of widget-design/index.html (.ns-root scope).
  // Everything below the page-shell comments in the design file is here.
  // ============================================================
  var WIDGET_CSS = `
  .ns-root, .ns-root *, .ns-root *::before, .ns-root *::after { box-sizing: border-box; margin: 0; }
  .ns-root {
    --ns-brand-color: #1a1a1a;
    --ns-brand-accent: #e85d4a;
    --ns-launcher-icon-color: #ffffff;
    --ns-send-icon-color: #ffffff;
    --ns-panel-width: 380px;
    --ns-panel-height: 600px;
    --ns-launcher-size: 60px;
    --ns-panel-radius: 20px;
    --ns-bubble-radius: 18px;
    --ns-font-family: "Geist", system-ui, -apple-system, sans-serif;
    --ns-font-size-base: 15px;

    --ns-surface-bg: #ffffff;
    --ns-surface-ink: #18140f;
    --ns-surface-muted: #6b6359;
    --ns-surface-line: #ece5d6;
    --ns-bubble-in-bg: #f1ebde;
    --ns-bubble-in-ink: #18140f;
    --ns-input-bg: #faf6ee;
    --_typing-dot: #b5ad9d;
    --_shadow: 0 18px 50px -12px rgba(20,16,8,0.18), 0 4px 14px -4px rgba(20,16,8,0.08);

    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483647;
    font-family: var(--ns-font-family);
    font-size: var(--ns-font-size-base);
    color: var(--ns-surface-ink);
    line-height: 1.45;
  }
  .ns-root[data-theme="dark"] {
    --ns-surface-bg: #1a1714;
    --ns-surface-ink: #f5efe2;
    --ns-surface-muted: #98907f;
    --ns-surface-line: #2c2620;
    --ns-bubble-in-bg: #2a241d;
    --ns-bubble-in-ink: #f5efe2;
    --ns-input-bg: #221d18;
    --_typing-dot: #6b6359;
    --_shadow: 0 18px 50px -12px rgba(0,0,0,0.55), 0 4px 14px -4px rgba(0,0,0,0.35);
  }
  .ns-root[data-shadow="none"]   { --_shadow: none; }
  .ns-root[data-shadow="subtle"] { --_shadow: 0 4px 14px -4px rgba(20,16,8,0.10); }
  .ns-root[data-shadow="medium"] { --_shadow: 0 18px 50px -12px rgba(20,16,8,0.18), 0 4px 14px -4px rgba(20,16,8,0.08); }
  .ns-root[data-shadow="strong"] { --_shadow: 0 32px 80px -16px rgba(20,16,8,0.36), 0 10px 30px -8px rgba(20,16,8,0.16); }

  .ns-root button { font: inherit; cursor: pointer; background: transparent; border: 0; color: inherit; padding: 0; }
  .ns-root input, .ns-root textarea { font: inherit; color: inherit; background: transparent; border: 0; outline: none; padding: 0; -webkit-appearance: none; appearance: none; }

  /* ---- Launcher ---- */
  .ns-root .ns-launcher {
    position: absolute;
    right: 24px;
    bottom: 24px;
    width: var(--ns-launcher-size);
    height: var(--ns-launcher-size);
    background: var(--ns-launcher-bg, var(--ns-brand-color));
    color: var(--ns-launcher-icon-color);
    box-shadow: var(--_shadow);
    pointer-events: auto;
    display: grid;
    place-items: center;
    transition: transform 220ms cubic-bezier(.22,1,.36,1), box-shadow 220ms, border-radius 280ms cubic-bezier(.22,1,.36,1);
  }
  .ns-launcher:hover { transform: translateY(-2px) scale(1.04); }
  .ns-launcher:active { transform: translateY(0) scale(0.96); }
  .ns-root[data-launcher-shape="circle"]  .ns-launcher { border-radius: 9999px; }
  .ns-root[data-launcher-shape="rounded"] .ns-launcher { border-radius: 16px; }
  .ns-root[data-launcher-shape="square"]  .ns-launcher { border-radius: 4px; }

  .ns-launcher-icon {
    grid-area: 1 / 1;
    width: 54%;
    height: 54%;
    display: grid;
    place-items: center;
    color: inherit;
    transition: opacity 220ms cubic-bezier(.22,1,.36,1), transform 280ms cubic-bezier(.22,1,.36,1);
    transform-origin: 50% 50%;
  }
  .ns-launcher-icon svg { width: 100%; height: 100%; display: block; color: inherit; }
  .ns-root[data-open="false"] .ns-launcher-icon.icon-default { opacity: 1; transform: rotate(0deg) scale(1); }
  .ns-root[data-open="false"] .ns-launcher-icon.icon-close   { opacity: 0; transform: rotate(-45deg) scale(0.6); pointer-events: none; }
  .ns-root[data-open="true"]  .ns-launcher-icon.icon-default { opacity: 0; transform: rotate(45deg) scale(0.6); pointer-events: none; }
  .ns-root[data-open="true"]  .ns-launcher-icon.icon-close   { opacity: 1; transform: rotate(0deg) scale(1); }

  /* ---- Panel ---- */
  .ns-panel {
    position: absolute;
    right: 24px;
    bottom: calc(24px + var(--ns-launcher-size) + 14px);
    width: var(--ns-panel-width);
    height: var(--ns-panel-height);
    max-height: calc(100vh - 48px - var(--ns-launcher-size) - 14px);
    background: var(--ns-surface-bg);
    color: var(--ns-surface-ink);
    border-radius: var(--ns-panel-radius);
    box-shadow: var(--_shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    pointer-events: auto;
    transform-origin: 100% 100%;
    transition:
      opacity 260ms cubic-bezier(.22,1,.36,1),
      transform 360ms cubic-bezier(.22,1,.36,1),
      visibility 0s linear 0s;
    will-change: transform, opacity;
  }
  .ns-root[data-open="false"] .ns-panel {
    opacity: 0;
    transform: translateY(16px) scale(0.94);
    pointer-events: none;
    visibility: hidden;
    transition:
      opacity 200ms cubic-bezier(.4,0,1,1),
      transform 240ms cubic-bezier(.4,0,1,1),
      visibility 0s linear 240ms;
  }

  /* ---- Header ---- */
  .ns-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 14px 14px 16px;
    background: var(--ns-brand-color);
    color: #fff;
    border-bottom: 1px solid color-mix(in srgb, var(--ns-brand-color) 80%, #000 0%);
  }
  .ns-avatar {
    width: 36px; height: 36px;
    border-radius: 999px;
    background: color-mix(in srgb, #fff 18%, var(--ns-brand-color));
    color: #fff;
    display: grid; place-items: center;
    font-size: 14px; font-weight: 600;
    position: relative;
    flex: 0 0 auto;
  }
  .ns-avatar .dot {
    position: absolute;
    right: -1px; bottom: -1px;
    width: 11px; height: 11px;
    border-radius: 999px;
    background: #34c759;
    border: 2px solid var(--ns-brand-color);
  }
  .ns-title-block { flex: 1; min-width: 0; }
  .ns-title {
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    line-height: 1.2;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ns-subtitle {
    font-size: 12px;
    opacity: 0.72;
    line-height: 1.3;
    margin-top: 1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ns-subtitle:empty { display: none; }
  .ns-header-actions { display: flex; gap: 2px; flex: 0 0 auto; }
  .ns-icon-btn {
    width: 32px; height: 32px;
    border-radius: 8px;
    color: #fff;
    display: grid; place-items: center;
    opacity: 0.8;
    transition: opacity 120ms, background 120ms;
  }
  .ns-icon-btn:hover { opacity: 1; background: rgba(255,255,255,0.12); }
  .ns-icon-btn svg { width: 16px; height: 16px; }

  /* ---- Body ---- */
  .ns-body {
    flex: 1;
    overflow-y: auto;
    padding: 18px 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--ns-surface-bg);
    scrollbar-width: thin;
    scrollbar-color: var(--ns-surface-line) transparent;
  }
  .ns-body::-webkit-scrollbar { width: 8px; }
  .ns-body::-webkit-scrollbar-thumb { background: var(--ns-surface-line); border-radius: 4px; }

  .ns-day {
    text-align: center;
    font-size: 11px;
    color: var(--ns-surface-muted);
    padding: 6px 0 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .ns-msg-row { display: flex; align-items: flex-end; gap: 8px; max-width: 100%; }
  .ns-msg-row.in  { justify-content: flex-start; }
  .ns-msg-row.out { justify-content: flex-end; }

  .ns-msg-avatar {
    width: 24px; height: 24px;
    border-radius: 999px;
    background: var(--ns-bubble-in-bg);
    color: var(--ns-bubble-in-ink);
    display: grid; place-items: center;
    font-size: 10.5px; font-weight: 600;
    flex: 0 0 auto;
    margin-bottom: 2px;
  }

  .ns-bubble {
    padding: 10px 14px;
    border-radius: var(--ns-bubble-radius);
    font-size: var(--ns-font-size-base);
    line-height: 1.45;
    max-width: 84%;
    word-wrap: break-word;
  }
  .ns-bubble strong, .ns-bubble b, .ns-bubble em, .ns-bubble i { font-weight: inherit; font-style: normal; }
  .ns-bubble.in  { background: var(--ns-bubble-in-bg); color: var(--ns-bubble-in-ink); border-bottom-left-radius: 6px; }
  .ns-bubble.out { background: var(--ns-brand-color); color: #fff; border-bottom-right-radius: 6px; }
  .ns-bubble p { margin: 0 0 6px 0; }
  .ns-bubble p:last-child { margin-bottom: 0; }
  .ns-bubble ul, .ns-bubble ol { margin: 4px 0 6px 0; padding-left: 18px; }
  .ns-bubble li { margin: 2px 0; }
  .ns-bubble a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .ns-bubble a:hover { opacity: 0.85; }
  .ns-meta { font-size: 10.5px; color: var(--ns-surface-muted); padding: 0 4px; }
  .ns-meta-row { padding: 0 4px 4px; }

  /* typing indicator */
  .ns-typing {
    background: var(--ns-bubble-in-bg);
    border-radius: var(--ns-bubble-radius);
    border-bottom-left-radius: 6px;
    padding: 12px 14px;
    display: inline-flex; gap: 4px; align-items: center;
  }
  .ns-typing span {
    width: 6px; height: 6px; border-radius: 999px;
    background: var(--_typing-dot);
    animation: ns-bounce 1.2s infinite ease-in-out;
  }
  .ns-typing span:nth-child(2) { animation-delay: 0.15s; }
  .ns-typing span:nth-child(3) { animation-delay: 0.30s; }
  @keyframes ns-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.55; }
    30% { transform: translateY(-4px); opacity: 1; }
  }

  /* Message entrance animations */
  @keyframes ns-out-bubble {
    0%   { opacity: 0; transform: translateY(18px) scale(0.94); }
    100% { opacity: 1; transform: translateY(0)    scale(1);    }
  }
  @keyframes ns-in-bubble {
    /* The bubble has an asymmetric tail (border-bottom-left-radius: 6px).
     * Match the clip-path's round to the same corners so the tail is
     * present from the first frame, not snapped in at the end. */
    0% {
      opacity: 0;
      transform: translateY(6px) scale(0.96);
      clip-path: inset(85% 80% 0% 0% round var(--ns-bubble-radius) var(--ns-bubble-radius) var(--ns-bubble-radius) 6px);
    }
    55% { opacity: 1; }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
      clip-path: inset(0% 0% 0% 0% round var(--ns-bubble-radius) var(--ns-bubble-radius) var(--ns-bubble-radius) 6px);
    }
  }
  @keyframes ns-typing-in {
    0%   { opacity: 0; transform: translateY(4px) scale(0.85); }
    100% { opacity: 1; transform: translateY(0)   scale(1);    }
  }
  @keyframes ns-avatar-pop {
    0%   { opacity: 0; transform: scale(0.4); }
    70%  { opacity: 1; transform: scale(1.08); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes ns-fade-up {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .ns-msg-row.in  .ns-bubble,
  .ns-msg-row.in  .ns-typing { transform-origin: 0% 100%; }
  .ns-msg-row.out .ns-bubble { transform-origin: 100% 100%; }
  .ns-msg-row.in  .ns-msg-avatar { transform-origin: 50% 100%; }

  .ns-msg-row.in.ns-fresh  .ns-bubble  { animation: ns-in-bubble 520ms cubic-bezier(.22, 1, .36, 1) both; }
  .ns-msg-row.out.ns-fresh .ns-bubble  { animation: ns-out-bubble 340ms cubic-bezier(.2, .9, .25, 1.15) both; }
  .ns-fresh .ns-typing                 { animation: ns-typing-in 280ms cubic-bezier(.22, 1, .36, 1) both; }
  .ns-fresh .ns-msg-avatar             { animation: ns-avatar-pop 380ms cubic-bezier(.34, 1.4, .5, 1) both; animation-delay: -80ms; }
  .ns-meta-row.ns-fresh                { animation: ns-fade-up 280ms ease-out 220ms both; }

  @keyframes ns-first-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
  .ns-body.ns-first-open { animation: ns-first-fade 360ms cubic-bezier(.22,1,.36,1) both; }

  @media (prefers-reduced-motion: reduce) {
    .ns-msg-row.ns-fresh .ns-bubble,
    .ns-fresh .ns-typing,
    .ns-fresh .ns-msg-avatar,
    .ns-meta-row.ns-fresh,
    .ns-body.ns-first-open { animation: none; }
  }

  /* ---- Composer ---- */
  .ns-composer { border-top: 1px solid var(--ns-surface-line); padding: 10px 12px 12px; background: var(--ns-surface-bg); }
  .ns-input-wrap {
    display: flex; align-items: center; gap: 8px;
    background: var(--ns-input-bg);
    border: 1px solid var(--ns-surface-line);
    border-radius: 16px;
    padding: 6px 6px 6px 14px;
    transition: border-color 140ms;
  }
  .ns-input-wrap:focus-within { border-color: var(--ns-brand-accent); }
  .ns-input-wrap.ns-over { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.10); }
  .ns-input {
    flex: 1;
    resize: none;
    color: var(--ns-surface-ink);
    padding: 8px 0;
    max-height: 110px;
    line-height: 1.4;
  }
  .ns-input::placeholder { color: var(--ns-surface-muted); }

  .ns-send {
    width: 36px; height: 36px;
    background: var(--ns-brand-color);
    color: var(--ns-send-icon-color);
    display: grid; place-items: center;
    flex: 0 0 auto;
    transition: transform 140ms, opacity 140ms;
  }
  .ns-send:disabled { opacity: 0.4; cursor: not-allowed; }
  .ns-send:not(:disabled):hover { transform: translateY(-1px); }
  .ns-send svg { width: 16px; height: 16px; }
  .ns-root[data-send-shape="circle"]  .ns-send { border-radius: 9999px; }
  .ns-root[data-send-shape="rounded"] .ns-send { border-radius: 10px; }
  .ns-root[data-send-shape="square"]  .ns-send { border-radius: 4px; }
  .ns-root[data-send-fill="solid"]   .ns-send { background: var(--ns-brand-color); color: var(--ns-send-icon-color); border: 1px solid transparent; }
  .ns-root[data-send-fill="outline"] .ns-send { background: transparent; color: var(--ns-brand-color); border: 1.5px solid var(--ns-brand-color); }
  .ns-root[data-theme="dark"][data-send-fill="outline"] .ns-send { color: #fff; border-color: rgba(255,255,255,0.5); }
  .ns-root[data-send-fill="ghost"]   .ns-send { background: transparent; color: var(--ns-brand-color); border: 0; }
  .ns-root[data-theme="dark"][data-send-fill="ghost"] .ns-send { color: #fff; }

  .ns-foot {
    text-align: center;
    font-size: 10.5px;
    color: var(--ns-surface-muted);
    padding: 6px 0 2px;
    letter-spacing: 0.02em;
  }
  .ns-foot a { color: inherit; text-decoration: none; }
  .ns-foot a:hover { text-decoration: underline; color: var(--ns-surface-ink); }
  .ns-foot b { color: var(--ns-surface-ink); font-weight: 500; }

  /* ---- Modal ---- */
  .ns-modal-backdrop { position: absolute; inset: 0; background: rgba(17,24,39,0.45); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 1; }
  .ns-modal-backdrop.ns-hidden { display: none; }
  .ns-modal { background: var(--ns-surface-bg); color: var(--ns-surface-ink); border-radius: 12px; padding: 20px; max-width: 280px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); display: flex; flex-direction: column; gap: 16px; }
  .ns-modal-icon { width: 32px; height: 32px; border-radius: 50%; background: #fee2e2; color: #dc2626; display: inline-flex; align-items: center; justify-content: center; align-self: center; flex-shrink: 0; }
  .ns-modal-icon svg { width: 18px; height: 18px; display: block; }
  .ns-modal-text { font-size: 14px; line-height: 1.5; text-align: center; }
  .ns-modal-ok { align-self: center; padding: 8px 20px; height: 36px; background: var(--ns-brand-color); color: #fff; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; min-width: 80px; display: inline-flex; align-items: center; justify-content: center; }
  .ns-modal-ok:hover { opacity: 0.9; }

  /* ---- Mobile fullscreen ---- */
  @media (max-width: 480px) {
    .ns-panel { right: 0; left: 0; bottom: 0; top: 0; width: 100%; height: 100%; max-height: 100%; border-radius: 0 !important; }
    .ns-launcher { right: 16px; bottom: 16px; }
    .ns-root[data-open="true"] .ns-launcher { display: none; }
  }
  `;

  // Icon catalog — verbatim shapes from widget-design/index.html
  var ICONS = {
    chat_bubble: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-8.6L6 21.4V17H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4"/><circle cx="9" cy="13" r="1.2" fill="currentColor"/><circle cx="15" cy="13" r="1.2" fill="currentColor"/><path d="M9 17h6"/><path d="M2 12h2M20 12h2"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2zM19 14l.9 2.6L22 17.5l-2.1.9L19 21l-.9-2.6L16 17.5l2.1-.9L19 14z"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .8-1 1.7"/><circle cx="12" cy="17" r="0.6" fill="currentColor" stroke="none"/></svg>',
  };
  var SEND_SVG = {
    arrow_up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/></svg>',
    arrow_right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="8" x2="13" y2="8"/><polyline points="8 3 13 8 8 13"/></svg>',
    send_plane: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="15" y1="1" x2="7" y2="9"/><polygon points="15 1 10 15 7 9 1 6 15 1"/></svg>',
  };

  function init(remote) {
    // ----- Config resolution -----
    var w = (remote && remote.widget) || {};
    var brandFromInline = inlineConfig.brand || {};
    var BRAND_COLOR = brandFromInline.color || w.primaryColor || '#1a1a1a';
    var BRAND_ACCENT = brandFromInline.accentColor || w.accentColor || '#e85d4a';
    var LAUNCHER_ICON_COLOR = w.launcherIconColor || '#ffffff';
    var LAUNCHER_BG = (w.launcherBgColor && String(w.launcherBgColor).trim()) || '';
    var SEND_ICON_COLOR = w.sendIconColor || '#ffffff';
    var PANEL_W = typeof w.width === 'number' ? w.width : 380;
    var PANEL_H = typeof w.height === 'number' ? w.height : 600;
    var LAUNCHER_SIZE = typeof w.launcherSize === 'number' ? w.launcherSize : 60;
    var PANEL_RADIUS = typeof w.panelRadius === 'number' ? w.panelRadius : 20;
    var BUBBLE_RADIUS = typeof w.bubbleRadius === 'number' ? w.bubbleRadius : 18;
    var FONT_FAMILY = (typeof w.fontFamily === 'string' && w.fontFamily.trim()) ||
      '"Geist", system-ui, -apple-system, sans-serif';
    var FONT_SIZE_BASE = typeof w.fontSizeBase === 'number' ? w.fontSizeBase : 15;
    var SHOW_AVATAR = w.showAvatar !== false;
    var SHOW_DOT = w.showDot !== false;
    var LAUNCHER_SHAPE = w.launcherShape || 'circle';
    var SEND_SHAPE = w.sendShape || 'circle';
    var SEND_FILL = w.sendFill || 'solid';
    var ICON_STYLE = w.iconStyle || 'chat_bubble';
    var SEND_ICON = w.sendIcon || 'arrow_up';
    var THEME = w.theme === 'dark' ? 'dark' : 'light';
    var SHADOW = (w.shadow === 'none' || w.shadow === 'subtle' || w.shadow === 'strong') ? w.shadow : 'medium';
    var SURFACES = (w.surfaces && typeof w.surfaces === 'object') ? w.surfaces : {};

    var BRAND_NAME =
      brandFromInline.name ||
      (remote && remote.agent && remote.agent.name) ||
      'Support';
    var AVATAR_INITIAL = (BRAND_NAME || 'A').trim().charAt(0).toUpperCase() || 'A';

    var LANGUAGE = pickLanguage(inlineConfig.language || (remote && remote.language) || 'sv');
    var COUNTRY = inlineConfig.country || (remote && remote.country) || 'SE';

    var strings = Object.assign({}, STRING_DEFAULTS[LANGUAGE]);
    var remoteErrors = (remote && remote.agent && remote.agent.errorPhrases) || {};
    var ERR_MAP = {
      generic: 'errGeneric', network: 'errNetwork', rateLimit: 'errRateLimit',
      tooLong: 'errTooLong', tooManyTurns: 'errTooManyTurns', unconfigured: 'errUnconfigured',
    };
    for (var ek in ERR_MAP) {
      if (typeof remoteErrors[ek] === 'string' && remoteErrors[ek].trim()) {
        strings[ERR_MAP[ek]] = remoteErrors[ek];
      }
    }
    if (inlineConfig.text && typeof inlineConfig.text === 'object') {
      for (var k in inlineConfig.text) {
        if (typeof inlineConfig.text[k] === 'string') strings[k] = inlineConfig.text[k];
      }
    }

    var GREETING_RAW = (remote && remote.agent && typeof remote.agent.greeting === 'string')
      ? remote.agent.greeting.trim() : '';
    var GREETING = GREETING_RAW || strings.defaultGreeting || '';
    var SUBTITLE = (typeof w.subtitle === 'string' ? w.subtitle.trim() : '') || strings.defaultSubtitle || '';
    var PLACEHOLDER = (w.placeholder && String(w.placeholder).trim()) || strings.placeholder;

    function t(key, vars) {
      var s = strings[key] || '';
      if (!vars) return s;
      return s.replace(/\{(\w+)\}/g, function (_, name) {
        return vars[name] != null ? String(vars[name]) : '';
      });
    }
    function escapeAttr(s) {
      return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ----- Markup — verbatim port from widget-design/index.html -----
    // Sample messages stripped; the live conversation populates the body.
    var MARKUP =
      '<div class="ns-root" id="widget"' +
      ' data-open="false"' +
      ' data-theme="' + escapeAttr(THEME) + '"' +
      ' data-shadow="' + escapeAttr(SHADOW) + '"' +
      ' data-launcher-shape="' + escapeAttr(LAUNCHER_SHAPE) + '"' +
      ' data-send-shape="' + escapeAttr(SEND_SHAPE) + '"' +
      ' data-send-fill="' + escapeAttr(SEND_FILL) + '"' +
      ' data-icon-style="' + escapeAttr(ICON_STYLE) + '">' +
        '<div class="ns-panel" role="dialog" aria-label="' + escapeAttr(BRAND_NAME) + '">' +
          '<header class="ns-header">' +
            '<div class="ns-avatar" id="hdr-avatar">' + escapeHtml(AVATAR_INITIAL) + '<span class="dot" id="hdr-dot"></span></div>' +
            '<div class="ns-title-block">' +
              '<div class="ns-title" id="hdr-title"></div>' +
              '<div class="ns-subtitle" id="hdr-subtitle"></div>' +
            '</div>' +
            '<div class="ns-header-actions">' +
              '<button class="ns-icon-btn" id="btn-close" aria-label="' + escapeAttr(t('closeLabel')) + '">' +
                '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>' +
              '</button>' +
            '</div>' +
          '</header>' +
          '<div class="ns-body" id="body">' +
            '<div class="ns-day">' + escapeHtml(t('todayLabel')) + '</div>' +
          '</div>' +
          '<div class="ns-composer">' +
            '<div class="ns-input-wrap">' +
              '<textarea class="ns-input" id="input" rows="1" placeholder="' + escapeAttr(PLACEHOLDER) + '" aria-label="' + escapeAttr(PLACEHOLDER) + '"></textarea>' +
              '<button type="button" class="ns-send" id="send" disabled aria-label="' + escapeAttr(t('sendLabel')) + '">' +
                (SEND_SVG[SEND_ICON] || SEND_SVG.arrow_up) +
              '</button>' +
            '</div>' +
            '<div class="ns-foot" id="foot"></div>' +
          '</div>' +
          '<div class="ns-modal-backdrop ns-hidden" role="alertdialog" aria-modal="true">' +
            '<div class="ns-modal">' +
              '<div class="ns-modal-icon">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
              '</div>' +
              '<div class="ns-modal-text"></div>' +
              '<button type="button" class="ns-modal-ok">OK</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<button class="ns-launcher" id="launcher" aria-label="' + escapeAttr(t('openLabel')) + '">' +
          '<span class="ns-launcher-icon icon-default" id="icon-slot">' + (ICONS[ICON_STYLE] || ICONS.chat_bubble) + '</span>' +
          '<span class="ns-launcher-icon icon-close" aria-hidden="true">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</span>' +
        '</button>' +
      '</div>';

    // ----- Mount -----
    var host = document.createElement('div');
    host.setAttribute('data-nordic-support', '');
    host.style.cssText = 'all: initial; display: contents;';
    var shadow = host.attachShadow({ mode: 'open' });

    var styleEl = document.createElement('style');
    styleEl.textContent = WIDGET_CSS;
    shadow.appendChild(styleEl);

    var wrapper = document.createElement('div');
    wrapper.innerHTML = MARKUP;
    var root = wrapper.firstElementChild;

    // Apply runtime tokens (CSS variables on the root)
    root.style.setProperty('--ns-brand-color', BRAND_COLOR);
    root.style.setProperty('--ns-brand-accent', BRAND_ACCENT);
    root.style.setProperty('--ns-launcher-icon-color', LAUNCHER_ICON_COLOR);
    if (LAUNCHER_BG) root.style.setProperty('--ns-launcher-bg', LAUNCHER_BG);
    root.style.setProperty('--ns-send-icon-color', SEND_ICON_COLOR);
    root.style.setProperty('--ns-panel-width', PANEL_W + 'px');
    root.style.setProperty('--ns-panel-height', PANEL_H + 'px');
    root.style.setProperty('--ns-launcher-size', LAUNCHER_SIZE + 'px');
    root.style.setProperty('--ns-panel-radius', PANEL_RADIUS + 'px');
    root.style.setProperty('--ns-bubble-radius', BUBBLE_RADIUS + 'px');
    root.style.setProperty('--ns-font-family', FONT_FAMILY);
    root.style.setProperty('--ns-font-size-base', FONT_SIZE_BASE + 'px');
    if (SURFACES.bg)          root.style.setProperty('--ns-surface-bg', SURFACES.bg);
    if (SURFACES.ink)         root.style.setProperty('--ns-surface-ink', SURFACES.ink);
    if (SURFACES.bubbleInBg)  root.style.setProperty('--ns-bubble-in-bg', SURFACES.bubbleInBg);
    if (SURFACES.bubbleInInk) root.style.setProperty('--ns-bubble-in-ink', SURFACES.bubbleInInk);
    if (SURFACES.inputBg)     root.style.setProperty('--ns-input-bg', SURFACES.inputBg);

    shadow.appendChild(root);
    document.body.appendChild(host);

    // ----- Header / foot text -----
    root.querySelector('#hdr-title').textContent = BRAND_NAME;
    var subtitleEl = root.querySelector('#hdr-subtitle');
    if (SUBTITLE) subtitleEl.textContent = SUBTITLE;
    else subtitleEl.style.display = 'none';
    var hdrAvatarEl = root.querySelector('#hdr-avatar');
    if (!SHOW_AVATAR) hdrAvatarEl.style.display = 'none';
    var hdrDotEl = root.querySelector('#hdr-dot');
    if (!SHOW_DOT) hdrDotEl.style.display = 'none';

    var footHtml;
    if (ASSISTANT_ID && SCRIPT_ORIGIN) {
      var privacyHref =
        SCRIPT_ORIGIN +
        '/privacy?a=' + encodeURIComponent(ASSISTANT_ID) +
        '&lang=' + encodeURIComponent(LANGUAGE);
      footHtml =
        '<a href="' + escapeAttr(privacyHref) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(t('privacyLabel')) +
        '</a>';
    } else {
      footHtml = escapeHtml(t('poweredBy')) + ' <b>' + escapeHtml(BRAND_NAME) + '</b>';
    }
    root.querySelector('#foot').innerHTML = footHtml;

    // ----- Element refs -----
    var bodyEl = root.querySelector('#body');
    var launcher = root.querySelector('#launcher');
    var btnClose = root.querySelector('#btn-close');
    var inputWrapEl = root.querySelector('.ns-input-wrap');
    var inputEl = root.querySelector('#input');
    var sendEl = root.querySelector('#send');
    var modalBackdropEl = root.querySelector('.ns-modal-backdrop');
    var modalTextEl = root.querySelector('.ns-modal-text');
    var modalOkEl = root.querySelector('.ns-modal-ok');

    // ----- State -----
    // Conversation is in-memory only: a hard refresh starts a fresh chat.
    // Persisting across page loads led to the bot recalling prior sessions
    // from hours/days ago, which is not what a support widget should do.
    var sessionId = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    var sending = false;
    var firstOpenDone = false;
    var greetingShown = false;
    var greetingTimer = null;
    var wasOver = false;

    // ----- Helpers (design-style) -----
    function setOpen(v) {
      var nextOpen = !!v;
      root.setAttribute('data-open', nextOpen ? 'true' : 'false');
      launcher.setAttribute('aria-label', nextOpen ? t('closeLabel') : t('openLabel'));
      if (nextOpen) {
        runInitialCascade();
        scheduleGreeting();
        // No auto-focus: stealing keyboard focus on open is intrusive and
        // triggers the coral focus-within ring before the user even
        // engages. They tap the field when they're ready to type.
      } else if (greetingTimer) {
        clearTimeout(greetingTimer); greetingTimer = null;
      }
    }
    function runInitialCascade() {
      if (firstOpenDone) return;
      firstOpenDone = true;
      bodyEl.classList.add('ns-first-open');
      setTimeout(function () { bodyEl.classList.remove('ns-first-open'); }, 500);
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }
    function scheduleGreeting() {
      if (greetingShown || !GREETING) return;
      if (bodyEl.querySelector('.ns-msg-row.in')) { greetingShown = true; return; }
      if (greetingTimer) clearTimeout(greetingTimer);
      greetingTimer = setTimeout(function () {
        if (root.getAttribute('data-open') !== 'true') return;
        if (bodyEl.querySelector('.ns-msg-row.in')) return;
        greetingShown = true;
        addMessage(GREETING, 'in');
      }, 1000);
    }

    function nowHM() {
      var d = new Date();
      var hh = d.getHours().toString();
      var mm = d.getMinutes().toString();
      if (hh.length < 2) hh = '0' + hh;
      if (mm.length < 2) mm = '0' + mm;
      return hh + ':' + mm;
    }

    function addMessage(text, side) {
      removeTyping();
      var row = document.createElement('div');
      row.className = 'ns-msg-row ns-fresh ' + side;
      if (side === 'in') {
        var av = document.createElement('div');
        av.className = 'ns-msg-avatar';
        av.textContent = AVATAR_INITIAL;
        row.appendChild(av);
      }
      var bub = document.createElement('div');
      bub.className = 'ns-bubble ' + side;
      if (side === 'in') bub.innerHTML = renderMarkdown(text);
      else bub.textContent = text;
      row.appendChild(bub);
      bodyEl.appendChild(row);

      var meta = document.createElement('div');
      meta.className = 'ns-meta-row ns-fresh';
      meta.style.textAlign = side === 'out' ? 'right' : 'left';
      var who = side === 'out' ? t('delivered') : escapeHtml(BRAND_NAME);
      meta.innerHTML = '<span class="ns-meta">' + who + ' · ' + nowHM() + '</span>';
      bodyEl.appendChild(meta);

      requestAnimationFrame(function () {
        bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' });
      });
      setTimeout(function () {
        row.classList.remove('ns-fresh');
        meta.classList.remove('ns-fresh');
      }, 800);
      return { row: row, bubble: bub, meta: meta };
    }

    function showTyping() {
      if (bodyEl.querySelector('#typing-row')) return;
      var row = document.createElement('div');
      row.className = 'ns-msg-row in ns-fresh';
      row.id = 'typing-row';
      row.innerHTML =
        '<div class="ns-msg-avatar">' + escapeHtml(AVATAR_INITIAL) + '</div>' +
        '<div class="ns-typing"><span></span><span></span><span></span></div>';
      bodyEl.appendChild(row);
      requestAnimationFrame(function () {
        bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' });
      });
    }
    function removeTyping() {
      var t = bodyEl.querySelector('#typing-row');
      if (t) t.remove();
    }

    function autosize() {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(110, inputEl.scrollHeight) + 'px';
      updateSendState();
    }
    function updateSendState() {
      var len = inputEl.value.trim().length;
      var over = len > MAX_CHARS;
      inputWrapEl.classList.toggle('ns-over', over);
      sendEl.disabled = sending || len === 0 || over;
    }

    function showModal(message) {
      modalTextEl.textContent = message;
      modalBackdropEl.classList.remove('ns-hidden');
      modalOkEl.focus();
    }
    function hideModal() { modalBackdropEl.classList.add('ns-hidden'); }
    function humanizeError(code, detail) {
      switch (code) {
        case 'message_too_long': return t('errTooLong');
        case 'conversation_too_long':
        case 'too_many_turns': return t('errTooManyTurns');
        default: return detail || t('errGeneric');
      }
    }

    function doSend() {
      if (sending) return;
      var text = inputEl.value.trim();
      if (!text) return;
      if (text.length > MAX_CHARS) { showModal(t('errTooLong')); return; }
      sending = true;
      var userMsg = addMessage(text, 'out');
      inputEl.value = '';
      autosize();
      wasOver = false;

      var typingTimer = setTimeout(showTyping, 300);
      var assistantBubble = null;
      var streamedText = '';

      var body = { message: text };
      if (sessionId) body.sessionId = sessionId;
      else body.context = { language: LANGUAGE, country: COUNTRY };

      fetch(STREAM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + TOKEN,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          if (!res.ok) {
            return res.json()
              .then(function (data) { throw { status: res.status, data: data }; })
              .catch(function (e) {
                if (e && typeof e === 'object' && 'status' in e) throw e;
                throw { status: res.status, data: null };
              });
          }
          var sid = res.headers.get('X-Conversation-Id');
          if (sid) {
            sessionId = sid;
          }
          if (!res.body) throw new Error('no_stream_body');
          return consumeStream(res.body);
        })
        .then(function () {
          clearTimeout(typingTimer);
          removeTyping();
          sending = false;
          updateSendState();
        })
        .catch(function (err) {
          clearTimeout(typingTimer);
          removeTyping();
          if (!assistantBubble) {
            // No token streamed — drop the optimistic user row so retry is clean.
            if (userMsg.row && userMsg.row.parentNode) userMsg.row.remove();
            if (userMsg.meta && userMsg.meta.parentNode) userMsg.meta.remove();
          }
          sending = false;
          updateSendState();
          if (err && typeof err === 'object' && 'status' in err) {
            var status = err.status;
            var data = err.data;
            if (status === 429) {
              var retry = (data && data.retryAfterSeconds) || 0;
              showModal(t('errRateLimit', { n: retry }));
            } else if (status === 401) {
              showModal(t('errUnconfigured'));
            } else if (status === 400 && data && data.error) {
              showModal(humanizeError(data.error, data.detail));
            } else {
              showModal(t('errGeneric'));
            }
          } else {
            showModal(t('errNetwork'));
          }
        });

      function consumeStream(body) {
        var reader = body.getReader();
        var decoder = new TextDecoder();
        var buf = '';
        return new Promise(function (resolve, reject) {
          function pump() {
            reader.read().then(function (r) {
              if (r.done) { flushEvents(buf, true); resolve(); return; }
              buf += decoder.decode(r.value, { stream: true });
              buf = flushEvents(buf, false);
              pump();
            }, reject);
          }
          pump();
        });
      }
      function flushEvents(buf, isFinal) {
        var idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          var raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          handleEvent(raw);
        }
        if (isFinal && buf.trim()) { handleEvent(buf); buf = ''; }
        return buf;
      }
      function handleEvent(raw) {
        var lines = raw.split('\n');
        var dataStr = '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('data: ') === 0) dataStr += line.slice(6);
          else if (line.indexOf('data:') === 0) dataStr += line.slice(5);
        }
        if (!dataStr) return;
        var parsed;
        try { parsed = JSON.parse(dataStr); } catch (_) { return; }
        if (parsed && parsed.type === 'text-delta' && typeof parsed.delta === 'string') {
          clearTimeout(typingTimer);
          removeTyping();
          if (!assistantBubble) {
            var added = addMessage(parsed.delta, 'in');
            assistantBubble = added.bubble;
            streamedText = parsed.delta;
          } else {
            streamedText += parsed.delta;
            assistantBubble.innerHTML = renderMarkdown(streamedText);
            requestAnimationFrame(function () {
              bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' });
            });
          }
        }
      }
    }

    // ----- Wire events -----
    launcher.addEventListener('click', function () {
      setOpen(root.getAttribute('data-open') !== 'true');
    });
    btnClose.addEventListener('click', function () { setOpen(false); });
    inputEl.addEventListener('input', function () {
      var len = inputEl.value.trim().length;
      var nowOver = len > MAX_CHARS;
      if (nowOver && !wasOver) showModal(t('errTooLong'));
      wasOver = nowOver;
      autosize();
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });
    sendEl.addEventListener('click', function (e) {
      e.preventDefault();
      doSend();
    });
    modalOkEl.addEventListener('click', hideModal);
    modalBackdropEl.addEventListener('click', function (e) {
      if (e.target === modalBackdropEl) hideModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.getAttribute('data-open') === 'true') {
        if (!modalBackdropEl.classList.contains('ns-hidden')) hideModal();
        else setOpen(false);
      }
    });

    autosize();
    if (inlineConfig.defaultOpen === true) setOpen(true);

    // ----- Live-tweak channel (dashboard → widget) -----
    // The /preview/chat dashboard hosts this widget in an iframe and
    // postMessages token updates as the merchant drags sliders / picks
    // colours. We apply them straight to .ns-root + the few text fields
    // so the preview re-renders instantly without a full reload.
    window.addEventListener('message', function (e) {
      var d = e && e.data;
      if (!d || d.type !== 'nordic-support:tokens') return;
      var tk = d.tokens || {};
      var attrMap = {
        theme: 'data-theme',
        shadow: 'data-shadow',
        launcherShape: 'data-launcher-shape',
        sendShape: 'data-send-shape',
        sendFill: 'data-send-fill',
        iconStyle: 'data-icon-style',
      };
      for (var key in attrMap) {
        if (tk[key] != null) root.setAttribute(attrMap[key], tk[key]);
      }
      var cssMap = {
        primaryColor: '--ns-brand-color',
        accentColor: '--ns-brand-accent',
        launcherIconColor: '--ns-launcher-icon-color',
        launcherBgColor: '--ns-launcher-bg',
        sendIconColor: '--ns-send-icon-color',
        fontFamily: '--ns-font-family',
      };
      for (var ck in cssMap) {
        if (tk[ck] != null) root.style.setProperty(cssMap[ck], tk[ck]);
      }
      var sizePxMap = {
        width: '--ns-panel-width',
        height: '--ns-panel-height',
        launcherSize: '--ns-launcher-size',
        panelRadius: '--ns-panel-radius',
        bubbleRadius: '--ns-bubble-radius',
        fontSizeBase: '--ns-font-size-base',
      };
      for (var sk in sizePxMap) {
        if (typeof tk[sk] === 'number') root.style.setProperty(sizePxMap[sk], tk[sk] + 'px');
      }
      var surfaceMap = {
        surfaceBg: '--ns-surface-bg',
        surfaceInk: '--ns-surface-ink',
        bubbleInBg: '--ns-bubble-in-bg',
        bubbleInInk: '--ns-bubble-in-ink',
        inputBg: '--ns-input-bg',
      };
      for (var fk in surfaceMap) {
        if (tk[fk] != null) {
          if (tk[fk]) root.style.setProperty(surfaceMap[fk], tk[fk]);
          else root.style.removeProperty(surfaceMap[fk]);
        }
      }
      if (typeof tk.agentName === 'string') {
        var title = root.querySelector('#hdr-title');
        if (title) title.textContent = tk.agentName || '';
        var avatar = root.querySelector('#hdr-avatar');
        if (avatar) {
          var firstNode = avatar.firstChild;
          if (firstNode && firstNode.nodeType === 3) {
            firstNode.nodeValue = (tk.agentName || 'A').trim().charAt(0).toUpperCase() || 'A';
          }
        }
      }
      if (typeof tk.subtitle === 'string') {
        var sub = root.querySelector('#hdr-subtitle');
        if (sub) {
          sub.textContent = tk.subtitle;
          sub.style.display = tk.subtitle ? '' : 'none';
        }
      }
      if (typeof tk.placeholder === 'string' && tk.placeholder.trim()) {
        var inp = root.querySelector('#input');
        if (inp) inp.setAttribute('placeholder', tk.placeholder);
      }
      if (typeof tk.showAvatar === 'boolean') {
        var av = root.querySelector('#hdr-avatar');
        if (av) av.style.display = tk.showAvatar ? '' : 'none';
      }
      if (typeof tk.showDot === 'boolean') {
        var dot = root.querySelector('#hdr-dot');
        if (dot) dot.style.display = tk.showDot ? '' : 'none';
      }
      if (typeof tk.iconStyle === 'string') {
        var slot = root.querySelector('#icon-slot');
        if (slot) slot.innerHTML = ICONS[tk.iconStyle] || ICONS.chat_bubble;
      }
      if (typeof tk.sendIcon === 'string') {
        var sendBtn = root.querySelector('#send');
        if (sendBtn) sendBtn.innerHTML = SEND_SVG[tk.sendIcon] || SEND_SVG.arrow_up;
      }
    });
  }

  function pickLanguage(lang) {
    return STRING_DEFAULTS[lang] ? lang : 'sv';
  }

  // Tiny markdown renderer for assistant bubbles. Intentionally narrow:
  //   - paragraphs (separated by a blank line)
  //   - bulleted lists (lines starting with "· ", "– ", "- ", or "* ")
  //   - numbered lists (lines starting with "1. ", "2. ", ...)
  //   - inline links [label](url) — only http(s), mailto:, tel: allowed
  //   - line breaks inside a paragraph become <br>
  // Bold and italics are deliberately NOT supported.
  function renderMarkdown(input) {
    var src = String(input == null ? '' : input);
    var lines = src.replace(/\r\n?/g, '\n').split('\n').map(function (l) {
      return l.replace(/\s+$/, '');
    });
    var blocks = [];
    var current = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === '') {
        if (current.length) { blocks.push(current); current = []; }
      } else {
        current.push(lines[i]);
      }
    }
    if (current.length) blocks.push(current);

    var BULLET_RE = /^\s*(?:[·•\-\*–])\s+(.*)$/;
    var NUM_RE = /^\s*\d+[.)]\s+(.*)$/;

    var out = [];
    for (var b = 0; b < blocks.length; b++) {
      var block = blocks[b];
      var allBullets = block.every(function (l) { return BULLET_RE.test(l); });
      var allNumbered = block.every(function (l) { return NUM_RE.test(l); });
      if (allBullets) {
        out.push('<ul>' + block.map(function (l) {
          return '<li>' + inline(l.replace(BULLET_RE, '$1')) + '</li>';
        }).join('') + '</ul>');
      } else if (allNumbered) {
        out.push('<ol>' + block.map(function (l) {
          return '<li>' + inline(l.replace(NUM_RE, '$1')) + '</li>';
        }).join('') + '</ol>');
      } else {
        out.push('<p>' + block.map(inline).join('<br>') + '</p>');
      }
    }
    return out.join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function inline(line) {
    var parts = [];
    var rest = line;
    var LINK_RE = /\[([^\]]+)\]\(([^\s)]+)\)/;
    while (true) {
      var m = LINK_RE.exec(rest);
      if (!m) { parts.push(escapeHtml(rest)); break; }
      parts.push(escapeHtml(rest.slice(0, m.index)));
      var label = m[1];
      var url = m[2];
      if (/^(https?:|mailto:|tel:)/i.test(url)) {
        parts.push(
          '<a href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer noopener">' +
          escapeHtml(label) +
          '</a>'
        );
      } else {
        parts.push(escapeHtml(label));
      }
      rest = rest.slice(m.index + m[0].length);
    }
    return parts.join('');
  }
})();
