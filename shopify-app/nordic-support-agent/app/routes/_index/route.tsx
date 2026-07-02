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
    href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700&family=Schibsted+Grotesk:wght@400;500&display=swap',
  },
];

const CSS = `
  .vt-root {
    /* Warm, inviting — light and clean (no greige), deep green brand kept. */
    --paper: #fbf9f4;      /* soft warm near-white */
    --card: #ffffff;
    --tint: #eef3ee;       /* whisper of green for cozy panels */
    --ink: #201d17;        /* warm espresso near-black */
    --gray: #6f6a60;       /* warm secondary text */
    --hairline: #e9e5db;   /* warm hairline */
    --green: ${color.brand};
    --green-deep: ${color.brandDeep};
    --sand: #f6efe3;       /* warm soft accent (badges, hovers) */
    --display: "Bricolage Grotesque", "Schibsted Grotesk", -apple-system, sans-serif;
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
    padding: 22px 0;
  }
  .vt-nav-l { display: flex; gap: 26px; }
  .vt-nav-l a, .vt-nav-r a.vt-plain {
    font-size: 14px; color: var(--ink); text-decoration: none;
  }
  .vt-nav-l a:hover, .vt-nav-r a.vt-plain:hover { color: var(--gray); }
  .vt-wordmark {
    font-family: var(--display); font-size: 25px; font-weight: 700;
    letter-spacing: -0.02em; color: var(--ink); text-decoration: none;
    justify-self: center;
  }
  .vt-nav-r { display: flex; gap: 24px; align-items: center; justify-self: end; }

  /* ------- buttons ------- */
  .vt-pill {
    display: inline-flex; align-items: center; gap: 10px;
    background: var(--green); color: #fff !important;
    border-radius: 999px; padding: 11px 9px 11px 22px;
    font-size: 14px; font-weight: 500; text-decoration: none;
    transition: transform 140ms ease, background 140ms ease, box-shadow 140ms ease;
    box-shadow: 0 6px 18px -10px rgba(14,61,42,0.5);
  }
  .vt-pill:hover { background: var(--green-deep); transform: translateY(-1px); box-shadow: 0 12px 26px -12px rgba(14,61,42,0.55); }
  .vt-pill .vt-arr {
    width: 26px; height: 26px; border-radius: 50%; background: #fff;
    color: var(--green); display: inline-flex; align-items: center;
    justify-content: center; font-size: 13px;
  }
  .vt-pill-lg { padding: 14px 11px 14px 28px; font-size: 15px; }
  .vt-pill-lg .vt-arr { width: 30px; height: 30px; }
  .vt-pill-inverse { background: #fff; color: var(--green) !important; }
  .vt-pill-inverse:hover { background: #f4f0e8; }
  .vt-pill-inverse .vt-arr { background: var(--green); color: #fff; }

  /* ------- hero ------- */
  .vt-hero { text-align: center; padding: 96px 0 68px; }
  .vt-badge {
    display: inline-flex; align-items: center; gap: 8px;
    background: var(--tint); color: var(--green);
    border-radius: 999px; padding: 7px 15px; margin: 0 0 26px;
    font-size: 13px; font-weight: 500;
  }
  .vt-badge .vt-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
  .vt-h1 {
    font-family: var(--display);
    font-weight: 600; font-size: clamp(44px, 6.6vw, 82px);
    line-height: 1.02; letter-spacing: -0.03em; margin: 0 auto 22px;
    max-width: 15ch;
  }
  .vt-h1 em { font-style: normal; color: var(--green); }
  .vt-lede {
    font-size: 18px; color: var(--gray); max-width: 540px;
    margin: 0 auto 34px; line-height: 1.55;
  }
  .vt-hero-cta { display: flex; gap: 24px; justify-content: center; align-items: center; }
  .vt-hero-cta .vt-signin { font-size: 14px; color: var(--ink); text-decoration: none; }
  .vt-hero-cta .vt-signin:hover { color: var(--gray); }

  /* ------- product canvas ------- */
  .vt-canvas {
    background: var(--tint); border-radius: 28px;
    padding: clamp(28px, 5vw, 60px);
    display: grid; grid-template-columns: 1fr 400px; gap: clamp(28px, 5vw, 64px);
    align-items: center; margin-bottom: 44px;
  }
  .vt-canvas > div { min-width: 0; }
  .vt-canvas-label { font-size: 13px; color: var(--green); font-weight: 500; margin: 0 0 14px; }
  .vt-canvas h2 {
    font-family: var(--display); font-weight: 600; font-size: clamp(26px, 2.8vw, 34px);
    letter-spacing: -0.02em; line-height: 1.12; margin: 0 0 14px;
  }
  .vt-canvas p.vt-body { font-size: 15px; color: var(--gray); margin: 0 0 28px; max-width: 44ch; line-height: 1.6; }
  .vt-snippet {
    background: var(--card); border: 1px solid var(--hairline); border-radius: 16px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12.5px; line-height: 1.7; color: var(--ink);
    padding: 16px 18px; overflow-wrap: break-word;
    box-shadow: 0 12px 30px -22px rgba(32,29,23,0.5);
  }
  .vt-snippet .c { color: var(--gray); }

  /* ------- sections ------- */
  .vt-label {
    font-size: 13px; color: var(--green); font-weight: 500; margin: 0 0 34px;
  }
  .vt-section { padding: 92px 0 0; }
  .vt-statement {
    text-align: center; padding: 120px 0;
    font-family: var(--display); font-weight: 600; font-size: clamp(32px, 4.2vw, 52px);
    letter-spacing: -0.025em; line-height: 1.08; margin: 0;
  }
  .vt-statement span { color: var(--gray); }

  /* how-it-works: soft rounded cards */
  .vt-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .vt-step {
    background: var(--card); border: 1px solid var(--hairline);
    border-radius: 20px; padding: 26px 24px 28px;
  }
  .vt-step .vt-num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border-radius: 50%; background: var(--tint);
    color: var(--green); font-size: 13px; font-weight: 600; margin-bottom: 22px;
  }
  .vt-step h3 { font-family: var(--display); font-size: 19px; font-weight: 600; margin: 0 0 8px; letter-spacing: -0.01em; }
  .vt-step p { font-size: 14.5px; color: var(--gray); margin: 0; line-height: 1.55; }

  /* features: soft rounded cards */
  .vt-features { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .vt-feature {
    background: var(--card); border: 1px solid var(--hairline);
    border-radius: 20px; padding: 30px 30px 32px;
    transition: transform 160ms ease, box-shadow 160ms ease;
  }
  .vt-feature:hover { transform: translateY(-2px); box-shadow: 0 20px 40px -28px rgba(32,29,23,0.4); }
  .vt-feature h3 { font-family: var(--display); font-size: 19px; font-weight: 600; margin: 0 0 9px; letter-spacing: -0.01em; }
  .vt-feature p { font-size: 14.5px; color: var(--gray); margin: 0; max-width: 46ch; line-height: 1.55; }

  /* ------- CTA panel ------- */
  .vt-cta-panel {
    background: var(--green); color: #fff; border-radius: 28px;
    padding: clamp(48px, 7vw, 92px) clamp(28px, 5vw, 80px);
    display: flex; flex-direction: column; align-items: flex-start; gap: 28px;
    margin: 108px 0 0;
  }
  .vt-cta-panel h2 {
    font-family: var(--display); font-weight: 600; font-size: clamp(30px, 3.8vw, 46px);
    letter-spacing: -0.025em; line-height: 1.08; margin: 0; max-width: 22ch;
  }
  .vt-cta-panel p { font-size: 15.5px; color: rgba(255,255,255,0.74); margin: -10px 0 0; max-width: 52ch; line-height: 1.55; }

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
    .vt-steps { grid-template-columns: 1fr; gap: 16px; }
    .vt-features { grid-template-columns: 1fr; gap: 16px; }
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
          <span className="vt-badge">
            <span className="vt-dot" /> AI-kundtjänst för svensk e-handel
          </span>
          <h1 className="vt-h1">
            Kundtjänst som <em>aldrig gissar.</em>
          </h1>
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
