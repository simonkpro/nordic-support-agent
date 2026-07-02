import type { LoaderFunctionArgs, MetaFunction, LinksFunction } from 'react-router';
import { redirect, Link } from 'react-router';
import { color, font } from '../../components/ui/theme';

/**
 * Public landing (vitrio.se). The dashboard lives on its own subdomain
 * (dashboard.vitrio.se), so the marketing root always shows the lander —
 * we deliberately do NOT redirect signed-in visitors away from it. Only
 * the Shopify install flow (?shop=…) is special-cased into /app. Signed-in
 * users reach their dashboard via the "Logga in" CTA (which points at the
 * dashboard subdomain).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get('shop')) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export const meta: MetaFunction = () => [
  { title: 'Vitrio — Kundtjänst som aldrig gissar' },
  {
    name: 'description',
    content:
      'AI-kundtjänst för svensk e-handel. Svarar dygnet runt utifrån dina riktiga ordrar och policyer. Är den osäker kopplar den in dig i stället för att gissa.',
  },
  { property: 'og:title', content: 'Vitrio — Kundtjänst som aldrig gissar' },
  {
    property: 'og:description',
    content:
      'Svarar dygnet runt på dina kunders frågor, hämtat från din egen data. Kopplar in dig när den är osäker. En rad kod att installera.',
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
    --paper: ${color.paper};
    --panel: ${color.panel};
    --ink: ${color.ink};
    --gray: ${color.muted};
    --hairline: ${color.line};
    --green: ${color.brand};
    --green-deep: ${color.brandDeep};
    --sans: ${font.sans};
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
const BOOKING_URL = 'https://calendly.com/admin-vitrio/30min';

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
    <a className={cls} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="vt-arr" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2.6 7h8.8M7.7 3.3 11.4 7l-3.7 3.7"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
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
            <Pill href={BOOKING_URL}>Boka demo</Pill>
          </div>
        </header>

        {/* ---------- hero ---------- */}
        <section className="vt-hero">
          <h1 className="vt-h1">Kundtjänst som aldrig gissar.</h1>
          <p className="vt-lede">
            Vitrio svarar på dina kunders frågor dygnet runt, hämtat från dina
            riktiga ordrar, leveranser och policyer. Är den osäker chansar den
            inte. Då kopplar den in dig.
          </p>
          <div className="vt-hero-cta">
            <Pill large href={BOOKING_URL}>
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
            <h2>En rad kod. Sen är den igång.</h2>
            <p className="vt-body">
              Funkar på Shopify, WordPress eller ren HTML. Ingen app, ingen
              utvecklare. Klistra in raden på din sajt, så svarar boten på
              nästa kund som skriver.
            </p>
          </div>
          <div>
            <div className="vt-snippet">
              <span className="c">&lt;!-- före &lt;/body&gt; --&gt;</span>
              <br />
              &lt;script src=&quot;https://vitrio.se/widget.js&quot;{' '}
              data-assistant=&quot;…&quot; async defer&gt;&lt;/script&gt;
            </div>
          </div>
        </section>

        {/* ---------- statement ---------- */}
        <p className="vt-statement">
          Inga påhittade svar.
          <br />
          <span>Bara sånt du hade sagt själv.</span>
        </p>

        {/* ---------- how it works ---------- */}
        <section className="vt-section" id="sa-funkar-det" style={{ paddingTop: 0 }}>
          <p className="vt-label">Så funkar det</p>
          <div className="vt-steps">
            <div className="vt-step">
              <span className="vt-num">01</span>
              <h3>Vi lär den din butik</h3>
              <p>
                Vi läser in dina policyer, din FAQ och dina produktsidor, och
                kopplar på din orderdata. Du behöver inte lyfta ett finger.
              </p>
            </div>
            <div className="vt-step">
              <span className="vt-num">02</span>
              <h3>Du klistrar in en rad</h3>
              <p>
                Shopify, WordPress eller HTML. Boten är igång så fort sidan
                laddats om. Tar ungefär fem minuter.
              </p>
            </div>
            <div className="vt-step">
              <span className="vt-num">03</span>
              <h3>Du ser varje samtal</h3>
              <p>
                Vad kunderna frågar om, vad boten löste och vad den skickade
                vidare till dig. Allt samlat i din dashboard.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- features ---------- */}
        <section className="vt-section">
          <p className="vt-label">Byggd för att vara pålitlig</p>
          <div className="vt-features">
            <div className="vt-feature">
              <h3>Svarar bara på det den vet</h3>
              <p>
                Boten hämtar svaren från dina policyer, din orderdata och din
                spårning. Finns inte svaret säger den det, i stället för att
                hitta på.
              </p>
            </div>
            <div className="vt-feature">
              <h3>Vet när den ska lämna över</h3>
              <p>
                Känsliga ärenden och allt utanför kunskapsbasen går till dig,
                med en färdig sammanfattning så du slipper läsa hela tråden.
              </p>
            </div>
            <div className="vt-feature">
              <h3>Visar var kunderna fastnar</h3>
              <p>
                Dashboarden visar de vanligaste frågorna, hur många boten löste
                och var din information är för tunn. Så du vet vilken sida du
                borde skriva.
              </p>
            </div>
            <div className="vt-feature">
              <h3>GDPR utan strul</h3>
              <p>
                All data lagras inom EU. Vi tränar aldrig på dina kunders
                samtal. Och kunderna kan radera sin data själva, direkt i
                chatten.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- CTA panel ---------- */}
        <section className="vt-cta-panel">
          <h2>Se hur den svarar dina kunder, innan den möter en enda.</h2>
          <p>
            Vi bygger en pilot på din riktiga kunskapsbas och visar dig svaren.
            Gillar du inte vad du ser kostar det ingenting.
          </p>
          <Pill large inverse href={BOOKING_URL}>
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
