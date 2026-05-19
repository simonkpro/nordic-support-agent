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
 * Everything else (brand color, agent name, language, custom strings) is
 * fetched from /api/widget-config?token=... on init so merchants can edit
 * settings in the embedded admin without re-deploying their theme.
 *
 * Inline overrides on window.NORDIC_SUPPORT still win as an escape hatch
 * for one-off cases (e.g. a campaign landing page that needs a different
 * brand color than the rest of the store).
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
  // The explicit path lets advanced merchants pre-mint long-lived tokens or
  // override brand/text per page. The one-liner is what we paste into the
  // merchant's dashboard "Install" card.
  var inlineConfig = /** @type {any} */ (window.NORDIC_SUPPORT) || {};
  var TOKEN;
  var API_URL;
  var CONFIG_URL;
  var STREAM_URL;
  // Populated when the widget boots via <script data-assistant>; used
  // to build the /privacy self-service link in the footer. Inline
  // (window.NORDIC_SUPPORT) configs leave this null, which hides the
  // footer link — the merchant can re-enable by passing privacyUrl.
  var ASSISTANT_ID = null;
  var SCRIPT_ORIGIN = null;

  resolveConfig(inlineConfig).then(continueBoot, function (err) {
    console.warn('[nordic-support]', (err && err.message) || String(err));
  });

  function resolveConfig(inline) {
    if (typeof inline.token === 'string' && typeof inline.apiUrl === 'string') {
      return Promise.resolve({ token: inline.token, apiUrl: inline.apiUrl });
    }
    // Find the script tag carrying data-assistant. We don't rely on
    // document.currentScript because it's null for async/defer scripts.
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
    try {
      origin = new URL(scriptTag.src).origin;
    } catch (_) {
      return Promise.reject(new Error('cannot resolve script origin'));
    }
    if (!assistantId) return Promise.reject(new Error('empty data-assistant'));
    ASSISTANT_ID = assistantId;
    SCRIPT_ORIGIN = origin;
    return mintPublicToken(origin, assistantId, null);
  }

  // Two-phase token fetch with optional Cloudflare Turnstile retry.
  // First attempt has no Turnstile token; if the server requires one,
  // it replies 403 + { error: 'bot_check_required', siteKey }. We load
  // Turnstile, solve invisibly, retry once. We never retry more than once
  // — a failed second attempt becomes a hard error (the merchant has
  // misconfigured Turnstile or the user is genuinely flagged).
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
        throw new Error(
          (data && data.error) || 'public-token http_' + res.status,
        );
      });
    });
  }

  // Loads Cloudflare Turnstile's API and runs an invisible challenge.
  // Resolves with a token on success; rejects on script load failure,
  // timeout, or user being flagged. We render into a hidden container
  // so the host page never sees Cloudflare branding.
  function solveTurnstile(siteKey) {
    return loadTurnstileApi().then(function () {
      return new Promise(function (resolve, reject) {
        var container = document.createElement('div');
        container.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;';
        document.body.appendChild(container);
        var cleanup = function () {
          try { document.body.removeChild(container); } catch (_) {}
        };
        try {
          window.turnstile.render(container, {
            sitekey: siteKey,
            size: 'invisible',
            callback: function (token) { cleanup(); resolve(token); },
            'error-callback': function (e) {
              cleanup();
              reject(new Error('turnstile-error: ' + (e || 'unknown')));
            },
            'timeout-callback': function () {
              cleanup();
              reject(new Error('turnstile-timeout'));
            },
          });
        } catch (e) {
          cleanup();
          reject(e);
        }
      });
    });
  }

  function loadTurnstileApi() {
    if (window.turnstile) return Promise.resolve();
    if (window.__NORDIC_TURNSTILE_LOADING__) return window.__NORDIC_TURNSTILE_LOADING__;
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
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
    // Streaming endpoint — token-by-token via SSE-style UI message protocol.
    // If the merchant's apiUrl already points at /api/chat/stream we leave it
    // alone; otherwise we map /api/chat → /api/chat/stream.
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
    },
    en: {
      placeholder: 'Type your question…',
      thinking: 'Thinking…',
      sendLabel: 'Send',
      closeLabel: 'Close',
      openLabel: 'Open support chat',
      errRateLimit: 'Too many messages. Try again in {n} seconds.',
      errUnconfigured: 'Chat is not configured correctly. Please contact the store.',
      errGeneric: 'Couldn’t send. Please try again in a moment.',
      errNetwork: 'Network problem. Please check your connection and try again.',
      errTooLong: 'Your message is too long. Please shorten it and try again.',
      errTooManyTurns: 'This conversation got long. Start a new one to continue.',
      charCount: '{n}/{max} characters',
      privacyLabel: 'Privacy & data',
      todayLabel: 'Today',
      poweredBy: 'Powered by',
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
    },
  };

  // Note: fetchRemoteConfig is kicked off from continueBoot above, once
  // TOKEN / CONFIG_URL are resolved.
  function fetchRemoteConfig() {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error('timeout'));
      }, 2500);
      fetch(CONFIG_URL + '?token=' + encodeURIComponent(TOKEN), {
        method: 'GET',
        credentials: 'omit',
      })
        .then(function (res) {
          clearTimeout(timer);
          if (!res.ok) return reject(new Error('http_' + res.status));
          res.json().then(resolve, reject);
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function init(remote) {
    // Resolve final config: defaults < remote < inline.
    var brandFromRemote = (remote && remote.brand) || {};
    var brandFromInline = inlineConfig.brand || {};
    var BRAND_COLOR = brandFromInline.color || brandFromRemote.color || '#1f2937';
    var BRAND_ACCENT =
      brandFromInline.accentColor || brandFromRemote.accentColor || BRAND_COLOR;
    var BRAND_NAME =
      brandFromInline.name ||
      (remote && remote.agent && remote.agent.name) ||
      'Support';
    // Greeting shown as a synthetic first bot message when the conversation
    // is empty. Empty string → nothing rendered (don't fall back so the
    // merchant can deliberately turn it off).
    var GREETING =
      (remote && remote.agent && typeof remote.agent.greeting === 'string'
        ? remote.agent.greeting.trim()
        : '');
    var LANGUAGE = pickLanguage(
      inlineConfig.language || (remote && remote.language) || 'sv',
    );
    var COUNTRY = inlineConfig.country || (remote && remote.country) || 'SE';

    var strings = Object.assign({}, STRING_DEFAULTS[LANGUAGE]);
    // Per-assistant error phrases from the server take precedence over
    // locale defaults — empty strings mean "use the default".
    var remoteErrors = (remote && remote.agent && remote.agent.errorPhrases) || {};
    var ERR_MAP = {
      generic: 'errGeneric',
      network: 'errNetwork',
      rateLimit: 'errRateLimit',
      tooLong: 'errTooLong',
      tooManyTurns: 'errTooManyTurns',
      unconfigured: 'errUnconfigured',
    };
    for (var ek in ERR_MAP) {
      if (typeof remoteErrors[ek] === 'string' && remoteErrors[ek].trim()) {
        strings[ERR_MAP[ek]] = remoteErrors[ek];
      }
    }
    // Inline NORDIC_SUPPORT.text still wins as the per-page escape hatch.
    if (inlineConfig.text && typeof inlineConfig.text === 'object') {
      for (var k in inlineConfig.text) {
        if (typeof inlineConfig.text[k] === 'string') strings[k] = inlineConfig.text[k];
      }
    }

    // === Widget appearance (from /api/widget-config -> remote.widget) ====
    var w = (remote && remote.widget) || {};
    var ICON_STYLE = w.iconStyle || 'chat_bubble';
    var LAUNCHER_SHAPE = w.launcherShape || 'circle';
    var LAUNCHER_ICON_COLOR = w.launcherIconColor || '#ffffff';
    var SEND_ICON = w.sendIcon || 'arrow_up';
    var SEND_SHAPE = w.sendShape || 'circle';
    var SEND_FILL = w.sendFill || 'solid';
    var SEND_ICON_COLOR = w.sendIconColor || '#ffffff';
    var PLACEHOLDER =
      (w.placeholder && String(w.placeholder).trim()) || strings.placeholder;
    var PANEL_W = typeof w.width === 'number' ? w.width : 380;
    var PANEL_H = typeof w.height === 'number' ? w.height : 600;
    var AVATAR_INITIAL = (BRAND_NAME || 'A').trim().charAt(0).toUpperCase() || 'A';
    var SUBTITLE = (typeof w.subtitle === 'string' ? w.subtitle.trim() : '') || '';
    var THEME = w.theme === 'dark' ? 'dark' : 'light';
    var SHADOW = (w.shadow === 'none' || w.shadow === 'subtle' || w.shadow === 'strong')
      ? w.shadow
      : 'medium';
    // Surface overrides — each empty string falls back to the theme default
    // resolved in CSS. Anything truthy wins via inline style on .ns-root.
    var SURFACES = (w.surfaces && typeof w.surfaces === 'object') ? w.surfaces : {};

    // SVG icon catalog — kept tiny and inline so the widget stays one file.
    var LAUNCHER_SVG = {
      bot:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
      chat_bubble:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
      sparkle:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z"/></svg>',
      help:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    };
    var SEND_SVG = {
      arrow_up:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
      arrow_right:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
      send_plane:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    };
    function t(key, vars) {
      var s = strings[key] || '';
      if (!vars) return s;
      return s.replace(/\{(\w+)\}/g, function (_, name) {
        return vars[name] != null ? String(vars[name]) : '';
      });
    }

    function escapeAttr(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    // ---- State ----
    var sessionId = null;
    try {
      sessionId = localStorage.getItem(STORAGE_KEY);
    } catch (_) {}
    var sending = false;
    var open = false;
    // Greeting appears ~1s after the panel opens (set by the open handler).
    // Reset between sessions so re-opening replays the small delay.
    var greetingShown = false;
    var greetingTimer = null;
    var wasOver = false;
    var firstOpenDone = false;

    // ---- Styles ----
    // Tokenised, scoped under .ns-root. All visual customisation flows
    // through CSS custom properties set as inline style on the root, and
    // through data-* attributes for the discrete variants (shape, fill,
    // theme, etc.). Mirrors the Claude Design handoff at /tmp/design-fetch.
    var STYLE = [
      // Defensive reset against host CSS bleed.
      '.ns-root, .ns-root *, .ns-root *::before, .ns-root *::after { box-sizing: border-box; margin: 0; }',
      '.ns-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: var(--ns-font-family); font-size: var(--ns-font-size-base); color: var(--ns-surface-ink); line-height: 1.45; }',
      // Token defaults — overridden by inline style on the root for
      // per-merchant brand colours and sizes.
      '.ns-root { --ns-brand-color: #1a1a1a; --ns-brand-accent: #e85d4a; --ns-launcher-icon-color: #ffffff; --ns-send-icon-color: #ffffff; --ns-panel-width: 380px; --ns-panel-height: 600px; --ns-launcher-size: 60px; --ns-panel-radius: 20px; --ns-bubble-radius: 18px; --ns-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; --ns-font-size-base: 15px; --ns-surface-bg: #ffffff; --ns-surface-ink: #18140f; --ns-surface-muted: #6b6359; --ns-surface-line: #ece5d6; --ns-bubble-in-bg: #f1ebde; --ns-bubble-in-ink: #18140f; --ns-input-bg: #faf6ee; --_typing-dot: #b5ad9d; --_shadow: 0 18px 50px -12px rgba(20,16,8,0.18), 0 4px 14px -4px rgba(20,16,8,0.08); }',
      '.ns-root[data-theme="dark"] { --ns-surface-bg: #1a1714; --ns-surface-ink: #f5efe2; --ns-surface-muted: #98907f; --ns-surface-line: #2c2620; --ns-bubble-in-bg: #2a241d; --ns-bubble-in-ink: #f5efe2; --ns-input-bg: #221d18; --_typing-dot: #6b6359; --_shadow: 0 18px 50px -12px rgba(0,0,0,0.55), 0 4px 14px -4px rgba(0,0,0,0.35); }',
      '.ns-root[data-shadow="none"]   { --_shadow: none; }',
      '.ns-root[data-shadow="subtle"] { --_shadow: 0 4px 14px -4px rgba(20,16,8,0.10); }',
      '.ns-root[data-shadow="medium"] { --_shadow: 0 18px 50px -12px rgba(20,16,8,0.18), 0 4px 14px -4px rgba(20,16,8,0.08); }',
      '.ns-root[data-shadow="strong"] { --_shadow: 0 32px 80px -16px rgba(20,16,8,0.36), 0 10px 30px -8px rgba(20,16,8,0.16); }',
      '.ns-root button { font: inherit; cursor: pointer; background: transparent; border: 0; color: inherit; padding: 0; }',
      '.ns-root input, .ns-root textarea { font: inherit; color: inherit; background: transparent; border: 0; outline: none; padding: 0; -webkit-appearance: none; appearance: none; }',
      // ---- Launcher ----
      '.ns-launcher { position: absolute; right: 24px; bottom: 24px; width: var(--ns-launcher-size); height: var(--ns-launcher-size); background: var(--ns-brand-color); color: var(--ns-launcher-icon-color); box-shadow: var(--_shadow); pointer-events: auto; display: grid; place-items: center; transition: transform 220ms cubic-bezier(.22,1,.36,1), box-shadow 220ms, border-radius 280ms cubic-bezier(.22,1,.36,1); }',
      '.ns-launcher:hover { transform: translateY(-2px) scale(1.04); }',
      '.ns-launcher:active { transform: translateY(0) scale(0.96); }',
      '.ns-root[data-launcher-shape="circle"]  .ns-launcher { border-radius: 9999px; }',
      '.ns-root[data-launcher-shape="rounded"] .ns-launcher { border-radius: 16px; }',
      '.ns-root[data-launcher-shape="square"]  .ns-launcher { border-radius: 4px; }',
      '.ns-launcher-icon { grid-area: 1 / 1; width: 54%; height: 54%; display: grid; place-items: center; color: inherit; transition: opacity 220ms cubic-bezier(.22,1,.36,1), transform 280ms cubic-bezier(.22,1,.36,1); transform-origin: 50% 50%; }',
      '.ns-launcher-icon svg { width: 100%; height: 100%; display: block; color: inherit; }',
      '.ns-root[data-open="false"] .ns-launcher-icon.icon-default { opacity: 1; transform: rotate(0deg) scale(1); }',
      '.ns-root[data-open="false"] .ns-launcher-icon.icon-close   { opacity: 0; transform: rotate(-45deg) scale(0.6); pointer-events: none; }',
      '.ns-root[data-open="true"]  .ns-launcher-icon.icon-default { opacity: 0; transform: rotate(45deg) scale(0.6); pointer-events: none; }',
      '.ns-root[data-open="true"]  .ns-launcher-icon.icon-close   { opacity: 1; transform: rotate(0deg) scale(1); }',
      // ---- Panel ----
      '.ns-panel { position: absolute; right: 24px; bottom: calc(24px + var(--ns-launcher-size) + 14px); width: var(--ns-panel-width); height: var(--ns-panel-height); max-height: calc(100vh - 48px - var(--ns-launcher-size) - 14px); background: var(--ns-surface-bg); color: var(--ns-surface-ink); border-radius: var(--ns-panel-radius); box-shadow: var(--_shadow); display: flex; flex-direction: column; overflow: hidden; pointer-events: auto; transform-origin: 100% 100%; transition: opacity 260ms cubic-bezier(.22,1,.36,1), transform 360ms cubic-bezier(.22,1,.36,1), visibility 0s linear 0s; will-change: transform, opacity; }',
      '.ns-root[data-open="false"] .ns-panel { opacity: 0; transform: translateY(16px) scale(0.94); pointer-events: none; visibility: hidden; transition: opacity 200ms cubic-bezier(.4,0,1,1), transform 240ms cubic-bezier(.4,0,1,1), visibility 0s linear 240ms; }',
      // ---- Header ----
      '.ns-header { display: flex; align-items: center; gap: 12px; padding: 14px 14px 14px 16px; background: var(--ns-brand-color); color: #fff; }',
      '.ns-avatar { width: 36px; height: 36px; border-radius: 999px; background: color-mix(in srgb, #fff 18%, var(--ns-brand-color)); color: #fff; display: grid; place-items: center; font-size: 14px; font-weight: 600; position: relative; flex: 0 0 auto; }',
      '.ns-title-block { flex: 1; min-width: 0; }',
      '.ns-title { font-size: 14.5px; font-weight: 600; letter-spacing: -0.005em; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.ns-subtitle { font-size: 12px; opacity: 0.72; line-height: 1.3; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.ns-subtitle:empty { display: none; }',
      '.ns-header-actions { display: flex; gap: 2px; flex: 0 0 auto; }',
      '.ns-icon-btn { width: 32px; height: 32px; border-radius: 8px; color: #fff; display: grid; place-items: center; opacity: 0.8; transition: opacity 120ms, background 120ms; }',
      '.ns-icon-btn:hover { opacity: 1; background: rgba(255,255,255,0.12); }',
      '.ns-icon-btn svg { width: 16px; height: 16px; }',
      // ---- Body ----
      '.ns-body { flex: 1; overflow-y: auto; padding: 18px 16px 8px; display: flex; flex-direction: column; gap: 6px; background: var(--ns-surface-bg); scrollbar-width: thin; scrollbar-color: var(--ns-surface-line) transparent; }',
      '.ns-body::-webkit-scrollbar { width: 8px; }',
      '.ns-body::-webkit-scrollbar-thumb { background: var(--ns-surface-line); border-radius: 4px; }',
      '.ns-day { text-align: center; font-size: 11px; color: var(--ns-surface-muted); padding: 6px 0 10px; text-transform: uppercase; letter-spacing: 0.1em; }',
      '.ns-msg-row { display: flex; align-items: flex-end; gap: 8px; max-width: 100%; }',
      '.ns-msg-row.in  { justify-content: flex-start; }',
      '.ns-msg-row.out { justify-content: flex-end; }',
      '.ns-msg-avatar { width: 24px; height: 24px; border-radius: 999px; background: var(--ns-bubble-in-bg); color: var(--ns-bubble-in-ink); display: grid; place-items: center; font-size: 10.5px; font-weight: 600; flex: 0 0 auto; margin-bottom: 2px; }',
      '.ns-bubble { padding: 10px 14px; border-radius: var(--ns-bubble-radius); font-size: var(--ns-font-size-base); line-height: 1.45; max-width: 78%; word-wrap: break-word; }',
      // Markdown stays flat (the system prompt forbids bold/italic).
      '.ns-bubble strong, .ns-bubble b, .ns-bubble em, .ns-bubble i { font-weight: inherit; font-style: normal; }',
      '.ns-bubble.in { background: var(--ns-bubble-in-bg); color: var(--ns-bubble-in-ink); border-bottom-left-radius: 6px; }',
      '.ns-bubble.out { background: var(--ns-brand-color); color: #fff; border-bottom-right-radius: 6px; }',
      '.ns-bubble p { margin: 0 0 6px 0; }',
      '.ns-bubble p:last-child { margin-bottom: 0; }',
      '.ns-bubble ul, .ns-bubble ol { margin: 4px 0 6px 0; padding-left: 18px; }',
      '.ns-bubble li { margin: 2px 0; }',
      '.ns-bubble a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }',
      '.ns-bubble a:hover { opacity: 0.85; }',
      // Typing indicator (replaces the old text "Thinking…")
      '.ns-typing { background: var(--ns-bubble-in-bg); border-radius: var(--ns-bubble-radius); border-bottom-left-radius: 6px; padding: 12px 14px; display: inline-flex; gap: 4px; align-items: center; }',
      '.ns-typing span { width: 6px; height: 6px; border-radius: 999px; background: var(--_typing-dot); animation: ns-bounce 1.2s infinite ease-in-out; }',
      '.ns-typing span:nth-child(2) { animation-delay: 0.15s; }',
      '.ns-typing span:nth-child(3) { animation-delay: 0.30s; }',
      '@keyframes ns-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.55; } 30% { transform: translateY(-4px); opacity: 1; } }',
      // ---- Message entrance animations (incoming unfolds, outgoing lifts) ----
      '@keyframes ns-out-bubble { 0% { opacity: 0; transform: translateY(18px) scale(0.94); } 100% { opacity: 1; transform: translateY(0) scale(1); } }',
      '@keyframes ns-in-bubble  { 0% { opacity: 0; transform: translateY(6px) scale(0.96); clip-path: inset(85% 80% 0% 0% round var(--ns-bubble-radius)); } 55% { opacity: 1; } 100% { opacity: 1; transform: translateY(0) scale(1); clip-path: inset(0 0 0 0 round var(--ns-bubble-radius)); } }',
      '@keyframes ns-typing-in  { 0% { opacity: 0; transform: translateY(4px) scale(0.85); } 100% { opacity: 1; transform: translateY(0) scale(1); } }',
      '@keyframes ns-avatar-pop { 0% { opacity: 0; transform: scale(0.4); } 70% { opacity: 1; transform: scale(1.08); } 100% { opacity: 1; transform: scale(1); } }',
      '.ns-msg-row.in  .ns-bubble, .ns-msg-row.in  .ns-typing { transform-origin: 0% 100%; }',
      '.ns-msg-row.out .ns-bubble { transform-origin: 100% 100%; }',
      '.ns-msg-row.in.ns-fresh  .ns-bubble  { animation: ns-in-bubble  520ms cubic-bezier(.22, 1, .36, 1) both; }',
      '.ns-msg-row.out.ns-fresh .ns-bubble  { animation: ns-out-bubble 340ms cubic-bezier(.2, .9, .25, 1.15) both; }',
      '.ns-fresh .ns-typing                 { animation: ns-typing-in 280ms cubic-bezier(.22, 1, .36, 1) both; }',
      '.ns-fresh .ns-msg-avatar             { animation: ns-avatar-pop 380ms cubic-bezier(.34, 1.4, .5, 1) both; animation-delay: -80ms; }',
      // First-open: fade the whole body up as one piece (don\'t cascade).
      '@keyframes ns-first-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }',
      '.ns-body.ns-first-open { animation: ns-first-fade 360ms cubic-bezier(.22,1,.36,1) both; }',
      '@media (prefers-reduced-motion: reduce) { .ns-msg-row.ns-fresh .ns-bubble, .ns-fresh .ns-typing, .ns-fresh .ns-msg-avatar, .ns-body.ns-first-open { animation: none; } }',
      // ---- Composer ----
      '.ns-composer { border-top: 1px solid var(--ns-surface-line); padding: 10px 12px 12px; background: var(--ns-surface-bg); }',
      '.ns-input-wrap { display: flex; align-items: flex-end; gap: 8px; background: var(--ns-input-bg); border: 1px solid var(--ns-surface-line); border-radius: 16px; padding: 6px 6px 6px 14px; transition: border-color 140ms; }',
      '.ns-input-wrap:focus-within { border-color: var(--ns-brand-accent); }',
      '.ns-input-wrap.ns-over { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.10); }',
      '.ns-input { flex: 1; resize: none; padding: 8px 0; max-height: 110px; line-height: 1.4; }',
      '.ns-input::placeholder { color: var(--ns-surface-muted); }',
      '.ns-send { width: 36px; height: 36px; background: var(--ns-brand-color); color: var(--ns-send-icon-color); display: grid; place-items: center; flex: 0 0 auto; transition: transform 140ms, opacity 140ms; }',
      '.ns-send:disabled { opacity: 0.4; cursor: not-allowed; }',
      '.ns-send:not(:disabled):hover { transform: translateY(-1px); }',
      '.ns-send svg { width: 16px; height: 16px; }',
      '.ns-root[data-send-shape="circle"]  .ns-send { border-radius: 9999px; }',
      '.ns-root[data-send-shape="rounded"] .ns-send { border-radius: 10px; }',
      '.ns-root[data-send-shape="square"]  .ns-send { border-radius: 4px; }',
      '.ns-root[data-send-fill="solid"]   .ns-send { background: var(--ns-brand-color); color: var(--ns-send-icon-color); border: 1px solid transparent; }',
      '.ns-root[data-send-fill="outline"] .ns-send { background: transparent; color: var(--ns-brand-color); border: 1.5px solid var(--ns-brand-color); }',
      '.ns-root[data-send-fill="ghost"]   .ns-send { background: transparent; color: var(--ns-brand-color); border: 0; }',
      '.ns-root[data-theme="dark"][data-send-fill="outline"] .ns-send { color: #fff; border-color: rgba(255,255,255,0.5); }',
      '.ns-root[data-theme="dark"][data-send-fill="ghost"]   .ns-send { color: #fff; }',
      // Foot (privacy link / powered-by attribution)
      '.ns-foot { text-align: center; font-size: 10.5px; color: var(--ns-surface-muted); padding: 6px 0 2px; letter-spacing: 0.02em; }',
      '.ns-foot a { color: inherit; text-decoration: none; }',
      '.ns-foot a:hover { text-decoration: underline; color: var(--ns-surface-ink); }',
      '.ns-foot b { color: var(--ns-surface-ink); font-weight: 500; }',
      // ---- Modal (error toasts) ----
      '.ns-modal-backdrop { position: absolute; inset: 0; background: rgba(17,24,39,0.45); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 1; }',
      '.ns-modal-backdrop.ns-hidden { display: none; }',
      '.ns-modal { background: var(--ns-surface-bg); color: var(--ns-surface-ink); border-radius: 12px; padding: 20px; max-width: 280px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); display: flex; flex-direction: column; gap: 16px; }',
      '.ns-modal-icon { width: 32px; height: 32px; border-radius: 50%; background: #fee2e2; color: #dc2626; display: inline-flex; align-items: center; justify-content: center; align-self: center; flex-shrink: 0; }',
      '.ns-modal-icon svg { width: 18px; height: 18px; display: block; }',
      '.ns-modal-text { font-size: 14px; line-height: 1.5; text-align: center; }',
      '.ns-modal-ok { align-self: center; padding: 8px 20px; height: 36px; background: var(--ns-brand-color); color: #fff; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; min-width: 80px; display: inline-flex; align-items: center; justify-content: center; }',
      '.ns-modal-ok:hover { opacity: 0.9; }',
      // ---- Mobile fullscreen ----
      '@media (max-width: 480px) { .ns-panel { right: 0; left: 0; bottom: 0; top: 0; width: 100%; height: 100%; max-height: 100%; border-radius: 0; } .ns-launcher { right: 16px; bottom: 16px; } .ns-root[data-open="true"] .ns-launcher { display: none; } }',
    ].join('\n');

    // Shadow DOM isolation. A single host element on document.body owns the
    // widget's stylesheet AND all DOM. Host-page CSS cannot bleed in; our
    // styles cannot leak out. `all: initial` resets inherited values on the
    // host (font, color, etc.) so the host's stacking/layout context is the
    // browser default. `display: contents` keeps the host out of layout —
    // children use position:fixed and are viewport-anchored either way.
    var host = document.createElement('div');
    host.setAttribute('data-nordic-support', '');
    host.style.cssText = 'all: initial; display: contents;';
    var shadow = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);

    var root = document.createElement('div');
    root.className = 'ns-root';
    root.setAttribute('data-open', 'false');
    root.setAttribute('data-theme', THEME);
    root.setAttribute('data-shadow', SHADOW);
    root.setAttribute('data-launcher-shape', LAUNCHER_SHAPE);
    root.setAttribute('data-send-shape', SEND_SHAPE);
    root.setAttribute('data-send-fill', SEND_FILL);
    root.setAttribute('data-icon-style', ICON_STYLE);
    // Per-tenant tokens. Sizes and colours are set as CSS custom
    // properties on the root so the design CSS can read them uniformly.
    root.style.setProperty('--ns-brand-color', BRAND_COLOR);
    root.style.setProperty('--ns-brand-accent', BRAND_ACCENT);
    root.style.setProperty('--ns-launcher-icon-color', LAUNCHER_ICON_COLOR);
    root.style.setProperty('--ns-send-icon-color', SEND_ICON_COLOR);
    root.style.setProperty('--ns-panel-width', PANEL_W + 'px');
    root.style.setProperty('--ns-panel-height', PANEL_H + 'px');
    // Surface overrides — set only when the merchant provided a value, so
    // unset entries fall back to the theme's CSS defaults.
    if (SURFACES.bg)          root.style.setProperty('--ns-surface-bg', SURFACES.bg);
    if (SURFACES.ink)         root.style.setProperty('--ns-surface-ink', SURFACES.ink);
    if (SURFACES.bubbleInBg)  root.style.setProperty('--ns-bubble-in-bg', SURFACES.bubbleInBg);
    if (SURFACES.bubbleInInk) root.style.setProperty('--ns-bubble-in-ink', SURFACES.bubbleInInk);
    if (SURFACES.inputBg)     root.style.setProperty('--ns-input-bg', SURFACES.inputBg);

    var launcherSvg = LAUNCHER_SVG[ICON_STYLE] || LAUNCHER_SVG.chat_bubble;
    var launcher = document.createElement('button');
    launcher.className = 'ns-launcher';
    launcher.setAttribute('aria-label', t('openLabel'));
    launcher.innerHTML =
      '<span class="ns-launcher-icon icon-default">' + launcherSvg + '</span>' +
      '<span class="ns-launcher-icon icon-close" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      '</span>';

    // Foot content depends on whether we can link to /privacy (only when
    // the widget booted from a <script data-assistant=…> install, which
    // sets ASSISTANT_ID + SCRIPT_ORIGIN). Inline-token installs fall back
    // to a "Powered by <brand>" attribution.
    var footHtml;
    if (ASSISTANT_ID && SCRIPT_ORIGIN) {
      var privacyHref =
        SCRIPT_ORIGIN +
        '/privacy?a=' +
        encodeURIComponent(ASSISTANT_ID) +
        '&lang=' +
        encodeURIComponent(LANGUAGE);
      footHtml =
        '<a href="' + escapeAttr(privacyHref) + '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(t('privacyLabel')) +
        '</a>';
    } else {
      footHtml = escapeHtml(t('poweredBy')) + ' <b>' + escapeHtml(BRAND_NAME) + '</b>';
    }

    var panel = document.createElement('div');
    panel.className = 'ns-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', BRAND_NAME);
    panel.innerHTML =
      '<header class="ns-header">' +
      '<div class="ns-avatar">' + escapeHtml(AVATAR_INITIAL) + '</div>' +
      '<div class="ns-title-block">' +
      '<div class="ns-title"></div>' +
      '<div class="ns-subtitle"></div>' +
      '</div>' +
      '<div class="ns-header-actions">' +
      '<button type="button" class="ns-icon-btn ns-close" aria-label="' + escapeAttr(t('closeLabel')) + '">' +
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>' +
      '</button>' +
      '</div>' +
      '</header>' +
      '<div class="ns-body" role="log" aria-live="polite">' +
      '<div class="ns-day">' + escapeHtml(t('todayLabel')) + '</div>' +
      '</div>' +
      '<div class="ns-composer">' +
      '<form class="ns-form" autocomplete="off">' +
      '<div class="ns-input-wrap">' +
      '<textarea class="ns-input" rows="1" placeholder="' + escapeAttr(PLACEHOLDER) + '" aria-label="' + escapeAttr(PLACEHOLDER) + '"></textarea>' +
      '<button type="submit" class="ns-send" aria-label="' + escapeAttr(t('sendLabel')) + '" disabled>' +
      (SEND_SVG[SEND_ICON] || SEND_SVG.arrow_up) +
      '</button>' +
      '</div>' +
      '<div class="ns-foot">' + footHtml + '</div>' +
      '</form>' +
      '</div>' +
      '<div class="ns-modal-backdrop ns-hidden" role="alertdialog" aria-modal="true">' +
      '<div class="ns-modal">' +
      '<div class="ns-modal-icon">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      '</div>' +
      '<div class="ns-modal-text"></div>' +
      '<button type="button" class="ns-modal-ok">OK</button>' +
      '</div>' +
      '</div>';

    panel.querySelector('.ns-title').textContent = BRAND_NAME;
    panel.querySelector('.ns-subtitle').textContent = SUBTITLE;

    var bodyEl = panel.querySelector('.ns-body');
    var formEl = panel.querySelector('.ns-form');
    var inputWrapEl = panel.querySelector('.ns-input-wrap');
    var inputEl = panel.querySelector('.ns-input');
    var sendEl = panel.querySelector('.ns-send');
    var closeEl = panel.querySelector('.ns-close');
    var modalBackdropEl = panel.querySelector('.ns-modal-backdrop');
    var modalTextEl = panel.querySelector('.ns-modal-text');
    var modalOkEl = panel.querySelector('.ns-modal-ok');

    root.appendChild(panel);
    root.appendChild(launcher);
    shadow.appendChild(root);
    document.body.appendChild(host);

    // ---- DOM helpers (append-only model) ----
    // Each user turn appends one .ns-msg-row.out. Each assistant turn
    // appends a single row that initially contains .ns-typing; the
    // streaming pipeline swaps .ns-typing for a .ns-bubble.in once the
    // first text-delta arrives, then mutates the bubble's innerHTML
    // as more deltas come in. We never re-render the whole body, so
    // entrance animations only fire once per row.
    function appendDayIfMissing() {
      if (!bodyEl.querySelector('.ns-day')) {
        var day = document.createElement('div');
        day.className = 'ns-day';
        day.textContent = t('todayLabel');
        bodyEl.appendChild(day);
      }
    }

    function scheduleFreshCleanup(row) {
      // Strip ns-fresh after the longest entrance animation has run, so
      // any later layout shift (image load, etc.) doesn't replay it and
      // the row participates in normal transitions.
      setTimeout(function () { row.classList.remove('ns-fresh'); }, 700);
    }

    function appendUserRow(text) {
      appendDayIfMissing();
      var row = document.createElement('div');
      row.className = 'ns-msg-row out ns-fresh';
      var bubble = document.createElement('div');
      bubble.className = 'ns-bubble out';
      bubble.textContent = text;
      row.appendChild(bubble);
      bodyEl.appendChild(row);
      bodyEl.scrollTop = bodyEl.scrollHeight;
      scheduleFreshCleanup(row);
      return row;
    }

    function appendAssistantRow(initialContent) {
      appendDayIfMissing();
      var row = document.createElement('div');
      row.className = 'ns-msg-row in ns-fresh';
      var avatar = document.createElement('div');
      avatar.className = 'ns-msg-avatar';
      avatar.textContent = AVATAR_INITIAL;
      row.appendChild(avatar);
      if (initialContent) {
        var bubble = document.createElement('div');
        bubble.className = 'ns-bubble in';
        bubble.innerHTML = renderMarkdown(initialContent);
        row.appendChild(bubble);
      } else {
        // Empty placeholder = typing dots; swapped on first token.
        var typing = document.createElement('div');
        typing.className = 'ns-typing';
        typing.innerHTML = '<span></span><span></span><span></span>';
        row.appendChild(typing);
      }
      bodyEl.appendChild(row);
      bodyEl.scrollTop = bodyEl.scrollHeight;
      scheduleFreshCleanup(row);
      return row;
    }

    function updateAssistantRow(row, content) {
      var bubble = row.querySelector('.ns-bubble.in');
      if (!bubble) {
        // First token: swap typing dots for a real bubble.
        var typing = row.querySelector('.ns-typing');
        bubble = document.createElement('div');
        bubble.className = 'ns-bubble in';
        if (typing) row.replaceChild(bubble, typing);
        else row.appendChild(bubble);
      }
      bubble.innerHTML = renderMarkdown(content);
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }

    function removeRow(row) {
      if (row && row.parentNode) row.parentNode.removeChild(row);
    }

    function updateSendState() {
      var len = inputEl.value.trim().length;
      var over = len > MAX_CHARS;
      inputWrapEl.classList.toggle('ns-over', over);
      sendEl.disabled = sending || len === 0 || over;
    }

    function autoGrowInput() {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 110) + 'px';
    }

    function showModal(message) {
      modalTextEl.textContent = message;
      modalBackdropEl.classList.remove('ns-hidden');
      modalOkEl.focus();
    }
    function hideModal() {
      modalBackdropEl.classList.add('ns-hidden');
    }

    function send(message) {
      if (sending) return;
      sending = true;
      var userRow = appendUserRow(message);
      var assistantRow = appendAssistantRow('');
      var streamedText = '';
      var sawFirstToken = false;
      updateSendState();

      var body = { message: message };
      if (sessionId) {
        body.sessionId = sessionId;
      } else {
        body.context = { language: LANGUAGE, country: COUNTRY };
      }

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
          // Non-200 → drain JSON error and route to the same modal as before.
          if (!res.ok) {
            return res
              .json()
              .then(function (data) { throw { status: res.status, data: data }; })
              .catch(function (e) {
                if (e && typeof e === 'object' && 'status' in e) throw e;
                throw { status: res.status, data: null };
              });
          }
          // Capture the server-issued session id (X-Conversation-Id is exposed
          // via Access-Control-Expose-Headers on the route).
          var sid = res.headers.get('X-Conversation-Id');
          if (sid) {
            sessionId = sid;
            try { localStorage.setItem(STORAGE_KEY, sid); } catch (_) {}
          }
          if (!res.body) {
            throw new Error('no_stream_body');
          }
          return consumeStream(res.body);
        })
        .then(function () {
          sending = false;
          // If the model produced nothing at all (rare — auth/quota error
          // after stream open), strip the empty assistant bubble.
          if (!sawFirstToken) removeRow(assistantRow);
          updateSendState();
        })
        .catch(function (err) {
          sending = false;
          // Drop the optimistic user + empty assistant rows; modal carries
          // the failure context.
          removeRow(assistantRow);
          removeRow(userRow);
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

      // Reads an SSE-style ReadableStream of UI message protocol events.
      // Each event is a `data: {json}` line followed by a blank line.
      // We only care about text-delta events; the agent's final text is
      // the concatenation of all deltas.
      function consumeStream(body) {
        var reader = body.getReader();
        var decoder = new TextDecoder();
        var buf = '';
        return new Promise(function (resolve, reject) {
          function pump() {
            reader.read().then(function (r) {
              if (r.done) {
                flushEvents(buf, true);
                resolve();
                return;
              }
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
        if (isFinal && buf.trim()) {
          handleEvent(buf);
          buf = '';
        }
        return buf;
      }

      function handleEvent(raw) {
        var lines = raw.split('\n');
        var dataStr = '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.indexOf('data: ') === 0) {
            dataStr += line.slice(6);
          } else if (line.indexOf('data:') === 0) {
            dataStr += line.slice(5);
          }
        }
        if (!dataStr) return;
        var parsed;
        try { parsed = JSON.parse(dataStr); } catch (_) { return; }
        if (parsed && parsed.type === 'text-delta' && typeof parsed.delta === 'string') {
          streamedText += parsed.delta;
          sawFirstToken = true;
          updateAssistantRow(assistantRow, streamedText);
        }
      }
    }

    function humanizeError(code, detail) {
      switch (code) {
        case 'message_too_long':
          return t('errTooLong');
        case 'conversation_too_long':
        case 'too_many_turns':
          return t('errTooManyTurns');
        default:
          return detail || t('errGeneric');
      }
    }

    function openPanel() {
      if (open) return;
      open = true;
      root.setAttribute('data-open', 'true');
      // First open fades the whole body up gently — single motion, not a
      // per-row cascade, so returning customers don't see their history
      // replay every animation.
      if (!firstOpenDone) {
        firstOpenDone = true;
        bodyEl.classList.add('ns-first-open');
        setTimeout(function () { bodyEl.classList.remove('ns-first-open'); }, 500);
      }
      // Greeting: ~1s delay on first open of an empty conversation, so
      // the human reads the panel chrome first.
      if (!greetingShown && GREETING && !bodyEl.querySelector('.ns-msg-row')) {
        if (greetingTimer) clearTimeout(greetingTimer);
        greetingTimer = setTimeout(function () {
          greetingShown = true;
          if (open && !bodyEl.querySelector('.ns-msg-row.in')) {
            var row = appendAssistantRow(GREETING);
            // The greeting isn't part of `messages` — it's a synthetic
            // first turn rendered locally only. The backend never sees it.
            row.setAttribute('data-greeting', '');
          }
        }, 1000);
      } else {
        greetingShown = true;
      }
      setTimeout(function () { try { inputEl.focus(); } catch (_) {} }, 60);
    }

    function closePanel() {
      open = false;
      root.setAttribute('data-open', 'false');
      // Cancel a pending greeting so it doesn't pop in after close.
      if (greetingTimer) { clearTimeout(greetingTimer); greetingTimer = null; }
    }

    // ---- Events ----
    launcher.addEventListener('click', function () {
      if (open) closePanel();
      else openPanel();
    });
    closeEl.addEventListener('click', closePanel);
    inputEl.addEventListener('input', function () {
      var len = inputEl.value.trim().length;
      var nowOver = len > MAX_CHARS;
      if (nowOver && !wasOver) showModal(t('errTooLong'));
      wasOver = nowOver;
      autoGrowInput();
      updateSendState();
    });
    inputEl.addEventListener('keydown', function (e) {
      // Enter sends; Shift+Enter inserts a newline.
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        try { formEl.requestSubmit ? formEl.requestSubmit() : formEl.dispatchEvent(new Event('submit', { cancelable: true })); } catch (_) {}
      }
    });
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = inputEl.value.trim();
      if (sending) return;
      if (text.length > MAX_CHARS) {
        showModal(t('errTooLong'));
        return;
      }
      if (!text) return;
      inputEl.value = '';
      autoGrowInput();
      wasOver = false;
      send(text);
    });
    modalOkEl.addEventListener('click', hideModal);
    modalBackdropEl.addEventListener('click', function (e) {
      if (e.target === modalBackdropEl) hideModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) {
        if (!modalBackdropEl.classList.contains('ns-hidden')) hideModal();
        else closePanel();
      }
    });

    updateSendState();
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
  // Bold and italics are deliberately NOT supported — the system prompt
  // bans them. All input is HTML-escaped before tokens are re-injected,
  // so the user can't smuggle <script> through.
  function renderMarkdown(input) {
    var src = String(input == null ? '' : input);
    // Normalize newlines and trim trailing whitespace per line.
    var lines = src.replace(/\r\n?/g, '\n').split('\n').map(function (l) {
      return l.replace(/\s+$/, '');
    });
    // Group into blocks separated by blank lines.
    var blocks = [];
    var current = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i] === '') {
        if (current.length) {
          blocks.push(current);
          current = [];
        }
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
    // Pull out [label](url) BEFORE escaping so we can validate the URL,
    // then escape the label + non-link text, then stitch back together.
    var parts = [];
    var rest = line;
    var LINK_RE = /\[([^\]]+)\]\(([^\s)]+)\)/;
    while (true) {
      var m = LINK_RE.exec(rest);
      if (!m) {
        parts.push(escapeHtml(rest));
        break;
      }
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
        // Unsafe URL scheme — render the label as plain text so we don't
        // produce an active javascript:/data: link.
        parts.push(escapeHtml(label));
      }
      rest = rest.slice(m.index + m[0].length);
    }
    return parts.join('');
  }

  function hexToRgba(hex, alpha) {
    var h = hex.replace('#', '');
    if (h.length === 3)
      h = h
        .split('')
        .map(function (c) {
          return c + c;
        })
        .join('');
    if (h.length !== 6) return 'rgba(31,41,55,' + alpha + ')';
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }
})();
