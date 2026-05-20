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
