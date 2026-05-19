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
    var ICON_STYLE = w.iconStyle || 'bot';
    var LAUNCHER_SHAPE = w.launcherShape || 'circle';
    var LAUNCHER_ICON_COLOR = w.launcherIconColor || '#ffffff';
    var SEND_ICON = w.sendIcon || 'arrow_up';
    var SEND_SHAPE = w.sendShape || 'rounded';
    var SEND_FILL = w.sendFill || 'solid';
    var SEND_ICON_COLOR = w.sendIconColor || '#ffffff';
    var PLACEHOLDER =
      (w.placeholder && String(w.placeholder).trim()) || strings.placeholder;
    var PANEL_W = typeof w.width === 'number' ? w.width : 360;
    var PANEL_H = typeof w.height === 'number' ? w.height : 540;

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
    function shapeRadius(shape, max) {
      // max = the value we'd use for a "fully rounded" effect at this size
      if (shape === 'circle') return max;
      if (shape === 'square') return '0';
      return '8px'; // rounded
    }
    // Send button computed styles based on fill mode.
    var sendBg = SEND_FILL === 'solid' ? BRAND_COLOR : 'transparent';
    var sendBorder = SEND_FILL === 'outline' ? ('1px solid ' + SEND_ICON_COLOR) : 'none';
    var sendHoverBg =
      SEND_FILL === 'solid' ? BRAND_COLOR : hexToRgba(SEND_ICON_COLOR, 0.12);

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
    var messages = [];
    var sending = false;
    var open = false;
    // Greeting appears ~1s after the panel opens (set by the open handler).
    // Reset between sessions so re-opening replays the small delay.
    var greetingShown = false;
    var greetingTimer = null;
    var wasOver = false;

    // ---- Styles ----
    var STYLE = [
      // Defensive reset against host CSS bleed.
      '.ns-root, .ns-root *, .ns-root *::before, .ns-root *::after { box-sizing: border-box; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.4; color: inherit; }',
      '.ns-root input, .ns-root button, .ns-root textarea { background: transparent; border: none; padding: 0; font: inherit; color: inherit; width: auto; height: auto; min-width: 0; outline: none; vertical-align: middle; -webkit-appearance: none; appearance: none; }',
      // Bubble (launcher)
      '.ns-root .ns-bubble { position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: ' + shapeRadius(LAUNCHER_SHAPE, '50%') + '; background: ' + BRAND_COLOR + '; color: ' + LAUNCHER_ICON_COLOR + '; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; z-index: 2147483646; transition: transform 0.15s ease; }',
      '.ns-root .ns-bubble:hover { transform: scale(1.05); }',
      '.ns-root .ns-bubble.ns-hidden { display: none; }',
      '.ns-root .ns-bubble svg { width: 24px; height: 24px; display: block; }',
      // Panel (sized from per-assistant config)
      '.ns-root .ns-panel { position: fixed; right: 20px; bottom: 20px; width: ' + PANEL_W + 'px; max-width: calc(100vw - 40px); height: ' + PANEL_H + 'px; max-height: calc(100vh - 40px); background: white; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; z-index: 2147483647; }',
      '.ns-root .ns-panel.ns-hidden { display: none; }',
      // Header
      '.ns-root .ns-header { background: ' + BRAND_COLOR + '; color: white; height: 48px; padding: 0 8px 0 16px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }',
      '.ns-root .ns-header-title { font-weight: 600; font-size: 14px; line-height: 1; }',
      '.ns-root .ns-icon-btn { width: 32px; height: 32px; padding: 0; background: transparent; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: background 0.15s ease; flex-shrink: 0; }',
      '.ns-root .ns-icon-btn:hover { background: rgba(255,255,255,0.15); }',
      '.ns-root .ns-icon-btn svg { width: 18px; height: 18px; display: block; }',
      // Messages
      '.ns-root .ns-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: #f9fafb; }',
      '.ns-root .ns-msg { padding: 8px 12px; border-radius: 12px; max-width: 80%; font-size: 14px; line-height: 1.4; white-space: pre-wrap; word-wrap: break-word; }',
      '.ns-root .ns-msg.ns-user { align-self: flex-end; background: ' + BRAND_COLOR + '; color: white; border-bottom-right-radius: 4px; }',
      '.ns-root .ns-msg.ns-assistant { align-self: flex-start; background: white; border: 1px solid #e5e7eb; color: #111827; border-bottom-left-radius: 4px; white-space: normal; }',
      // Markdown inside assistant bubbles. Bold/italics intentionally not
      // styled — the system prompt bans them. Lists are compact; links use
      // an understated underline since the bubble is monochrome already.
      '.ns-root .ns-msg.ns-assistant p { margin: 0 0 6px 0; }',
      '.ns-root .ns-msg.ns-assistant p:last-child { margin-bottom: 0; }',
      '.ns-root .ns-msg.ns-assistant ul, .ns-root .ns-msg.ns-assistant ol { margin: 4px 0 6px 0; padding-left: 18px; }',
      '.ns-root .ns-msg.ns-assistant li { margin: 2px 0; }',
      '.ns-root .ns-msg.ns-assistant a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }',
      '.ns-root .ns-msg.ns-assistant a:hover { opacity: 0.8; }',
      '.ns-root .ns-thinking { align-self: flex-start; color: #6b7280; font-size: 12px; padding: 4px 12px; }',
      // Footer
      '.ns-root .ns-footer { border-top: 1px solid #e5e7eb; background: white; flex-shrink: 0; }',
      '.ns-root .ns-form { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }',
      '.ns-root .ns-input { flex: 1 1 0; min-width: 0; width: auto; height: 40px; padding: 0 12px; font-size: 14px; border: 1px solid #d1d5db; border-radius: 8px; background: white; color: #111827; }',
      '.ns-root .ns-input:focus { border-color: ' + BRAND_ACCENT + '; box-shadow: 0 0 0 3px ' + hexToRgba(BRAND_ACCENT, 0.10) + '; }',
      '.ns-root .ns-input.ns-over { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.10); }',
      '.ns-root .ns-send { width: 40px; height: 40px; flex-shrink: 0; padding: 0; background: ' + sendBg + '; color: ' + SEND_ICON_COLOR + '; border: ' + sendBorder + '; border-radius: ' + shapeRadius(SEND_SHAPE, '50%') + '; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: opacity 0.15s ease, background 0.15s ease; }',
      '.ns-root .ns-send:hover:not(:disabled) { opacity: 0.9; background: ' + sendHoverBg + '; }',
      '.ns-root .ns-send:disabled { opacity: 0.4; cursor: not-allowed; }',
      '.ns-root .ns-send svg { width: 18px; height: 18px; display: block; }',
      // Privacy link sits below the composer; small, muted, never competes
      // with the send affordance. Hidden when we lack the assistantId
      // (inline-token install path — merchant can still link to /privacy
      // elsewhere on their site).
      '.ns-root .ns-privacy { padding: 0 16px 8px 16px; font-size: 11px; text-align: right; }',
      '.ns-root .ns-privacy a { color: #6b7280; text-decoration: none; }',
      '.ns-root .ns-privacy a:hover { text-decoration: underline; color: #374151; }',
      '.ns-root .ns-privacy.ns-hidden { display: none; }',
      // Modal
      '.ns-root .ns-modal-backdrop { position: absolute; inset: 0; background: rgba(17,24,39,0.45); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 1; }',
      '.ns-root .ns-modal-backdrop.ns-hidden { display: none; }',
      '.ns-root .ns-modal { background: white; border-radius: 10px; padding: 20px; max-width: 280px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); display: flex; flex-direction: column; gap: 16px; }',
      '.ns-root .ns-modal-icon { width: 32px; height: 32px; border-radius: 50%; background: #fee2e2; color: #dc2626; display: inline-flex; align-items: center; justify-content: center; align-self: center; flex-shrink: 0; }',
      '.ns-root .ns-modal-icon svg { width: 18px; height: 18px; display: block; }',
      '.ns-root .ns-modal-text { color: #111827; font-size: 14px; line-height: 1.5; text-align: center; }',
      '.ns-root .ns-modal-ok { align-self: center; padding: 8px 20px; height: 36px; background: ' + BRAND_COLOR + '; color: white; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; min-width: 80px; display: inline-flex; align-items: center; justify-content: center; }',
      '.ns-root .ns-modal-ok:hover { opacity: 0.9; }',
      '@media (max-width: 480px) { .ns-root .ns-panel { right: 0; bottom: 0; width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh; border-radius: 0; } }',
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

    var bubble = document.createElement('button');
    bubble.className = 'ns-bubble';
    bubble.setAttribute('aria-label', t('openLabel'));
    bubble.innerHTML = LAUNCHER_SVG[ICON_STYLE] || LAUNCHER_SVG.bot;

    var panel = document.createElement('div');
    panel.className = 'ns-panel ns-hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', BRAND_NAME);
    panel.innerHTML =
      '<div class="ns-header">' +
      '<span class="ns-header-title"></span>' +
      '<button type="button" class="ns-icon-btn ns-close" aria-label="' + escapeAttr(t('closeLabel')) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '</div>' +
      '<div class="ns-messages" role="log" aria-live="polite"></div>' +
      '<div class="ns-footer">' +
      '<form class="ns-form" autocomplete="off">' +
      '<input type="text" class="ns-input" placeholder="' + escapeAttr(PLACEHOLDER) + '" aria-label="' + escapeAttr(PLACEHOLDER) + '" />' +
      '<button type="submit" class="ns-send" aria-label="' + escapeAttr(t('sendLabel')) + '">' +
      (SEND_SVG[SEND_ICON] || SEND_SVG.arrow_up) +
      '</button>' +
      '</form>' +
      '<div class="ns-privacy' + (ASSISTANT_ID && SCRIPT_ORIGIN ? '' : ' ns-hidden') + '">' +
      (ASSISTANT_ID && SCRIPT_ORIGIN
        ? '<a href="' +
          escapeAttr(
            SCRIPT_ORIGIN +
              '/privacy?a=' +
              encodeURIComponent(ASSISTANT_ID) +
              '&lang=' +
              encodeURIComponent(LANGUAGE),
          ) +
          '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(t('privacyLabel')) +
          '</a>'
        : '') +
      '</div>' +
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

    var titleEl = panel.querySelector('.ns-header-title');
    titleEl.textContent = BRAND_NAME;

    var messagesEl = panel.querySelector('.ns-messages');
    var formEl = panel.querySelector('.ns-form');
    var inputEl = panel.querySelector('.ns-input');
    var sendEl = panel.querySelector('.ns-send');
    var closeEl = panel.querySelector('.ns-close');
    var modalBackdropEl = panel.querySelector('.ns-modal-backdrop');
    var modalTextEl = panel.querySelector('.ns-modal-text');
    var modalOkEl = panel.querySelector('.ns-modal-ok');

    root.appendChild(bubble);
    root.appendChild(panel);
    shadow.appendChild(root);
    document.body.appendChild(host);

    function render() {
      bubble.classList.toggle('ns-hidden', open);
      panel.classList.toggle('ns-hidden', !open);

      messagesEl.innerHTML = '';
      // Greeting bubble — synthetic first bot message, only when there's
      // no real conversation yet AND the post-open delay has elapsed.
      if (messages.length === 0 && GREETING && greetingShown) {
        var greetEl = document.createElement('div');
        greetEl.className = 'ns-msg ns-assistant';
        greetEl.innerHTML = renderMarkdown(GREETING);
        messagesEl.appendChild(greetEl);
      }
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        // Skip the empty assistant placeholder before the first token lands —
        // the "Thinking…" indicator covers that gap.
        if (m.role === 'assistant' && !m.content) continue;
        var div = document.createElement('div');
        div.className = 'ns-msg ns-' + m.role;
        // Assistant replies render markdown (links, lists, line breaks).
        // User messages stay as plain text so a customer typing "[label](url)"
        // doesn't get auto-linkified into something they didn't intend.
        if (m.role === 'assistant') {
          div.innerHTML = renderMarkdown(m.content);
        } else {
          div.textContent = m.content;
        }
        messagesEl.appendChild(div);
      }
      // Show "Thinking…" only while the assistant bubble is empty — once the
      // first streamed token lands, the bubble itself is the indicator.
      var lastMsg = messages[messages.length - 1];
      var bubbleStillEmpty =
        lastMsg && lastMsg.role === 'assistant' && !lastMsg.content;
      if (sending && bubbleStillEmpty) {
        var thinking = document.createElement('div');
        thinking.className = 'ns-thinking';
        thinking.textContent = strings.thinking;
        messagesEl.appendChild(thinking);
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;

      var len = inputEl.value.trim().length;
      var over = len > MAX_CHARS;
      inputEl.classList.toggle('ns-over', over);
      sendEl.disabled = sending || len === 0 || over;
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
      messages.push({ role: 'user', content: message });
      // Placeholder assistant bubble we append text-delta events into.
      // Created upfront so the "thinking" indicator gives way to a growing
      // bubble as the first token lands.
      var assistantIndex = messages.push({ role: 'assistant', content: '' }) - 1;
      render();

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
          if (
            messages[assistantIndex] &&
            messages[assistantIndex].role === 'assistant' &&
            !messages[assistantIndex].content
          ) {
            messages.splice(assistantIndex, 1);
          }
          render();
        })
        .catch(function (err) {
          sending = false;
          // Drop the optimistic user + empty assistant bubbles; modal carries
          // the failure.
          if (
            messages[assistantIndex] &&
            messages[assistantIndex].role === 'assistant' &&
            !messages[assistantIndex].content
          ) {
            messages.splice(assistantIndex, 1);
          }
          if (
            messages.length > 0 &&
            messages[messages.length - 1].role === 'user'
          ) {
            messages.pop();
          }
          render();
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
      // We care about text-delta events; everything else (start, start-step,
      // tool-call, finish, etc.) is ignored — the agent's final text is
      // simply the concatenation of all text-delta deltas.
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
        // Events are separated by a blank line ("\n\n"). Keep the trailing
        // partial event in the buffer for the next chunk.
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
        // An event is one or more lines, each starting with "data: ".
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
          messages[assistantIndex].content += parsed.delta;
          render();
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

    // ---- Events ----
    bubble.addEventListener('click', function () {
      open = true;
      // Only delay the greeting if there's no real conversation yet —
      // returning customers shouldn't wait.
      if (messages.length === 0 && GREETING && !greetingShown) {
        greetingShown = false;
        if (greetingTimer) clearTimeout(greetingTimer);
        greetingTimer = setTimeout(function () {
          greetingShown = true;
          if (open) render();
        }, 1000);
      } else {
        greetingShown = true;
      }
      render();
      inputEl.focus();
    });
    closeEl.addEventListener('click', function () {
      open = false;
      // Reset so the next open replays the small delay.
      greetingShown = false;
      if (greetingTimer) {
        clearTimeout(greetingTimer);
        greetingTimer = null;
      }
      render();
    });
    inputEl.addEventListener('input', function () {
      var len = inputEl.value.trim().length;
      var nowOver = len > MAX_CHARS;
      if (nowOver && !wasOver) showModal(t('errTooLong'));
      wasOver = nowOver;
      render();
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
        else {
          open = false;
          render();
        }
      }
    });

    render();
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
