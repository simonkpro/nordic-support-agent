import { useEffect, useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, redirect, useFetcher, useLoaderData, useRevalidator } from 'react-router';
import { requireWorkspace } from '../lib/workspace-auth';
import { loadOrCreateDefaultAssistant, updateAssistant } from '../lib/assistants';
import {
  deleteDocument,
  ingestDocument,
  listDocuments,
  type SupportedMime,
} from '../lib/knowledge';
import { crawlSitemap } from '../lib/sitemap-crawler';
import { FieldLabel, OnboardingShell, TextInput } from '../components/onboarding-shell';
import { Card, SectionLabel, SHELL_TOKENS } from '../components/admin-shell';
import { Textarea, font } from '../components/ui';

const ACCEPTED_MIME: Record<string, SupportedMime> = {
  'application/pdf': 'application/pdf',
  'text/markdown': 'text/markdown',
  'text/plain': 'text/plain',
};

interface DocRow {
  id: string;
  filename: string;
  sizeBytes: number;
  status: string;
  error: string | null;
}

interface LoaderData {
  assistantId: string;
  sitemapUrl: string;
  sitemapExcludeGlobs: string;
  documents: DocRow[];
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const { workspace } = await requireWorkspace(request);
  const shop = workspace.id;
  const assistant = await loadOrCreateDefaultAssistant(shop);
  const docs = await listDocuments(shop);
  return {
    assistantId: assistant.id,
    sitemapUrl: assistant.config.business.sitemapUrl,
    sitemapExcludeGlobs: assistant.config.business.sitemapExcludeGlobs,
    documents: docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      sizeBytes: d.sizeBytes,
      status: d.status,
      error: d.error,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { workspace } = await requireWorkspace(request);
  const shop = workspace.id;
  const form = await request.formData();
  const intent = form.get('intent');
  const assistant = await loadOrCreateDefaultAssistant(shop);

  if (intent === 'upload') {
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    for (const file of files) {
      const mime = ACCEPTED_MIME[file.type];
      if (!mime) continue;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await ingestDocument({
          shop,
          assistantId: assistant.id,
          filename: file.name,
          mimeType: mime,
          bytes,
        });
      } catch (err) {
        console.warn('[onboarding/knowledge] ingest failed', file.name, err);
      }
    }
    return { ok: true, intent: 'upload' };
  }
  if (intent === 'delete-doc') {
    await deleteDocument(shop, String(form.get('id') ?? ''));
    return { ok: true, intent: 'delete-doc' };
  }
  if (intent === 'save-sitemap') {
    await updateAssistant(assistant.id, {
      config: {
        ...assistant.config,
        business: {
          ...assistant.config.business,
          sitemapUrl: String(form.get('sitemapUrl') ?? ''),
          sitemapExcludeGlobs: String(form.get('sitemapExcludeGlobs') ?? ''),
        },
      },
    });
    return { ok: true, intent: 'save-sitemap' };
  }
  if (intent === 'crawl-sitemap') {
    // Persist sitemap config first so the crawler picks up edits the
    // merchant typed into the form.
    const sitemapUrl = String(form.get('sitemapUrl') ?? '').trim();
    const sitemapExcludeGlobs = String(form.get('sitemapExcludeGlobs') ?? '');
    if (!sitemapUrl) {
      return { ok: false, intent: 'crawl-sitemap', error: 'Ange en sitemap-URL.' };
    }
    try {
      // Quick syntactic check; the crawler does network-level validation.
      new URL(sitemapUrl);
    } catch {
      return {
        ok: false,
        intent: 'crawl-sitemap',
        error: 'Ogiltig URL — använd t.ex. https://din-sajt.com/sitemap.xml',
      };
    }
    await updateAssistant(assistant.id, {
      config: {
        ...assistant.config,
        business: {
          ...assistant.config.business,
          sitemapUrl,
          sitemapExcludeGlobs,
        },
      },
    });
    const excludeGlobs = sitemapExcludeGlobs
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Fire-and-forget. The crawler writes pages into KnowledgeDocument /
    // KnowledgeChunk as they're processed, so the next page load shows
    // progress. We don't await — the user can continue with onboarding
    // (or sit on this step and watch the doc list grow on reload).
    crawlSitemap({ shop, assistantId: assistant.id, sitemapUrl, excludeGlobs })
      .catch((err) => {
        console.warn('[onboarding/crawl] failed:', (err as Error).message);
      });
    return { ok: true, intent: 'crawl-sitemap', started: true } as const;
  }
  // Default = continue
  return redirect('/onboarding/persona');
};

type Tab = 'upload' | 'sitemap' | 'skip';

export default function OnboardingKnowledge() {
  const data = useLoaderData<typeof loader>();
  const [tab, setTab] = useState<Tab>('upload');
  const uploadFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const revalidator = useRevalidator();

  // Re-fetch the doc list after an upload or delete completes.
  // NB: do NOT depend on `revalidator` — useRevalidator() returns a
  // fresh object reference on every render, so including it makes the
  // effect re-run after each revalidate() and loop forever.
  useEffect(() => {
    if (uploadFetcher.state === 'idle' && uploadFetcher.data) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFetcher.state, uploadFetcher.data]);
  useEffect(() => {
    if (deleteFetcher.state === 'idle' && deleteFetcher.data) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state, deleteFetcher.data]);

  const indexed = data.documents.filter((d) => d.status === 'indexed').length;
  const ingesting = data.documents.filter((d) => d.status === 'ingesting').length;
  const failed = data.documents.filter((d) => d.status === 'failed').length;

  return (
    <OnboardingShell
      step="knowledge"
      title="Lär upp din agent."
      subtitle="Välj minst en källa. Du kan lägga till fler senare från dashboarden. Indexeringen körs i bakgrunden — fortsätt medan den jobbar."
      primaryAction={{ method: 'POST', intent: 'continue', nextHref: '/onboarding/persona' }}
    >
      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: `1px solid ${SHELL_TOKENS.line}`,
          marginBottom: 28,
        }}
      >
        <TabButton
          active={tab === 'upload'}
          onClick={() => setTab('upload')}
          letter="A"
          label="Ladda upp dokument"
          tag="rekommenderas"
        />
        <TabButton
          active={tab === 'sitemap'}
          onClick={() => setTab('sitemap')}
          letter="B"
          label="Sitemap-genomsökning"
        />
        <TabButton
          active={tab === 'skip'}
          onClick={() => setTab('skip')}
          letter="C"
          label="Hoppa över"
        />
      </div>

      {tab === 'upload' && (
        <div className="resp-two-col" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 32 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            <div>
              <FieldLabel
                label="Dra & släpp filer"
                hint="PDF · Markdown · text · max 20 MB / fil"
              />
              <Dropzone
                onFiles={(files) => {
                  const fd = new FormData();
                  fd.set('intent', 'upload');
                  for (const f of files) fd.append('files', f);
                  uploadFetcher.submit(fd, {
                    method: 'POST',
                    encType: 'multipart/form-data',
                  });
                }}
                uploading={uploadFetcher.state === 'submitting'}
              />
            </div>
            <div>
              <FieldLabel
                label="Uppladdade filer"
                hint={`${data.documents.length} totalt · ${indexed} indexerade${
                  ingesting ? ` · ${ingesting} bearbetas` : ''
                }${failed ? ` · ${failed} misslyckade` : ''}`}
              />
              <Card padding={0}>
                {data.documents.length === 0 ? (
                  <p
                    style={{
                      padding: 18,
                      margin: 0,
                      fontSize: 13,
                      color: SHELL_TOKENS.muted,
                    }}
                  >
                    Inga filer uppladdade ännu.
                  </p>
                ) : (
                  data.documents.map((d, i) => (
                    <FileRow
                      key={d.id}
                      doc={d}
                      isFirst={i === 0}
                      onDelete={() => {
                        const fd = new FormData();
                        fd.set('intent', 'delete-doc');
                        fd.set('id', d.id);
                        deleteFetcher.submit(fd, { method: 'POST' });
                      }}
                    />
                  ))
                )}
              </Card>
            </div>
          </div>
          <IndexStatusCard
            total={data.documents.length}
            indexed={indexed}
            ingesting={ingesting}
            failed={failed}
          />
        </div>
      )}

      {tab === 'sitemap' && <SitemapTab initialData={data} />}

      {tab === 'skip' && (
        <Card>
          <SectionLabel>Hoppa över</SectionLabel>
          <p style={{ margin: 0, fontSize: 13.5, color: SHELL_TOKENS.ink, lineHeight: 1.6 }}>
            Din agent kommer bara att känna till det som står i dess
            systemprompt. Du kan lägga till kunskap när som helst från
            dashboarden under <strong>Inställningar → Kunskapskällor</strong>.
          </p>
        </Card>
      )}

      {/* Continue form — empty, just submits POST to advance. */}
      <Form method="post" id="onboarding-form-continue" replace={false} style={{ display: 'none' }} />
    </OnboardingShell>
  );
}

function SitemapTab({ initialData }: { initialData: LoaderData }) {
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const submitting = fetcher.state !== 'idle';
  const result =
    fetcher.data && 'intent' in fetcher.data && fetcher.data.intent === 'crawl-sitemap'
      ? fetcher.data
      : null;
  const started = !!(result && result.ok && 'started' in result && result.started);

  // Poll the doc list every 4s while the crawl is running so the
  // merchant sees pages flow into the index without leaving the page.
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => revalidator.revalidate(), 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  return (
    <fetcher.Form method="post" id="onboarding-form">
      <input type="hidden" name="intent" value="crawl-sitemap" />
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 32 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <FieldLabel label="Sitemap-URL" hint="t.ex. https://example.com/sitemap.xml" />
            <TextInput
              name="sitemapUrl"
              defaultValue={initialData.sitemapUrl}
              placeholder="https://din-sajt.com/sitemap.xml"
              type="url"
              mono
            />
          </div>
          <div>
            <FieldLabel
              label="Uteslut sökvägar"
              hint="en per rad · standardvärden ifyllda"
            />
            <Textarea
              name="sitemapExcludeGlobs"
              defaultValue={initialData.sitemapExcludeGlobs}
              rows={6}
              style={{ fontSize: 13, fontFamily: font.mono }}
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            style={{
              alignSelf: 'flex-start',
              background: SHELL_TOKENS.brand,
              color: '#fff',
              border: 0,
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 500,
              cursor: submitting ? 'wait' : 'pointer',
              fontFamily: 'inherit',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? 'Startar…' : started ? 'Kör igen →' : 'Starta genomsökning →'}
          </button>
          {result && !result.ok && 'error' in result && (
            <div
              style={{
                padding: 12,
                background: '#fee2e2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {result.error}
            </div>
          )}
          {started && (
            <div
              style={{
                padding: 14,
                background: SHELL_TOKENS.card,
                border: `1px solid ${SHELL_TOKENS.line}`,
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.6,
                color: SHELL_TOKENS.ink,
              }}
            >
              <strong>Genomsökning startad.</strong> Vi indexerar i bakgrunden —
              du kan fortsätta till nästa steg. Sidorna dyker upp i listan
              ovan allt eftersom de bearbetas.
            </div>
          )}
        </div>
        <Card>
          <SectionLabel>Så fungerar det</SectionLabel>
          <p style={{ margin: 0, fontSize: 13, color: SHELL_TOKENS.muted, lineHeight: 1.6 }}>
            Vi hämtar varje sida i din sitemap, extraherar huvudinnehållet
            och indexerar det. Boten kan sedan citera sidan med en länk.
            Genomsökningen kör i bakgrunden — du behöver inte vänta. Du kan
            även se status under <strong>Inställningar → Kunskapskällor</strong>{' '}
            i dashboarden.
          </p>
        </Card>
      </div>
    </fetcher.Form>
  );
}

function TabButton({
  active,
  onClick,
  letter,
  label,
  tag,
}: {
  active: boolean;
  onClick: () => void;
  letter: string;
  label: string;
  tag?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '14px 20px',
        border: 0,
        background: 'transparent',
        borderBottom: `2px solid ${active ? SHELL_TOKENS.ink : 'transparent'}`,
        marginBottom: -1,
        color: active ? SHELL_TOKENS.ink : SHELL_TOKENS.muted,
        fontWeight: active ? 600 : 400,
        fontSize: 13.5,
        fontFamily: 'inherit',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span
        style={{
          fontFamily:
            '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          color: SHELL_TOKENS.muted,
        }}
      >
        {letter}.
      </span>
      {label}
      {tag && (
        <span
          style={{
            fontFamily:
              '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: SHELL_TOKENS.brand,
            border: `1px solid ${SHELL_TOKENS.brand}`,
            padding: '2px 6px',
            borderRadius: 3,
          }}
        >
          {tag}
        </span>
      )}
    </button>
  );
}

function Dropzone({
  onFiles,
  uploading,
}: {
  onFiles: (files: File[]) => void;
  uploading: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      style={{
        minHeight: 140,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: 20,
        border: `1.5px dashed ${over ? SHELL_TOKENS.brand : SHELL_TOKENS.line}`,
        borderRadius: 10,
        background: over ? SHELL_TOKENS.card : SHELL_TOKENS.bg,
        cursor: 'pointer',
        transition: 'border-color 120ms, background 120ms',
      }}
    >
      <div
        style={{
          fontFamily:
            '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          color: SHELL_TOKENS.muted,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
        }}
      >
        {uploading ? 'Laddar upp…' : 'Släpp filer här'}
      </div>
      <div style={{ fontSize: 13, color: SHELL_TOKENS.ink }}>
        eller{' '}
        <span style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
          bläddra på datorn
        </span>
      </div>
      <div
        style={{
          fontFamily:
            '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 10,
          color: SHELL_TOKENS.muted,
        }}
      >
        flera filer ok · max 20 MB / fil
      </div>
      <input
        type="file"
        multiple
        accept="application/pdf,text/markdown,text/plain"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length) onFiles(files);
        }}
        style={{ display: 'none' }}
      />
    </label>
  );
}

function FileRow({
  doc,
  isFirst,
  onDelete,
}: {
  doc: DocRow;
  isFirst: boolean;
  onDelete: () => void;
}) {
  const dotColor =
    doc.status === 'indexed'
      ? SHELL_TOKENS.green
      : doc.status === 'failed'
        ? '#b91c1c'
        : doc.status === 'ingesting'
          ? SHELL_TOKENS.brand
          : SHELL_TOKENS.muted;
  const statusLabel = (
    {
      indexed: 'indexerad',
      ingesting: 'bearbetas',
      failed: 'misslyckad',
    } as Record<string, string>
  )[doc.status] || 'i kö';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderTop: isFirst ? 'none' : `1px dashed ${SHELL_TOKENS.lineDash}`,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: SHELL_TOKENS.ink,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {doc.filename}
        </div>
        <div
          style={{
            fontFamily:
              '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 10,
            color: SHELL_TOKENS.muted,
            marginTop: 2,
          }}
        >
          {formatBytes(doc.sizeBytes)}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily:
            '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 10,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: doc.status === 'failed' ? '#b91c1c' : SHELL_TOKENS.muted,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: dotColor,
          }}
        />
        {statusLabel}
      </div>
      <button
        type="button"
        onClick={onDelete}
        title="Ta bort"
        style={{
          border: 0,
          background: 'transparent',
          color: SHELL_TOKENS.muted,
          cursor: 'pointer',
          fontSize: 16,
          padding: 4,
        }}
      >
        ×
      </button>
    </div>
  );
}

function IndexStatusCard({
  total,
  indexed,
  ingesting,
  failed,
}: {
  total: number;
  indexed: number;
  ingesting: number;
  failed: number;
}) {
  return (
    <Card>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <SectionLabel>Indexstatus</SectionLabel>
        <span style={{ fontSize: 10, color: SHELL_TOKENS.brand }}>● live</span>
      </div>
      <Stat label="Filer" value={String(total)} />
      <Stat label="Indexerade" value={String(indexed)} bar={total ? indexed / total : 0} />
      <Stat label="Bearbetas" value={String(ingesting)} muted />
      <Stat label="Misslyckade" value={String(failed)} muted />
      <p
        style={{
          margin: '14px 0 0',
          paddingTop: 12,
          borderTop: `1px dashed ${SHELL_TOKENS.lineDash}`,
          fontSize: 11,
          color: SHELL_TOKENS.muted,
          lineHeight: 1.5,
        }}
      >
        Indexering kör i bakgrunden — du kan fortsätta.
      </p>
    </Card>
  );
}

function Stat({
  label,
  value,
  bar,
  muted,
}: {
  label: string;
  value: string;
  bar?: number;
  muted?: boolean;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: muted ? SHELL_TOKENS.muted : SHELL_TOKENS.ink,
          fontFamily:
            '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span style={{ fontWeight: 600 }}>{value}</span>
      </div>
      {bar != null && (
        <div
          style={{
            height: 3,
            background: SHELL_TOKENS.line,
            position: 'relative',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: `${bar * 100}%`,
              background: SHELL_TOKENS.brand,
            }}
          />
        </div>
      )}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
