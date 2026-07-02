import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import "./styles/globals.css";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        {/* Schibsted Grotesk — the dashboard shares the lander's typeface so
         * the two surfaces read as one product. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600&display=swap"
        />
        <Meta />
        <Links />
      </head>
      {/* suppressHydrationWarning: browser extensions like Grammarly inject
       * attributes (data-new-gr-c-s-check-loaded, data-gr-ext-installed) onto
       * <body> which React's hydration check reads as a server/client
       * mismatch. Nothing in our markup actually drifts — suppress on the
       * body only. */}
      <body suppressHydrationWarning>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
