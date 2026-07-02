import type { LoaderFunctionArgs, MetaFunction, LinksFunction } from 'react-router';
import { redirect, Link } from 'react-router';
import { getSessionFromRequest } from '../../lib/workspace-auth';

/**
 * Public landing (vitrio.se). Three branches:
 *  - Shopify install flow lands here with ?shop=… → redirect into /app
 *    (Shopify embedded path stays unchanged).
 *  - Already signed-in user → their dashboard (or workspace picker / admin).
 *  - Everyone else → marketing page with sign-in CTA.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get('shop')) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  const session = await getSessionFromRequest(request);
  if (session) {
    if (session.activeWorkspaceId) throw redirect('/preview/chat');
    if (session.memberships.length > 0) throw redirect('/workspaces');
    if (session.user.isPlatformAdmin) throw redirect('/admin');
  }
  return null;
};

export const meta: MetaFunction = () => [
  { title: 'Vitrio — AI-kundtjänst som aldrig hittar på' },
  {
    name: 'description',
    content:
      'En rad JavaScript på din sajt. Vitrio svarar på kundernas frågor utifrån dina riktiga policyer och orderdata — och lämnar över till en människa när den inte borde gissa.',
  },
  { property: 'og:title', content: 'Vitrio — AI-kundtjänst som aldrig hittar på' },
  {
    property: 'og:description',
    content:
      'Grundad i din egen data. Mänsklig överlämning. Installeras med en rad kod.',
  },
];

export const links: LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,420;9..144,560&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
  },
];

/* Palette mirrors SHELL_TOKENS in admin-shell.tsx so landing → dashboard
 * feels like one product. */
const CSS = `
  .vt-root {
    --bg: #f7f4ee;
    --card: #fffdf8;
    --ink: #1f2823;
    --muted: #6b6359;
    --line: #ece6d8;
    --line-dash: #dcd3bc;
    --tan: #c8a87a;
    --forest: #2c4a3e;
    --forest-deep: #22392f;
    --code-bg: #0f1217;
    --code-ink: #e6e2d6;
    --sans: "Inter Tight", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --serif: "Fraunces", Georgia, serif;
    --mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    font-family: var(--sans);
    background: var(--bg);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    line-height: 1.55;
    min-height: 100vh;
    overflow-x: clip;
  }
  .vt-root *, .vt-root *::before, .vt-root *::after { box-sizing: border-box; }
  .vt-wrap { max-width: 1080px; margin: 0 auto; padding: 0 28px; }

  /* ------- topbar ------- */
  .vt-topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 22px 0;
  }
  .vt-wordmark {
    font-family: var(--serif); font-size: 24px; font-weight: 560;
    letter-spacing: -0.01em; color: var(--ink); text-decoration: none;
  }
  .vt-wordmark span { color: var(--tan); }
  .vt-topnav { display: flex; align-items: center; gap: 22px; }
  .vt-topnav a { font-size: 14px; color: var(--muted); text-decoration: none; }
  .vt-topnav a:hover { color: var(--ink); }
  .vt-btn {
    display: inline-block; text-decoration: none; font-weight: 500;
    font-size: 15px; padding: 12px 22px; border-radius: 8px;
    transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
  }
  .vt-btn:hover { transform: translateY(-1px); }
  .vt-btn-primary { background: var(--forest); color: #fdfcf7 !important; box-shadow: 0 1px 2px rgba(31,40,35,0.18); }
  .vt-btn-primary:hover { background: var(--forest-deep); box-shadow: 0 4px 14px rgba(44,74,62,0.25); }
  .vt-btn-ghost { color: var(--ink); border: 1px solid var(--line-dash); background: transparent; }
  .vt-btn-ghost:hover { border-color: var(--tan); }
  .vt-btn-small { font-size: 14px; padding: 9px 16px; }

  /* ------- hero ------- */
  .vt-hero {
    display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 56px;
    align-items: center; padding: 72px 0 84px; position: relative;
  }
  .vt-hero > div { min-width: 0; }
  .vt-hero::before {
    content: ""; position: absolute; inset: -80px -40vw 0;
    background: radial-gradient(900px 420px at 30% 0%, rgba(200,168,122,0.13), transparent 70%);
    pointer-events: none;
  }
  .vt-kicker {
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--forest); margin: 0 0 18px;
    display: flex; align-items: center; gap: 10px;
  }
  .vt-kicker::before { content: ""; width: 22px; height: 1px; background: var(--tan); }
  .vt-h1 {
    font-family: var(--serif); font-weight: 420; font-size: clamp(38px, 5.2vw, 58px);
    line-height: 1.06; letter-spacing: -0.015em; margin: 0 0 20px;
  }
  .vt-h1 em { font-style: italic; color: var(--forest); }
  .vt-lede { font-size: 17px; color: var(--muted); max-width: 480px; margin: 0 0 30px; }
  .vt-cta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
  .vt-snippet-label {
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--muted); margin: 40px 0 8px;
  }
  .vt-snippet {
    background: var(--code-bg); color: var(--code-ink); border-radius: 10px;
    font-family: var(--mono); font-size: 12.5px; line-height: 1.7;
    padding: 14px 18px; overflow-wrap: break-word;
    box-shadow: 0 12px 32px -18px rgba(15,18,23,0.5);
  }
  .vt-snippet .t { color: #9bb4d4; } .vt-snippet .a { color: #c8a87a; }

  /* ------- chat mock ------- */
  .vt-chat {
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 24px 60px -30px rgba(31,40,35,0.35);
    overflow: hidden; max-width: 400px; margin-left: auto; position: relative;
  }
  .vt-chat-head {
    background: var(--forest); color: #fdfcf7; padding: 14px 18px;
    display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500;
  }
  .vt-chat-dot { width: 8px; height: 8px; border-radius: 50%; background: #8fc7a6; }
  .vt-chat-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
  .vt-msg { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 13.5px; line-height: 1.5; }
  .vt-msg-user { align-self: flex-end; background: var(--forest); color: #fdfcf7; border-bottom-right-radius: 4px; }
  .vt-msg-bot { align-self: flex-start; background: var(--bg); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
  .vt-msg-src {
    font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--muted); margin-top: 8px;
    padding-top: 7px; border-top: 1px dashed var(--line-dash);
  }
  .vt-chat-foot {
    border-top: 1px solid var(--line); padding: 12px 18px; font-size: 13px;
    color: var(--muted); display: flex; justify-content: space-between; align-items: center;
  }
  .vt-chat-foot .vt-mono-tag { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase; }

  /* ------- sections ------- */
  .vt-section { padding: 72px 0; border-top: 1px solid var(--line); }
  .vt-h2 {
    font-family: var(--serif); font-weight: 420; font-size: clamp(28px, 3.4vw, 38px);
    letter-spacing: -0.01em; line-height: 1.15; margin: 0 0 12px;
  }
  .vt-section-lede { color: var(--muted); font-size: 16px; max-width: 560px; margin: 0 0 44px; }

  .vt-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; counter-reset: step; }
  .vt-step {
    background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 26px 24px; position: relative; counter-increment: step;
  }
  .vt-step::before {
    content: "0" counter(step);
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; color: var(--tan);
    display: block; margin-bottom: 14px;
  }
  .vt-step h3 { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
  .vt-step p { font-size: 14px; color: var(--muted); margin: 0; }

  .vt-features { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  .vt-feature { background: var(--card); padding: 30px 28px; transition: background 150ms ease; }
  .vt-feature:hover { background: #fffef9; }
  .vt-feature .vt-f-label {
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--forest); margin-bottom: 12px;
  }
  .vt-feature h3 { font-size: 17px; font-weight: 600; margin: 0 0 8px; }
  .vt-feature p { font-size: 14px; color: var(--muted); margin: 0; }

  .vt-trust {
    display: flex; gap: 36px; flex-wrap: wrap; justify-content: center;
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--muted);
    border-top: 1px dashed var(--line-dash); border-bottom: 1px dashed var(--line-dash);
    padding: 22px 0; margin: 0;
  }
  .vt-trust li { list-style: none; display: flex; align-items: center; gap: 8px; }
  .vt-trust li::before { content: "●"; color: var(--tan); font-size: 7px; }

  .vt-final { text-align: center; padding: 88px 0; }
  .vt-final .vt-h2 { margin-bottom: 14px; }
  .vt-final p { color: var(--muted); max-width: 460px; margin: 0 auto 30px; }

  .vt-footer {
    border-top: 1px solid var(--line); padding: 28px 0 40px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px; color: var(--muted); flex-wrap: wrap; gap: 12px;
  }
  .vt-footer a { color: var(--muted); text-decoration: none; margin-left: 20px; }
  .vt-footer a:hover { color: var(--ink); }

  /* ------- motion ------- */
  @keyframes vt-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  .vt-rise { animation: vt-rise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
  .vt-d1 { animation-delay: 60ms; } .vt-d2 { animation-delay: 140ms; }
  .vt-d3 { animation-delay: 220ms; } .vt-d4 { animation-delay: 320ms; }
  @media (prefers-reduced-motion: reduce) { .vt-rise { animation: none; } }

  @media (max-width: 860px) {
    .vt-hero { grid-template-columns: 1fr; gap: 44px; padding: 44px 0 60px; }
    .vt-chat { margin-left: 0; }
    .vt-steps { grid-template-columns: 1fr; }
    .vt-features { grid-template-columns: 1fr; }
    .vt-section { padding: 52px 0; }
  }
`;

const CONTACT_EMAIL = 'hej@vitrio.se';

export default function Landing() {
  return (
    <div className="vt-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="vt-wrap">
        <header className="vt-topbar">
          <Link to="/" className="vt-wordmark">
            Vitrio<span>.</span>
          </Link>
          <nav className="vt-topnav">
            <a href="#sa-funkar-det">Så funkar det</a>
            <Link to="/signin" className="vt-btn vt-btn-ghost vt-btn-small">
              Logga in
            </Link>
          </nav>
        </header>

        {/* ---------- hero ---------- */}
        <section className="vt-hero">
          <div>
            <p className="vt-kicker vt-rise">AI-kundtjänst för e-handel</p>
            <h1 className="vt-h1 vt-rise vt-d1">
              Kundtjänst som <em>aldrig hittar på</em> svar.
            </h1>
            <p className="vt-lede vt-rise vt-d2">
              En rad JavaScript på din sajt. Vitrio svarar på kundernas frågor
              dygnet runt — utifrån dina riktiga policyer, ordrar och
              leveransdata. När den inte borde gissa lämnar den över till en
              människa.
            </p>
            <div className="vt-cta-row vt-rise vt-d3">
              <a className="vt-btn vt-btn-primary" href={`mailto:${CONTACT_EMAIL}?subject=Demo%20av%20Vitrio`}>
                Boka en demo
              </a>
              <Link className="vt-btn vt-btn-ghost" to="/signin">
                Logga in
              </Link>
            </div>
            <p className="vt-snippet-label vt-rise vt-d4">
              Hela installationen — en rad före &lt;/body&gt;
            </p>
            <div className="vt-snippet vt-rise vt-d4">
              <span className="t">&lt;script </span>
              <span className="a">src</span>=&quot;https://vitrio.se/widget.js&quot;{' '}
              <span className="a">data-assistant</span>=&quot;…&quot; async defer
              <span className="t">&gt;&lt;/script&gt;</span>
            </div>
          </div>

          <div className="vt-chat vt-rise vt-d2" aria-hidden="true">
            <div className="vt-chat-head">
              <span className="vt-chat-dot" /> Kundservice
            </div>
            <div className="vt-chat-body">
              <div className="vt-msg vt-msg-user">
                Hej! Var är min order? #10382
              </div>
              <div className="vt-msg vt-msg-bot">
                Hej Anna! Din order skickades igår med PostNord och beräknas
                komma <strong>torsdag 4/7</strong>. Spårningen visar att paketet
                är i Stockholm just nu.
                <div className="vt-msg-src">Källa: ordersystem · leveranspolicy</div>
              </div>
              <div className="vt-msg vt-msg-user">
                Kan jag ändra leveransadressen?
              </div>
              <div className="vt-msg vt-msg-bot">
                Det vill jag inte chansa på — jag kopplar in en kollega som kan
                hjälpa dig direkt.
                <div className="vt-msg-src">Överlämnad till människa · 14:02</div>
              </div>
            </div>
            <div className="vt-chat-foot">
              <span>Skriv ett meddelande …</span>
              <span className="vt-mono-tag">Vitrio</span>
            </div>
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="vt-section" id="sa-funkar-det">
          <h2 className="vt-h2">Igång på en dag. Inte ett kvartal.</h2>
          <p className="vt-section-lede">
            Vi sätter upp allt åt dig — du klistrar in en rad kod och följer
            resultatet i din dashboard.
          </p>
          <div className="vt-steps">
            <div className="vt-step">
              <h3>Vi bygger din kunskapsbas</h3>
              <p>
                Policyer, FAQ, produktsidor — vi läser in din sajt och dina
                dokument, och kopplar på orderdata där det finns.
              </p>
            </div>
            <div className="vt-step">
              <h3>Du klistrar in en rad kod</h3>
              <p>
                Fungerar på Shopify, WordPress och vanlig HTML. Ingen
                build-process, ingen app att installera.
              </p>
            </div>
            <div className="vt-step">
              <h3>Boten svarar — du ser allt</h3>
              <p>
                Varje konversation loggas i din dashboard: lösta ärenden,
                eskaleringar och luckor i kunskapsbasen.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- features ---------- */}
        <section className="vt-section">
          <h2 className="vt-h2">Byggd för att vara pålitlig, inte imponerande.</h2>
          <p className="vt-section-lede">
            De flesta AI-chattbotar svarar på allt. Vitrio svarar bara på det
            den kan belägga i din egen data.
          </p>
          <div className="vt-features">
            <div className="vt-feature">
              <div className="vt-f-label">Grundad i din data</div>
              <h3>Citerar det den ser — inte det den tror</h3>
              <p>
                Svaren bygger på dina policyer, din orderdata och din
                spårningsinformation. Finns inte svaret, säger boten det.
              </p>
            </div>
            <div className="vt-feature">
              <div className="vt-f-label">Mänsklig överlämning</div>
              <h3>Vet när den ska släppa taget</h3>
              <p>
                Känsliga ärenden, arga kunder och allt utanför kunskapsbasen
                eskaleras till din inkorg med en färdig sammanfattning.
              </p>
            </div>
            <div className="vt-feature">
              <div className="vt-f-label">Insikter</div>
              <h3>Ser vad kunderna faktiskt frågar om</h3>
              <p>
                Dashboarden visar ämnen, lösningsgrad och kunskapsluckor — så
                du vet exakt vilken policysida som saknas.
              </p>
            </div>
            <div className="vt-feature">
              <div className="vt-f-label">Integritet</div>
              <h3>GDPR utan fotnoter</h3>
              <p>
                Data lagras inom EU. Ingen träning på dina kunders
                konversationer. Kunder kan själva exportera eller radera sin
                data direkt i widgeten.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- trust strip ---------- */}
        <ul className="vt-trust">
          <li>Svenskt &amp; flerspråkigt</li>
          <li>Data inom EU</li>
          <li>Shopify · WordPress · HTML</li>
          <li>Ingen träning på din data</li>
        </ul>

        {/* ---------- final CTA ---------- */}
        <section className="vt-final">
          <h2 className="vt-h2">Se den svara på dina egna kundfrågor.</h2>
          <p>
            Vi sätter upp en pilot mot din riktiga kunskapsbas — du ser exakt
            hur boten hade svarat dina kunder, innan den möter en enda.
          </p>
          <a className="vt-btn vt-btn-primary" href={`mailto:${CONTACT_EMAIL}?subject=Pilot%20med%20Vitrio`}>
            Boka en demo
          </a>
        </section>

        <footer className="vt-footer">
          <span>© {new Date().getFullYear()} Vitrio</span>
          <span>
            <Link to="/privacy">Integritetspolicy</Link>
            <Link to="/signin">Logga in</Link>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
