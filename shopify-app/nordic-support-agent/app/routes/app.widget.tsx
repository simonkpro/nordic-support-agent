import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import { signWidgetToken } from '../lib/widget-token.ts';

interface LoaderData {
  shop: string;
  token: string;
  appUrl: string;
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const token = signWidgetToken(session.shop);
  return {
    shop: session.shop,
    token,
    appUrl: process.env.SHOPIFY_APP_URL || '',
  };
};

export default function Widget() {
  const { shop, token, appUrl } = useLoaderData<typeof loader>();

  const apiUrl = appUrl ? `${appUrl}/api/chat` : '/api/chat';

  const widgetUrl = appUrl ? `${appUrl}/widget.js` : '/widget.js';
  const snippet = `<!-- Nordic Support Agent — paste in theme.liquid before </body> -->
<script>
  window.NORDIC_SUPPORT = {
    token: ${JSON.stringify(token)},
    apiUrl: ${JSON.stringify(apiUrl)}
  };
</script>
<script src=${JSON.stringify(widgetUrl)} async defer></script>

<!--
  Brand color, agent name, default language, and tone are configured in
  the app's Settings page — no theme.liquid changes needed for those.

  Optional inline overrides (e.g. for a campaign landing page that needs
  different copy than the rest of the store):

  window.NORDIC_SUPPORT = {
    token: ${JSON.stringify(token).slice(0, 20)}...,
    apiUrl: ${JSON.stringify(apiUrl)},
    brand: { name: "Black Friday Help", color: "#000000" },
    text:  { placeholder: "Black Friday questions?" }
  };
-->`;

  const curlExample = `curl -X POST ${apiUrl} \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"message":"Var är min order #1001? anna@example.se"}'`;

  return (
    <s-page heading="Storefront widget integration">
      <s-section heading="Your shop's widget token">
        <s-paragraph>
          This token authenticates the widget on{' '}
          <strong>{shop}</strong>'s storefront to the chat API. Treat it like a public API
          key — it identifies your shop but cannot be used to access merchant admin data.
        </s-paragraph>
        <s-paragraph>
          The token is signed with the server's secret. Anyone with it can chat as your
          shop. If you suspect it's been leaked, rotate <code>WIDGET_TOKEN_SECRET</code> in
          your Vercel env — that invalidates every outstanding token.
        </s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <pre style={{ margin: 0, fontSize: '12px', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {token}
          </pre>
        </s-box>
      </s-section>

      <s-section heading="Storefront snippet">
        <s-paragraph>
          Paste this into your theme's <code>theme.liquid</code> just before{' '}
          <code>{'</body>'}</code>:
        </s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <pre style={{ margin: 0, fontSize: '12px', overflow: 'auto' }}>{snippet}</pre>
        </s-box>
      </s-section>

      <s-section heading="Quick test from the command line">
        <s-paragraph>
          Confirm the endpoint accepts your token:
        </s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <pre style={{ margin: 0, fontSize: '12px', overflow: 'auto' }}>{curlExample}</pre>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="What this protects">
        <s-paragraph>
          Without this token, any client could call <code>/api/chat</code> claiming any
          shop. With it, only callers who hold a server-signed token for THIS shop can chat,
          and the server scopes the conversation by the verified shop — body input is ignored.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
