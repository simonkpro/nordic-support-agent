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

  var inlineConfig = /** @type {any} */ (window.NORDIC_SUPPORT);
  if (
    !inlineConfig ||
    typeof inlineConfig.token !== 'string' ||
    typeof inlineConfig.apiUrl !== 'string'
  ) {
    console.warn(
      '[nordic-support] missing config; expected window.NORDIC_SUPPORT = { token, apiUrl }',
    );
    return;
  }
  if (window.__NORDIC_SUPPORT_LOADED__) return;
  window.__NORDIC_SUPPORT_LOADED__ = true;

  var TOKEN = inlineConfig.token;
  var API_URL = inlineConfig.apiUrl;
  var CONFIG_URL = API_URL.replace(/\/api\/chat\/?$/, '/api/widget-config');
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
    },
  };

  // Kick off remote config fetch; init when we have it (or after timeout).
  fetchRemoteConfig().then(init, function () {
    init({});
  });

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

    // Rotating "thinking" phrases. Server config wins; static
    // strings.thinking is the fallback when no per-assistant verbs are set.
    var THINKING_VERBS =
      (remote && remote.agent && Array.isArray(remote.agent.thinkingVerbs)
        ? remote.agent.thinkingVerbs.filter(function (v) {
            return typeof v === 'string' && v.trim();
          })
        : []);
    if (THINKING_VERBS.length === 0) THINKING_VERBS = [strings.thinking.replace(/…$/, '')];
    var thinkingIndex = Math.floor(Math.random() * THINKING_VERBS.length);
    var thinkingTimer = null;

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
    var wasOver = false;

    // ---- Styles ----
    var STYLE = [
      // Defensive reset against host CSS bleed.
      '.ns-root, .ns-root *, .ns-root *::before, .ns-root *::after { box-sizing: border-box; margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.4; color: inherit; }',
      '.ns-root input, .ns-root button, .ns-root textarea { background: transparent; border: none; padding: 0; font: inherit; color: inherit; width: auto; height: auto; min-width: 0; outline: none; vertical-align: middle; -webkit-appearance: none; appearance: none; }',
      // Bubble
      '.ns-root .ns-bubble { position: fixed; right: 20px; bottom: 20px; width: 56px; height: 56px; border-radius: 50%; background: ' + BRAND_COLOR + '; color: white; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; z-index: 2147483646; transition: transform 0.15s ease; }',
      '.ns-root .ns-bubble:hover { transform: scale(1.05); }',
      '.ns-root .ns-bubble.ns-hidden { display: none; }',
      '.ns-root .ns-bubble svg { width: 24px; height: 24px; display: block; }',
      // Panel
      '.ns-root .ns-panel { position: fixed; right: 20px; bottom: 20px; width: 360px; max-width: calc(100vw - 40px); height: 540px; max-height: calc(100vh - 40px); background: white; border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); display: flex; flex-direction: column; overflow: hidden; z-index: 2147483647; }',
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
      '.ns-root .ns-msg.ns-assistant { align-self: flex-start; background: white; border: 1px solid #e5e7eb; color: #111827; border-bottom-left-radius: 4px; }',
      '.ns-root .ns-thinking { align-self: flex-start; color: #6b7280; font-size: 12px; padding: 4px 12px; }',
      // Footer
      '.ns-root .ns-footer { border-top: 1px solid #e5e7eb; background: white; flex-shrink: 0; }',
      '.ns-root .ns-form { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }',
      '.ns-root .ns-input { flex: 1 1 0; min-width: 0; width: auto; height: 40px; padding: 0 12px; font-size: 14px; border: 1px solid #d1d5db; border-radius: 8px; background: white; color: #111827; }',
      '.ns-root .ns-input:focus { border-color: ' + BRAND_ACCENT + '; box-shadow: 0 0 0 3px ' + hexToRgba(BRAND_ACCENT, 0.10) + '; }',
      '.ns-root .ns-input.ns-over { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220,38,38,0.10); }',
      '.ns-root .ns-send { width: 40px; height: 40px; flex-shrink: 0; padding: 0; background: ' + BRAND_COLOR + '; color: white; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: opacity 0.15s ease; }',
      '.ns-root .ns-send:hover:not(:disabled) { opacity: 0.9; }',
      '.ns-root .ns-send:disabled { opacity: 0.4; cursor: not-allowed; }',
      '.ns-root .ns-send svg { width: 18px; height: 18px; display: block; }',
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

    var style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    var root = document.createElement('div');
    root.className = 'ns-root';

    var bubble = document.createElement('button');
    bubble.className = 'ns-bubble';
    bubble.setAttribute('aria-label', t('openLabel'));
    bubble.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

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
      '<input type="text" class="ns-input" placeholder="' + escapeAttr(t('placeholder')) + '" aria-label="' + escapeAttr(t('placeholder')) + '" />' +
      '<button type="submit" class="ns-send" aria-label="' + escapeAttr(t('sendLabel')) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
      '</button>' +
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
    document.body.appendChild(root);

    function render() {
      bubble.classList.toggle('ns-hidden', open);
      panel.classList.toggle('ns-hidden', !open);

      messagesEl.innerHTML = '';
      for (var i = 0; i < messages.length; i++) {
        var m = messages[i];
        var div = document.createElement('div');
        div.className = 'ns-msg ns-' + m.role;
        div.textContent = m.content;
        messagesEl.appendChild(div);
      }
      if (sending) {
        var thinking = document.createElement('div');
        thinking.className = 'ns-thinking';
        thinking.textContent = THINKING_VERBS[thinkingIndex % THINKING_VERBS.length] + '…';
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

    function startThinkingRotation() {
      if (thinkingTimer || THINKING_VERBS.length <= 1) return;
      thinkingTimer = setInterval(function () {
        // Pick a different index than the current one.
        var next = Math.floor(Math.random() * THINKING_VERBS.length);
        if (next === thinkingIndex) next = (next + 1) % THINKING_VERBS.length;
        thinkingIndex = next;
        if (sending) render();
      }, 2500);
    }
    function stopThinkingRotation() {
      if (thinkingTimer) {
        clearInterval(thinkingTimer);
        thinkingTimer = null;
      }
    }

    function send(message) {
      if (sending) return;
      sending = true;
      messages.push({ role: 'user', content: message });
      render();
      startThinkingRotation();

      var body = { message: message };
      if (sessionId) {
        body.sessionId = sessionId;
      } else {
        body.context = { language: LANGUAGE, country: COUNTRY };
      }

      fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + TOKEN,
        },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { status: res.status, data: data };
          });
        })
        .then(function (result) {
          sending = false;
          stopThinkingRotation();
          if (
            result.status === 200 &&
            result.data &&
            typeof result.data.reply === 'string'
          ) {
            if (typeof result.data.sessionId === 'string') {
              sessionId = result.data.sessionId;
              try {
                localStorage.setItem(STORAGE_KEY, sessionId);
              } catch (_) {}
            }
            messages.push({ role: 'assistant', content: result.data.reply });
            render();
          } else {
            // Drop the optimistic user message; modal carries the failure.
            if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
              messages.pop();
            }
            render();
            if (result.status === 429) {
              var retry = (result.data && result.data.retryAfterSeconds) || 0;
              showModal(t('errRateLimit', { n: retry }));
            } else if (result.status === 401) {
              showModal(t('errUnconfigured'));
            } else if (result.status === 400 && result.data && result.data.error) {
              showModal(humanizeError(result.data.error, result.data.detail));
            } else {
              showModal(t('errGeneric'));
            }
          }
        })
        .catch(function () {
          sending = false;
          stopThinkingRotation();
          if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
            messages.pop();
          }
          render();
          showModal(t('errNetwork'));
        });
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
      render();
      inputEl.focus();
    });
    closeEl.addEventListener('click', function () {
      open = false;
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
