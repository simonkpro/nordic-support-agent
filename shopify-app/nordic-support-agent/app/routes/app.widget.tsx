import { useState } from 'react';
import type { HeadersFunction, LoaderFunctionArgs } from 'react-router';
import { useLoaderData } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import { listAssistants } from '../lib/assistants.ts';
import { signWidgetToken } from '../lib/widget-token.ts';

interface AssistantOption {
  id: string;
  name: string;
  isDefault: boolean;
  token: string;
}

interface LoaderData {
  shop: string;
  appUrl: string;
  assistants: AssistantOption[];
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const all = await listAssistants(session.shop);
  // If the shop has zero assistants the embedded chat panel will lazily
  // create a default — but the widget page expects at least one. We don't
  // create here (loaders should stay pure-ish); render the empty state.
  return {
    shop: session.shop,
    appUrl: process.env.SHOPIFY_APP_URL || '',
    assistants: all.map((a) => ({
      id: a.id,
      name: a.name,
      isDefault: a.isDefault,
      // Each assistant gets its own token bound to its id. Customers
      // dropping the snippet on a given page reach this exact assistant.
      token: signWidgetToken(session.shop, { assistantId: a.id }),
    })),
  };
};

export default function Widget() {
  const { shop, appUrl, assistants } = useLoaderData<typeof loader>();
  const apiUrl = appUrl ? `${appUrl}/api/chat` : '/api/chat';
  const widgetUrl = appUrl ? `${appUrl}/widget.js` : '/widget.js';

  const initial = assistants.find((a) => a.isDefault) ?? assistants[0];
  const [selectedId, setSelectedId] = useState<string | undefined>(initial?.id);
  const selected = assistants.find((a) => a.id === selectedId);

  if (!selected) {
    return (
      <s-page heading="Storefront widget integration">
        <s-section heading="No assistants yet">
          <s-paragraph>
            Create an assistant in <s-link href="/app/settings">Settings</s-link> first,
            then come back here to copy the snippet.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const snippet = `<!-- Nordic Support Agent — paste in theme.liquid before </body> -->
<script>
  window.NORDIC_SUPPORT = {
    token: ${JSON.stringify(selected.token)},
    apiUrl: ${JSON.stringify(apiUrl)}
  };
</script>
<script src=${JSON.stringify(widgetUrl)} async defer></script>

<!--
  This token is bound to assistant "${selected.name}"${selected.isDefault ? ' (default)' : ''}.
  To embed a different assistant on a different page, pick another one
  above and paste its snippet there instead. Brand color, agent name,
  language, and tone are configured per-assistant in Settings — no
  theme.liquid changes needed when you tweak them.
-->`;

  const curlExample = `curl -X POST ${apiUrl} \\
  -H "Authorization: Bearer ${selected.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"message":"Var är min order #1001? anna@example.se"}'`;

  return (
    <s-page heading="Storefront widget integration">
      <s-section heading="Pick which assistant the snippet targets">
        <s-paragraph>
          Each snippet binds to a specific assistant — customers who load that page
          reach exactly that one. To run different personas on different pages, copy
          a different snippet for each.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <select
            value={selected.id}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{
              padding: '8px 10px',
              fontSize: 14,
              border: '1px solid #d1d5db',
              borderRadius: 6,
              minWidth: 220,
            }}
          >
            {assistants.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </s-stack>
      </s-section>

      <s-section heading={`Widget token for "${selected.name}"`}>
        <s-paragraph>
          Treat this like a public API key — it identifies the shop and assistant,
          but cannot access merchant admin data. To rotate every outstanding token
          across the shop, change <code>WIDGET_TOKEN_SECRET</code> in env.
        </s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <pre
            style={{
              margin: 0,
              fontSize: '12px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {selected.token}
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
          Confirm the endpoint accepts your token and routes to the right assistant:
        </s-paragraph>
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <pre style={{ margin: 0, fontSize: '12px', overflow: 'auto' }}>{curlExample}</pre>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="What this protects">
        <s-paragraph>
          Without a token, any client could call <code>/api/chat</code> claiming any
          shop. With it, only callers holding a server-signed token for THIS shop +
          assistant can chat. The server treats the token's assistant claim as
          authoritative — body parameters can't override it.
        </s-paragraph>
        <s-paragraph>Shop: <s-text>{shop}</s-text></s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
