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
  { title: 'Vitrio — Kundservice, utan gissningar' },
  {
    name: 'description',
    content:
      'AI-kundtjänst för e-handel som bara svarar på det den kan belägga i din egen data. En rad kod att installera. Mänsklig överlämning när det behövs.',
  },
  { property: 'og:title', content: 'Vitrio — Kundservice, utan gissningar' },
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
    href: 'https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500&display=swap',
  },
];

const CSS = `
  .vt-root {
    --paper: #f7f6f3;
    --panel: #ededea;
    --ink: #12140f;
    --gray: #71716b;
    --hairline: #e2e1db;
    --green: #0e3d2a;
    --green-deep: #0a2f21;
    --sans: "Schibsted Grotesk", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-family: var(--sans);
    background: var(--paper);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    line-height: 1.5;
    min-height: 100vh;
    overflow-x: clip;
    font-size: 16px;
  }
  .vt-root *, .vt-root *::before, .vt-root *::after { box-sizing: border-box; }
  .vt-wrap { max-width: 1160px; margin: 0 auto; padding: 0 32px; }

  /* ------- nav ------- */
  .vt-nav {
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
    padding: 20px 0;
  }
  .vt-nav-l { display: flex; gap: 26px; }
  .vt-nav-l a, .vt-nav-r a.vt-plain {
    font-size: 14px; color: var(--ink); text-decoration: none;
  }
  .vt-nav-l a:hover, .vt-nav-r a.vt-plain:hover { color: var(--gray); }
  .vt-wordmark {
    font-size: 19px; font-weight: 500; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--ink); text-decoration: none;
    justify-self: center;
  }
  .vt-nav-r { display: flex; gap: 24px; align-items: center; justify-self: end; }

  /* ------- buttons ------- */
  .vt-pill {
    display: inline-flex; align-items: center; gap: 10px;
    background: var(--green); color: #fff !important;
    border-radius: 999px; padding: 10px 8px 10px 20px;
    font-size: 14px; font-weight: 500; text-decoration: none;
    transition: background 140ms ease;
  }
  .vt-pill:hover { background: var(--green-deep); }
  .vt-pill .vt-arr {
    width: 26px; height: 26px; border-radius: 50%; background: #fff;
    color: var(--green); display: inline-flex; align-items: center;
    justify-content: center; font-size: 13px;
  }
  .vt-pill-lg { padding: 13px 10px 13px 26px; font-size: 15px; }
  .vt-pill-lg .vt-arr { width: 30px; height: 30px; }
  .vt-pill-inverse { background: #fff; color: var(--green) !important; }
  .vt-pill-inverse:hover { background: #f0efe9; }
  .vt-pill-inverse .vt-arr { background: var(--green); color: #fff; }

  /* ------- hero ------- */
  .vt-hero { text-align: center; padding: 110px 0 72px; }
  .vt-h1 {
    font-weight: 400; font-size: clamp(42px, 6.4vw, 76px);
    line-height: 1.04; letter-spacing: -0.032em; margin: 0 auto 22px;
    max-width: 16ch;
  }
  .vt-lede {
    font-size: 17px; color: var(--gray); max-width: 520px;
    margin: 0 auto 34px;
  }
  .vt-hero-cta { display: flex; gap: 26px; justify-content: center; align-items: center; }
  .vt-hero-cta .vt-signin { font-size: 14px; color: var(--ink); text-decoration: none; }
  .vt-hero-cta .vt-signin:hover { color: var(--gray); }

  /* ------- product canvas ------- */
  .vt-canvas {
    background: var(--panel); border-radius: 20px;
    padding: clamp(28px, 5vw, 64px);
    display: grid; grid-template-columns: 1fr 400px; gap: clamp(28px, 5vw, 72px);
    align-items: center; margin-bottom: 40px;
  }
  .vt-canvas > div { min-width: 0; }
  .vt-canvas-label { font-size: 13px; color: var(--gray); margin: 0 0 14px; }
  .vt-canvas h2 {
    font-weight: 400; font-size: clamp(24px, 2.6vw, 32px);
    letter-spacing: -0.02em; line-height: 1.15; margin: 0 0 14px;
  }
  .vt-canvas p.vt-body { font-size: 15px; color: var(--gray); margin: 0 0 28px; max-width: 44ch; }
  .vt-snippet {
    background: #fff; border: 1px solid var(--hairline); border-radius: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px; line-height: 1.7; color: var(--ink);
    padding: 14px 18px; overflow-wrap: break-word;
  }
  .vt-snippet .c { color: var(--gray); }

  /* ------- chat mock ------- */
  .vt-chat {
    background: #fff; border: 1px solid var(--hairline); border-radius: 16px;
    overflow: hidden; box-shadow: 0 20px 50px -36px rgba(18,20,15,0.4);
  }
  .vt-chat-head {
    padding: 13px 18px; font-size: 13.5px; font-weight: 500;
    border-bottom: 1px solid var(--hairline);
    display: flex; align-items: center; gap: 8px;
  }
  .vt-chat-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
  .vt-chat-body { padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .vt-msg { max-width: 88%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; }
  .vt-msg-user { align-self: flex-end; background: var(--green); color: #fff; border-bottom-right-radius: 4px; }
  .vt-msg-bot { align-self: flex-start; background: var(--paper); border: 1px solid var(--hairline); border-bottom-left-radius: 4px; }
  .vt-msg-src {
    font-size: 11px; color: var(--gray); margin-top: 8px; padding-top: 7px;
    border-top: 1px solid var(--hairline);
  }
  .vt-chat-foot {
    border-top: 1px solid var(--hairline); padding: 11px 18px;
    font-size: 12.5px; color: var(--gray);
  }

  /* ------- sections ------- */
  .vt-label {
    font-size: 13px; color: var(--gray); margin: 0 0 40px;
  }
  .vt-section { padding: 96px 0 0; }
  .vt-statement {
    text-align: center; padding: 130px 0;
    font-weight: 400; font-size: clamp(30px, 4vw, 48px);
    letter-spacing: -0.025em; line-height: 1.12; margin: 0;
  }
  .vt-statement span { color: var(--gray); }

  .vt-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; }
  .vt-step { border-top: 1px solid var(--ink); padding-top: 18px; }
  .vt-step .vt-num { font-size: 13px; color: var(--gray); display: block; margin-bottom: 26px; }
  .vt-step h3 { font-size: 17px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em; }
  .vt-step p { font-size: 14.5px; color: var(--gray); margin: 0; }

  .vt-features {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 0 64px; border-top: 1px solid var(--hairline);
  }
  .vt-feature { padding: 34px 0; border-bottom: 1px solid var(--hairline); }
  .vt-feature h3 { font-size: 17px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em; }
  .vt-feature p { font-size: 14.5px; color: var(--gray); margin: 0; max-width: 46ch; }

  /* ------- CTA panel ------- */
  .vt-cta-panel {
    background: var(--green); color: #fff; border-radius: 20px;
    padding: clamp(48px, 7vw, 96px) clamp(28px, 5vw, 80px);
    display: flex; flex-direction: column; align-items: flex-start; gap: 30px;
    margin: 110px 0 0;
  }
  .vt-cta-panel h2 {
    font-weight: 400; font-size: clamp(28px, 3.6vw, 44px);
    letter-spacing: -0.025em; line-height: 1.12; margin: 0; max-width: 22ch;
  }
  .vt-cta-panel p { font-size: 15px; color: rgba(255,255,255,0.72); margin: -12px 0 0; max-width: 52ch; }

  /* ------- footer ------- */
  .vt-footer {
    padding: 34px 0 44px; margin-top: 28px;
    display: flex; justify-content: space-between; align-items: center;
    font-size: 13px; color: var(--gray); flex-wrap: wrap; gap: 12px;
  }
  .vt-footer a { color: var(--gray); text-decoration: none; margin-left: 22px; }
  .vt-footer a:hover { color: var(--ink); }

  @media (max-width: 900px) {
    .vt-nav { grid-template-columns: auto 1fr; }
    .vt-nav-l { display: none; }
    .vt-wordmark { justify-self: start; }
    .vt-hero { padding: 64px 0 48px; }
    .vt-canvas { grid-template-columns: 1fr; }
    .vt-steps { grid-template-columns: 1fr; gap: 28px; }
    .vt-features { grid-template-columns: 1fr; gap: 0; }
    .vt-statement { padding: 84px 0; }
    .vt-section { padding: 64px 0 0; }
  }
`;

const CONTACT_EMAIL = 'hej@vitrio.se';

function Pill({
  href,
  children,
  large,
  inverse,
}: {
  href: string;
  children: React.ReactNode;
  large?: boolean;
  inverse?: boolean;
}) {
  const cls = ['vt-pill', large ? 'vt-pill-lg' : '', inverse ? 'vt-pill-inverse' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <a className={cls} href={href}>
      {children}
      <span className="vt-arr" aria-hidden="true">
        →
      </span>
    </a>
  );
}

export default function Landing() {
  return (
    <div className="vt-root">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="vt-wrap">
        <header className="vt-nav">
          <nav className="vt-nav-l">
            <a href="#sa-funkar-det">Så funkar det</a>
            <a href={`mailto:${CONTACT_EMAIL}`}>Kontakt</a>
          </nav>
          <Link to="/" className="vt-wordmark">
            Vitrio
          </Link>
          <div className="vt-nav-r">
            <Link to="/signin" className="vt-plain">
              Logga in
            </Link>
            <Pill href={`mailto:${CONTACT_EMAIL}?subject=Demo%20av%20Vitrio`}>Boka demo</Pill>
          </div>
        </header>

        {/* ---------- hero ---------- */}
        <section className="vt-hero">
          <h1 className="vt-h1">Kundservice, utan gissningar.</h1>
          <p className="vt-lede">
            Vitrio svarar på dina kunders frågor dygnet runt — utifrån dina
            riktiga policyer, ordrar och leveransdata. Aldrig utifrån en
            gissning.
          </p>
          <div className="vt-hero-cta">
            <Pill large href={`mailto:${CONTACT_EMAIL}?subject=Demo%20av%20Vitrio`}>
              Boka en demo
            </Pill>
            <Link to="/signin" className="vt-signin">
              Logga in
            </Link>
          </div>
        </section>

        {/* ---------- product canvas ---------- */}
        <section className="vt-canvas">
          <div>
            <p className="vt-canvas-label">Installation</p>
            <h2>En rad kod. Inget mer.</h2>
            <p className="vt-body">
              Fungerar på Shopify, WordPress och vanlig HTML. Ingen
              build-process, ingen app att installera — klistra in raden före
              stängande body-taggen så är widgeten live.
            </p>
            <div className="vt-snippet">
              <span className="c">&lt;!-- före &lt;/body&gt; --&gt;</span>
              <br />
              &lt;script src=&quot;https://vitrio.se/widget.js&quot;{' '}
              data-assistant=&quot;…&quot; async defer&gt;&lt;/script&gt;
            </div>
          </div>
          <div className="vt-chat" aria-hidden="true">
            <div className="vt-chat-head">
              <span className="vt-chat-dot" /> Kundservice
            </div>
            <div className="vt-chat-body">
              <div className="vt-msg vt-msg-user">Hej! Var är min order? #10382</div>
              <div className="vt-msg vt-msg-bot">
                Hej Anna! Din order skickades igår med PostNord och beräknas
                komma torsdag 4/7.
                <div className="vt-msg-src">Källa: ordersystem · leveranspolicy</div>
              </div>
              <div className="vt-msg vt-msg-user">Kan jag ändra leveransadressen?</div>
              <div className="vt-msg vt-msg-bot">
                Det vill jag inte chansa på — jag kopplar in en kollega som kan
                hjälpa dig direkt.
                <div className="vt-msg-src">Överlämnad till människa · 14:02</div>
              </div>
            </div>
            <div className="vt-chat-foot">Skriv ett meddelande …</div>
          </div>
        </section>

        {/* ---------- statement ---------- */}
        <p className="vt-statement">
          Varje kund. Varje fråga.
          <br />
          <span>Alltid belagt i din egen data.</span>
        </p>

        {/* ---------- how it works ---------- */}
        <section className="vt-section" id="sa-funkar-det" style={{ paddingTop: 0 }}>
          <p className="vt-label">Så funkar det</p>
          <div className="vt-steps">
            <div className="vt-step">
              <span className="vt-num">01</span>
              <h3>Vi bygger din kunskapsbas</h3>
              <p>
                Policyer, FAQ och produktsidor läses in från din sajt och dina
                dokument. Orderdata kopplas på där det finns.
              </p>
            </div>
            <div className="vt-step">
              <span className="vt-num">02</span>
              <h3>Du klistrar in en rad kod</h3>
              <p>
                Shopify, WordPress eller vanlig HTML. Widgeten är live så fort
                sidan laddats om.
              </p>
            </div>
            <div className="vt-step">
              <span className="vt-num">03</span>
              <h3>Du ser allt i din dashboard</h3>
              <p>
                Varje konversation loggas: lösta ärenden, eskaleringar och
                luckor i kunskapsbasen.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- features ---------- */}
        <section className="vt-section">
          <p className="vt-label">Byggd för att vara pålitlig</p>
          <div className="vt-features">
            <div className="vt-feature">
              <h3>Citerar det den ser — inte det den tror</h3>
              <p>
                Svaren bygger på dina policyer, din orderdata och din
                spårningsinformation. Finns inte svaret, säger boten det.
              </p>
            </div>
            <div className="vt-feature">
              <h3>Vet när den ska släppa taget</h3>
              <p>
                Känsliga ärenden och allt utanför kunskapsbasen eskaleras till
                din inkorg med en färdig sammanfattning.
              </p>
            </div>
            <div className="vt-feature">
              <h3>Ser vad kunderna faktiskt frågar om</h3>
              <p>
                Dashboarden visar ämnen, lösningsgrad och kunskapsluckor — så
                du vet exakt vilken policysida som saknas.
              </p>
            </div>
            <div className="vt-feature">
              <h3>GDPR utan fotnoter</h3>
              <p>
                Data lagras inom EU. Ingen träning på dina kunders
                konversationer. Kunder kan själva exportera eller radera sin
                data direkt i widgeten.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- CTA panel ---------- */}
        <section className="vt-cta-panel">
          <h2>Se den svara på dina egna kundfrågor.</h2>
          <p>
            Vi sätter upp en pilot mot din riktiga kunskapsbas — du ser exakt
            hur boten hade svarat dina kunder, innan den möter en enda.
          </p>
          <Pill large inverse href={`mailto:${CONTACT_EMAIL}?subject=Pilot%20med%20Vitrio`}>
            Boka en demo
          </Pill>
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
