import { useRef, useState } from 'react';
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from 'react-router';
import { useFetcher, useLoaderData, useSearchParams } from 'react-router';
import { boundary } from '@shopify/shopify-app-react-router/server';
import { authenticate } from '../shopify.server';
import {
  deleteDocument,
  ingestDocument,
  listDocuments,
  type SupportedMime,
} from '../lib/knowledge.ts';
import { listAssistants, loadOrCreateDefaultAssistant } from '../lib/assistants.ts';

interface DocumentRow {
  id: string;
  assistantId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  createdAt: string;
  chunkCount: number;
}

interface AssistantOption {
  id: string;
  name: string;
  isDefault: boolean;
}

interface LoaderData {
  shop: string;
  active: AssistantOption;
  assistants: AssistantOption[];
  // All docs scoped to the active assistant OR shared. Mirrors what the
  // agent would see at runtime for this assistant.
  documents: DocumentRow[];
}

const ACCEPTED: Record<string, SupportedMime> = {
  'application/pdf': 'application/pdf',
  'text/markdown': 'text/markdown',
  'text/plain': 'text/plain',
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const all = await listAssistants(session.shop);
  // Active assistant: ?a=<id> if present and owned by this shop, else default.
  const url = new URL(request.url);
  const requestedId = url.searchParams.get('a');
  const requested = requestedId ? all.find((a) => a.id === requestedId) : undefined;
  const active = requested ?? (await loadOrCreateDefaultAssistant(session.shop));
  // Re-list assistants if we just lazily created the default.
  const assistants = all.length === 0 ? await listAssistants(session.shop) : all;

  const allDocs = await listDocuments(session.shop);
  const visible = allDocs.filter((d) => d.assistantId === null || d.assistantId === active.id);
  return {
    shop: session.shop,
    active: { id: active.id, name: active.name, isDefault: active.isDefault },
    assistants: assistants.map((a) => ({
      id: a.id,
      name: a.name,
      isDefault: a.isDefault,
    })),
    documents: visible.map((d) => ({
      id: d.id,
      assistantId: d.assistantId,
      filename: d.filename,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      status: d.status,
      error: d.error,
      createdAt: d.createdAt.toISOString(),
      chunkCount: d._count.chunks,
    })),
  };
};

interface ActionResponse {
  ok: boolean;
  intent?: string;
  message?: string;
  error?: string;
}

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResponse> => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get('intent');

  if (intent === 'delete') {
    const id = formData.get('id');
    if (typeof id !== 'string' || !id) {
      return { ok: false, intent: 'delete', error: 'missing id' };
    }
    await deleteDocument(session.shop, id);
    return { ok: true, intent: 'delete', message: 'Document deleted.' };
  }

  if (intent === 'upload') {
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return { ok: false, intent: 'upload', error: 'No file uploaded.' };
    }
    const mime = ACCEPTED[file.type];
    if (!mime) {
      return {
        ok: false,
        intent: 'upload',
        error: `Unsupported file type "${file.type}". Allowed: PDF, Markdown, plain text.`,
      };
    }
    const scope = String(formData.get('scope') ?? 'assistant');
    const scopeAssistantId = String(formData.get('scopeAssistantId') ?? '');
    const assistantId = scope === 'shared' ? null : scopeAssistantId || null;
    if (scope === 'assistant' && !assistantId) {
      return { ok: false, intent: 'upload', error: 'No assistant selected for scoped upload.' };
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await ingestDocument({
        shop: session.shop,
        assistantId,
        filename: file.name,
        mimeType: mime,
        bytes,
      });
      return { ok: true, intent: 'upload', message: `Indexed ${file.name}.` };
    } catch (err) {
      return { ok: false, intent: 'upload', error: (err as Error).message };
    }
  }

  return { ok: false, error: 'unknown intent' };
};

export default function KnowledgePage() {
  const { shop, active, assistants, documents } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [, setSearchParams] = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [chosenFile, setChosenFile] = useState<File | null>(null);
  const [scope, setScope] = useState<'assistant' | 'shared'>('assistant');

  const isBusy = fetcher.state !== 'idle';
  const submittingIntent =
    typeof fetcher.formData?.get('intent') === 'string'
      ? (fetcher.formData!.get('intent') as string)
      : null;
  const isUploading = isBusy && submittingIntent === 'upload';

  const switchTo = (id: string) => {
    const next = new URLSearchParams();
    next.set('a', id);
    setSearchParams(next, { replace: false });
  };

  const upload = () => {
    if (!chosenFile) return;
    const form = new FormData();
    form.set('intent', 'upload');
    form.set('file', chosenFile);
    form.set('scope', scope);
    if (scope === 'assistant') form.set('scopeAssistantId', active.id);
    fetcher.submit(form, { method: 'POST', encType: 'multipart/form-data' });
    setChosenFile(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (id: string) => {
    const form = new FormData();
    form.set('intent', 'delete');
    form.set('id', id);
    fetcher.submit(form, { method: 'POST' });
  };

  return (
    <s-page heading="Knowledge base">
      <s-section heading="Manage knowledge for">
        <s-paragraph>
          Each assistant has its own knowledge plus access to anything shared
          shop-wide. Pick the assistant you want to manage — its docs (plus
          shared) are listed below.
        </s-paragraph>

        <s-stack direction="inline" gap="base">
          <select
            value={active.id}
            onChange={(e) => switchTo(e.target.value)}
            style={{
              padding: '8px 10px',
              fontSize: 14,
              border: '1px solid #d1d5db',
              borderRadius: 6,
              minWidth: 240,
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

      <s-section heading="Upload a document">
        <s-paragraph>
          Supported: PDF, Markdown, plain text. Max 5 MB per file. Pick whether
          the document is scoped to <strong>{active.name}</strong> only or shared
          with every assistant in the shop.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
              }}
            >
              <input
                type="radio"
                name="scope"
                checked={scope === 'assistant'}
                onChange={() => setScope('assistant')}
              />
              Only {active.name}
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
              }}
            >
              <input
                type="radio"
                name="scope"
                checked={scope === 'shared'}
                onChange={() => setScope('shared')}
              />
              Shared with all assistants
            </label>
          </s-stack>

          <s-stack direction="inline" gap="base">
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
              onChange={(e) => setChosenFile(e.target.files?.[0] ?? null)}
              disabled={isUploading}
              style={{ fontSize: 13 }}
            />
            <s-button
              onClick={upload}
              {...(isUploading ? { loading: true } : {})}
              {...(chosenFile && !isUploading ? {} : { disabled: true })}
            >
              Upload &amp; index
            </s-button>
          </s-stack>
        </s-stack>

        {fetcher.data?.intent === 'upload' && fetcher.data.ok && (
          <s-paragraph>
            <s-text>{fetcher.data.message}</s-text>
          </s-paragraph>
        )}
        {fetcher.data?.intent === 'upload' && fetcher.data.ok === false && (
          <s-paragraph>
            <s-text>Error: {fetcher.data.error}</s-text>
          </s-paragraph>
        )}
      </s-section>

      <s-section
        heading={`Documents visible to ${active.name} (${documents.length})`}
      >
        <s-paragraph>
          This is exactly what <strong>{active.name}</strong> can search at runtime:
          its own scoped docs plus everything marked Shared.
        </s-paragraph>

        {documents.length === 0 && (
          <s-paragraph>No documents yet. Upload one above.</s-paragraph>
        )}

        <s-stack direction="block" gap="base">
          {documents.map((d) => (
            <s-box
              key={d.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
              background={d.status === 'failed' ? 'subdued' : undefined}
            >
              <s-stack direction="block" gap="base">
                <s-text>
                  <strong>{d.filename}</strong> · {d.mimeType} ·{' '}
                  {(d.sizeBytes / 1024).toFixed(1)} KB · {d.chunkCount} chunks ·{' '}
                  status: {d.status} · scope:{' '}
                  {d.assistantId === null
                    ? 'Shared'
                    : d.assistantId === active.id
                      ? `Only ${active.name}`
                      : 'Other assistant'}
                </s-text>
                {d.error && <s-text>Error: {d.error}</s-text>}
                <s-text>
                  uploaded: {new Date(d.createdAt).toLocaleString()}
                </s-text>
                <s-button variant="tertiary" onClick={() => remove(d.id)}>
                  Delete
                </s-button>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How scope works">
        <s-paragraph>
          Each upload is chunked (~500 chars), embedded via Cohere multilingual
          through AI Gateway, and stored in Postgres with pgvector.
        </s-paragraph>
        <s-paragraph>
          <strong>Shared</strong> docs are visible to every assistant in this shop.
          <strong> Assistant-scoped</strong> docs only show up when that assistant
          is active. The same doc can't currently be moved between scopes —
          re-upload to change.
        </s-paragraph>
        <s-paragraph>Shop: <s-text>{shop}</s-text></s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
