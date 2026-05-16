import { useEffect, useRef, useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import { createConversation } from '../lib/conversations.ts';
import {
  createAssistant,
  deleteAssistant,
  getAssistant,
  listAssistants,
  loadOrCreateDefaultAssistant,
  setDefaultAssistant,
  updateAssistant,
  type AssistantConfig,
  type AssistantRecord,
  type FewShotExample,
} from '../lib/assistants.ts';
import {
  deleteDocument,
  ingestDocument,
  listDocuments,
  type SupportedMime,
} from '../lib/knowledge.ts';
import { signWidgetToken } from '../lib/widget-token.ts';
import { AssistantModal } from '../components/assistant-ui/assistant-modal';
import { ChatRuntimeProvider } from '../components/assistant-ui/chat-runtime';

/**
 * Unified test surface. Multiple assistants per preview shop, each with
 * its own config + chat. The active assistant is tracked in the URL
 * (?a=<id>) so the form remounts with the right config on switch.
 *
 * NOT auth-gated. Strip before production.
 */
const PREVIEW_SHOP = 'preview-shop.myshopify.com';
const MAX_FEW_SHOT = 5;

const ACCEPTED_MIME: Record<string, SupportedMime> = {
  'application/pdf': 'application/pdf',
  'text/markdown': 'text/markdown',
  'text/plain': 'text/plain',
};

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

interface AssistantSummary {
  id: string;
  name: string;
  isDefault: boolean;
}

interface LoaderData {
  widgetToken: string;
  conversationId: string;
  active: { id: string; name: string; isDefault: boolean; config: AssistantConfig };
  assistants: AssistantSummary[];
  documents: DocumentRow[];
}

async function pickActive(requestedId: string | null): Promise<AssistantRecord> {
  if (requestedId) {
    const found = await getAssistant(requestedId);
    if (found && found.shop === PREVIEW_SHOP) return found;
  }
  return loadOrCreateDefaultAssistant(PREVIEW_SHOP);
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const url = new URL(request.url);
  const active = await pickActive(url.searchParams.get('a'));
  const all = await listAssistants(PREVIEW_SHOP);
  const convo = await createConversation(PREVIEW_SHOP, {
    language: active.config.language,
    country: active.config.country,
    verifiedEmail: null,
  });
  const docs = await listDocuments(PREVIEW_SHOP);
  return {
    widgetToken: signWidgetToken(PREVIEW_SHOP, { assistantId: active.id }),
    conversationId: convo.id,
    active: {
      id: active.id,
      name: active.name,
      isDefault: active.isDefault,
      config: active.config,
    },
    assistants: all.map((a) => ({ id: a.id, name: a.name, isDefault: a.isDefault })),
    documents: docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      status: d.status,
      error: d.error,
      createdAt: d.createdAt.toISOString(),
      assistantId: d.assistantId,
      chunkCount: d._count.chunks,
    })),
  };
};

interface ActionResponse {
  ok: boolean;
  intent?: string;
  message?: string;
  navigateTo?: string;
  error?: string;
}

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResponse> => {
  const formData = await request.formData();
  const intent = formData.get('intent');

  // --- assistant lifecycle ---
  if (intent === 'create-assistant') {
    const name = String(formData.get('name') ?? '').trim() || 'Untitled assistant';
    try {
      const created = await createAssistant({ shop: PREVIEW_SHOP, name });
      return { ok: true, intent: 'create-assistant', navigateTo: `?a=${created.id}` };
    } catch (err) {
      return { ok: false, intent: 'create-assistant', error: (err as Error).message };
    }
  }
  if (intent === 'rename-assistant') {
    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    if (!id || !name) return { ok: false, intent: 'rename-assistant', error: 'missing fields' };
    try {
      await updateAssistant(id, { name });
      return { ok: true, intent: 'rename-assistant' };
    } catch (err) {
      return { ok: false, intent: 'rename-assistant', error: (err as Error).message };
    }
  }
  if (intent === 'delete-assistant') {
    const id = String(formData.get('id') ?? '');
    if (!id) return { ok: false, intent: 'delete-assistant', error: 'missing id' };
    try {
      const newDefault = await deleteAssistant(id);
      return {
        ok: true,
        intent: 'delete-assistant',
        navigateTo: newDefault ? `?a=${newDefault.id}` : '?',
      };
    } catch (err) {
      return { ok: false, intent: 'delete-assistant', error: (err as Error).message };
    }
  }
  if (intent === 'set-default-assistant') {
    const id = String(formData.get('id') ?? '');
    if (!id) return { ok: false, intent: 'set-default-assistant', error: 'missing id' };
    try {
      await setDefaultAssistant(id);
      return { ok: true, intent: 'set-default-assistant' };
    } catch (err) {
      return { ok: false, intent: 'set-default-assistant', error: (err as Error).message };
    }
  }

  // --- knowledge base ---
  if (intent === 'upload-doc') {
    const file = formData.get('file');
    if (!(file instanceof File)) return { ok: false, intent: 'upload-doc', error: 'no file' };
    const mime = ACCEPTED_MIME[file.type];
    if (!mime) {
      return {
        ok: false,
        intent: 'upload-doc',
        error: `Unsupported file type "${file.type}". Allowed: PDF, Markdown, plain text.`,
      };
    }
    // Scope: 'shared' (NULL) or 'assistant' (active assistant's id).
    const scopeMode = String(formData.get('scope') ?? 'assistant');
    const scopeAssistantId = String(formData.get('scopeAssistantId') ?? '');
    const assistantId = scopeMode === 'shared' ? null : scopeAssistantId || null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await ingestDocument({
        shop: PREVIEW_SHOP,
        assistantId,
        filename: file.name,
        mimeType: mime,
        bytes,
      });
      return { ok: true, intent: 'upload-doc', message: `Indexed ${file.name}.` };
    } catch (err) {
      return { ok: false, intent: 'upload-doc', error: (err as Error).message };
    }
  }
  if (intent === 'delete-doc') {
    const id = String(formData.get('id') ?? '');
    if (!id) return { ok: false, intent: 'delete-doc', error: 'missing id' };
    await deleteDocument(PREVIEW_SHOP, id);
    return { ok: true, intent: 'delete-doc', message: 'Deleted.' };
  }

  // --- save settings (default intent) ---
  const id = String(formData.get('assistantId') ?? '');
  if (!id) return { ok: false, intent: 'save-settings', error: 'missing assistantId' };

  let fewShotExamples: unknown = [];
  const rawExamples = formData.get('agent.fewShotExamples');
  if (typeof rawExamples === 'string' && rawExamples.length > 0) {
    try {
      fewShotExamples = JSON.parse(rawExamples);
    } catch {
      return { ok: false, intent: 'save-settings', error: 'invalid few-shot JSON' };
    }
  }
  function parseStringArray(value: FormDataEntryValue | null): string[] {
    if (typeof value !== 'string' || value.length === 0) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }

  // Parse the two JSON-encoded array fields (locations, purposes).
  let physicalLocations: unknown = [];
  const rawLocations = formData.get('business.physicalLocations');
  if (typeof rawLocations === 'string' && rawLocations.length > 0) {
    try {
      physicalLocations = JSON.parse(rawLocations);
    } catch {
      return { ok: false, intent: 'save-settings', error: 'invalid locations JSON' };
    }
  }
  let chatbotPurposes: unknown = [];
  const rawPurposes = formData.get('business.chatbotPurposes');
  if (typeof rawPurposes === 'string' && rawPurposes.length > 0) {
    try {
      chatbotPurposes = JSON.parse(rawPurposes);
    } catch {
      return { ok: false, intent: 'save-settings', error: 'invalid purposes JSON' };
    }
  }

  const candidate: unknown = {
    business: {
      companyName: formData.get('business.companyName') ?? '',
      type: formData.get('business.type') ?? undefined,
      ecommerceProductTypes: formData.get('business.ecommerceProductTypes') ?? '',
      description: formData.get('business.description') ?? '',
      physicalLocations,
      chatbotPurposes,
    },
    agent: {
      name: formData.get('agent.name') ?? undefined,
      tone: formData.get('agent.tone') ?? undefined,
      greeting: formData.get('agent.greeting') ?? '',
      signature: formData.get('agent.signature') ?? '',
      customRules: formData.get('agent.customRules') ?? '',
      thinkingVerbs: parseStringArray(formData.get('agent.thinkingVerbs')),
      errorPhrases: {
        generic: formData.get('agent.errorPhrases.generic') ?? '',
        network: formData.get('agent.errorPhrases.network') ?? '',
        rateLimit: formData.get('agent.errorPhrases.rateLimit') ?? '',
        tooLong: formData.get('agent.errorPhrases.tooLong') ?? '',
        tooManyTurns: formData.get('agent.errorPhrases.tooManyTurns') ?? '',
        unconfigured: formData.get('agent.errorPhrases.unconfigured') ?? '',
      },
      fewShotExamples,
    },
    widget: {
      primaryColor: formData.get('widget.primaryColor') ?? undefined,
      accentColor: formData.get('widget.accentColor') ?? undefined,
      iconStyle: formData.get('widget.iconStyle') ?? undefined,
      width: Number(formData.get('widget.width') ?? 400),
      height: Number(formData.get('widget.height') ?? 540),
    },
    language: formData.get('language') ?? undefined,
    country: formData.get('country') ?? undefined,
  };
  try {
    await updateAssistant(id, { config: candidate });
    return { ok: true, intent: 'save-settings' };
  } catch (err) {
    const detail =
      err && typeof err === 'object' && 'issues' in err
        ? JSON.stringify((err as { issues: unknown }).issues)
        : (err as Error).message;
    return { ok: false, intent: 'save-settings', error: detail };
  }
};

export default function Preview() {
  const data = useLoaderData<typeof loader>();
  const [, setSearchParams] = useSearchParams();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  // The whole settings panel + chat is re-keyed on active assistant id so
  // form state and conversation reset cleanly on switch.
  return <PreviewBody key={data.active.id} data={data} fetcher={fetcher}
    setSearchParams={setSearchParams} revalidator={revalidator} />;
}

function PreviewBody({
  data,
  fetcher,
  setSearchParams,
  revalidator,
}: {
  data: LoaderData;
  fetcher: ReturnType<typeof useFetcher<typeof action>>;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  revalidator: ReturnType<typeof useRevalidator>;
}) {
  const { widgetToken, conversationId, active, assistants, documents } = data;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chosenFile, setChosenFile] = useState<File | null>(null);

  // === Step 1: business ===
  const [companyName, setCompanyName] = useState(active.config.business.companyName);
  const [businessType, setBusinessType] = useState<AssistantConfig['business']['type']>(
    active.config.business.type,
  );
  const [productTypes, setProductTypes] = useState(
    active.config.business.ecommerceProductTypes,
  );
  const [businessDescription, setBusinessDescription] = useState(
    active.config.business.description,
  );
  const [locations, setLocations] = useState<AssistantConfig['business']['physicalLocations']>(
    active.config.business.physicalLocations,
  );
  const [purposes, setPurposes] = useState<AssistantConfig['business']['chatbotPurposes']>(
    active.config.business.chatbotPurposes,
  );

  // === Step 2: agent ===
  const [agentName, setAgentName] = useState(active.config.agent.name);
  const [agentTone, setAgentTone] = useState<AssistantConfig['agent']['tone']>(
    active.config.agent.tone,
  );
  const [agentGreeting, setAgentGreeting] = useState(active.config.agent.greeting);
  const [agentSignature, setAgentSignature] = useState(active.config.agent.signature);
  const [agentRules, setAgentRules] = useState(active.config.agent.customRules);
  const [examples, setExamples] = useState<FewShotExample[]>(active.config.agent.fewShotExamples);
  // Thinking verbs / error phrases as multi-line text (one per line) for easy editing.
  const [thinkingVerbsText, setThinkingVerbsText] = useState(
    active.config.agent.thinkingVerbs.join('\n'),
  );
  const [errorGeneric, setErrorGeneric] = useState(active.config.agent.errorPhrases.generic);
  const [errorNetwork, setErrorNetwork] = useState(active.config.agent.errorPhrases.network);
  const [errorRateLimit, setErrorRateLimit] = useState(active.config.agent.errorPhrases.rateLimit);
  const [errorTooLong, setErrorTooLong] = useState(active.config.agent.errorPhrases.tooLong);
  const [errorTooManyTurns, setErrorTooManyTurns] = useState(active.config.agent.errorPhrases.tooManyTurns);
  const [errorUnconfigured, setErrorUnconfigured] = useState(active.config.agent.errorPhrases.unconfigured);
  const [language, setLanguage] = useState(active.config.language);
  const [country, setCountry] = useState(active.config.country);

  // === Step 3: widget ===
  const [primaryColor, setPrimaryColor] = useState(active.config.widget.primaryColor);
  const [accentColor, setAccentColor] = useState(active.config.widget.accentColor);
  const [iconStyle, setIconStyle] = useState<AssistantConfig['widget']['iconStyle']>(
    active.config.widget.iconStyle,
  );
  const [widgetWidth, setWidgetWidth] = useState(active.config.widget.width);
  const [widgetHeight, setWidgetHeight] = useState(active.config.widget.height);

  // Assistant rename
  const [renameValue, setRenameValue] = useState(active.name);

  // Chat container portal
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setContainer(containerRef.current);
  }, []);

  // Restart-chat / navigate-to behavior after fetcher resolves
  const [restartAfterSave, setRestartAfterSave] = useState(false);
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.ok && restartAfterSave) {
      revalidator.revalidate();
      setRestartAfterSave(false);
    }
  }, [fetcher.state, fetcher.data, restartAfterSave, revalidator]);

  // Navigate to a new ?a= after create / delete.
  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data?.ok) return;
    if (fetcher.data.navigateTo) {
      const qp = new URLSearchParams(fetcher.data.navigateTo.replace(/^\?/, ''));
      setSearchParams(qp, { replace: false });
    } else if (
      fetcher.data.intent === 'upload-doc' ||
      fetcher.data.intent === 'delete-doc' ||
      fetcher.data.intent === 'rename-assistant' ||
      fetcher.data.intent === 'set-default-assistant'
    ) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, setSearchParams, revalidator]);

  function buildSettingsForm(): FormData {
    const form = new FormData();
    form.set('intent', 'save-settings');
    form.set('assistantId', active.id);
    // Business — Step 1
    form.set('business.companyName', companyName);
    form.set('business.type', businessType);
    form.set('business.ecommerceProductTypes', productTypes);
    form.set('business.description', businessDescription);
    form.set(
      'business.physicalLocations',
      JSON.stringify(locations.filter((l) => l.name.trim())),
    );
    form.set('business.chatbotPurposes', JSON.stringify(purposes));
    // Agent — Step 2
    form.set('agent.name', agentName);
    form.set('agent.tone', agentTone);
    form.set('agent.greeting', agentGreeting);
    form.set('agent.signature', agentSignature);
    form.set('agent.customRules', agentRules);
    form.set(
      'agent.thinkingVerbs',
      JSON.stringify(
        thinkingVerbsText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    form.set('agent.errorPhrases.generic', errorGeneric);
    form.set('agent.errorPhrases.network', errorNetwork);
    form.set('agent.errorPhrases.rateLimit', errorRateLimit);
    form.set('agent.errorPhrases.tooLong', errorTooLong);
    form.set('agent.errorPhrases.tooManyTurns', errorTooManyTurns);
    form.set('agent.errorPhrases.unconfigured', errorUnconfigured);
    form.set(
      'agent.fewShotExamples',
      JSON.stringify(examples.filter((e) => e.user.trim() && e.assistant.trim())),
    );
    form.set('language', language);
    form.set('country', country);
    // Widget — Step 3
    form.set('widget.primaryColor', primaryColor);
    form.set('widget.accentColor', accentColor);
    form.set('widget.iconStyle', iconStyle);
    form.set('widget.width', String(widgetWidth));
    form.set('widget.height', String(widgetHeight));
    return form;
  }

  const save = () => {
    setRestartAfterSave(false);
    fetcher.submit(buildSettingsForm(), { method: 'POST' });
  };
  const saveAndRestart = () => {
    setRestartAfterSave(true);
    fetcher.submit(buildSettingsForm(), { method: 'POST' });
  };

  const switchTo = (id: string) => {
    setSearchParams(new URLSearchParams({ a: id }), { replace: false });
  };

  const createNew = () => {
    const name = window.prompt('Name for the new assistant', 'New assistant');
    if (!name) return;
    const fd = new FormData();
    fd.set('intent', 'create-assistant');
    fd.set('name', name);
    fetcher.submit(fd, { method: 'POST' });
  };

  const renameSubmit = () => {
    if (!renameValue.trim() || renameValue === active.name) return;
    const fd = new FormData();
    fd.set('intent', 'rename-assistant');
    fd.set('id', active.id);
    fd.set('name', renameValue);
    fetcher.submit(fd, { method: 'POST' });
  };

  const deleteActive = () => {
    if (!window.confirm(`Delete "${active.name}"? Conversations stay; the config is removed.`)) return;
    const fd = new FormData();
    fd.set('intent', 'delete-assistant');
    fd.set('id', active.id);
    fetcher.submit(fd, { method: 'POST' });
  };

  const setDefault = () => {
    const fd = new FormData();
    fd.set('intent', 'set-default-assistant');
    fd.set('id', active.id);
    fetcher.submit(fd, { method: 'POST' });
  };

  const [uploadScope, setUploadScope] = useState<'assistant' | 'shared'>('assistant');

  const uploadDoc = () => {
    if (!chosenFile) return;
    const fd = new FormData();
    fd.set('intent', 'upload-doc');
    fd.set('file', chosenFile);
    fd.set('scope', uploadScope);
    if (uploadScope === 'assistant') fd.set('scopeAssistantId', active.id);
    fetcher.submit(fd, { method: 'POST', encType: 'multipart/form-data' });
    setChosenFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeDoc = (id: string) => {
    const fd = new FormData();
    fd.set('intent', 'delete-doc');
    fd.set('id', id);
    fetcher.submit(fd, { method: 'POST' });
  };

  const isBusy = fetcher.state !== 'idle';
  const submittingIntent =
    typeof fetcher.formData?.get('intent') === 'string'
      ? (fetcher.formData!.get('intent') as string)
      : null;
  const isSaving = isBusy && submittingIntent === 'save-settings';
  const isUploading = isBusy && submittingIntent === 'upload-doc';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f3f4f6',
        padding: 24,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 460px) 1fr',
          gap: 24,
          maxWidth: 1280,
          margin: '0 auto',
          alignItems: 'start',
        }}
      >
        {/* === LEFT: settings panel === */}
        <div
          style={{
            background: 'white',
            borderRadius: 12,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            maxHeight: 'calc(100vh - 48px)',
            overflowY: 'auto',
          }}
        >
          {/* Assistant selector — matches the rest of the panel's light theme. */}
          <h2 style={{ ...sectionH2, marginTop: 0 }}>Active assistant</h2>

          <Field label="Switch assistant">
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={active.id}
                onChange={(e) => switchTo(e.target.value)}
                style={{ ...inputStyle, flex: 1 }}
              >
                {assistants.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
              <button type="button" onClick={createNew} style={primaryButtonStyle}>
                + New
              </button>
            </div>
          </Field>

          <Field label="Name">
            <input
              type="text"
              value={renameValue}
              maxLength={80}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={renameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              style={inputStyle}
            />
          </Field>

          <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            {!active.isDefault && (
              <button type="button" onClick={setDefault} style={secondaryButtonStyle}>
                Set as default
              </button>
            )}
            <button
              type="button"
              onClick={deleteActive}
              style={{ ...secondaryButtonStyle, color: '#dc2626' }}
            >
              Delete
            </button>
          </div>

          {/* ===== Step 1: Företagsinformation ===== */}
          <h2 style={sectionH2}>1. Företagsinformation</h2>

          <Field label="Företagets namn">
            <input
              type="text"
              value={companyName}
              maxLength={80}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Nordkust Knit Co."
              style={inputStyle}
            />
          </Field>

          <Field label="Företagstyp">
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value as AssistantConfig['business']['type'])}
              style={inputStyle}
            >
              <option value="ecommerce">E-handel</option>
              <option value="service">Tjänsteföretag</option>
              <option value="restaurant">Restaurang / café</option>
              <option value="physical_retail">Fysisk butik</option>
              <option value="other">Annat</option>
            </select>
          </Field>

          {businessType === 'ecommerce' && (
            <Field label="Vilka produkter säljer ni?">
              <input
                type="text"
                value={productTypes}
                maxLength={280}
                onChange={(e) => setProductTypes(e.target.value)}
                placeholder="merinotröjor, accessoarer, presentkort"
                style={inputStyle}
              />
            </Field>
          )}

          <Field label="Företagsbeskrivning">
            <textarea
              value={businessDescription}
              maxLength={1500}
              rows={5}
              onChange={(e) => setBusinessDescription(e.target.value)}
              placeholder="Grundläggande info om verksamheten: historik, värderingar, vad ni är kända för. Agenten använder detta för att svara naturligt om företaget."
              style={{ ...inputStyle, fontFamily: 'inherit' }}
            />
          </Field>

          <Field label={`Fysiska butiker / mottagningar (${locations.length})`}>
            <div>
              {locations.map((loc, i) => (
                <div
                  key={i}
                  style={{
                    background: '#f9fafb',
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="text"
                    value={loc.name}
                    maxLength={80}
                    placeholder="Stockholm flagship"
                    onChange={(e) =>
                      setLocations((arr) =>
                        arr.map((l, j) => (j === i ? { ...l, name: e.target.value } : l)),
                      )
                    }
                    style={{ ...inputStyle, marginBottom: 6 }}
                  />
                  <input
                    type="text"
                    value={loc.address}
                    maxLength={280}
                    placeholder="Kungsgatan 12, Stockholm"
                    onChange={(e) =>
                      setLocations((arr) =>
                        arr.map((l, j) =>
                          j === i ? { ...l, address: e.target.value } : l,
                        ),
                      )
                    }
                    style={{ ...inputStyle, marginBottom: 6 }}
                  />
                  <input
                    type="text"
                    value={loc.hours}
                    maxLength={280}
                    placeholder="Mån–fre 10–18, lör 11–16"
                    onChange={(e) =>
                      setLocations((arr) =>
                        arr.map((l, j) =>
                          j === i ? { ...l, hours: e.target.value } : l,
                        ),
                      )
                    }
                    style={{ ...inputStyle, marginBottom: 6 }}
                  />
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: '#374151',
                      marginBottom: 6,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={loc.bookingRequired}
                      onChange={(e) =>
                        setLocations((arr) =>
                          arr.map((l, j) =>
                            j === i ? { ...l, bookingRequired: e.target.checked } : l,
                          ),
                        )
                      }
                    />
                    Bokning krävs
                  </label>
                  <input
                    type="text"
                    value={loc.notes}
                    maxLength={280}
                    placeholder="Övriga noteringar (parkering, tillgänglighet, …)"
                    onChange={(e) =>
                      setLocations((arr) =>
                        arr.map((l, j) =>
                          j === i ? { ...l, notes: e.target.value } : l,
                        ),
                      )
                    }
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => setLocations((arr) => arr.filter((_, j) => j !== i))}
                    style={ghostButtonStyle}
                  >
                    Ta bort
                  </button>
                </div>
              ))}
              {locations.length < 10 && (
                <button
                  type="button"
                  onClick={() =>
                    setLocations((arr) => [
                      ...arr,
                      { name: '', address: '', hours: '', bookingRequired: false, notes: '' },
                    ])
                  }
                  style={ghostButtonStyle}
                >
                  + Lägg till plats
                </button>
              )}
            </div>
          </Field>

          <Field label="Chattbotens ändamål">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(
                [
                  ['business_questions', 'Svara på frågor om verksamheten'],
                  ['general_support', 'Allmän kundservice'],
                  ['order_status', 'Orderstatus / paketspårning'],
                  ['returns', 'Returer & byten'],
                  ['shipping', 'Frakt & leverans'],
                  ['product_info', 'Produktinfo, storlek, tillgänglighet'],
                  ['bookings', 'Bokningar'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: '#374151',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={purposes.includes(value)}
                    onChange={(e) =>
                      setPurposes((arr) =>
                        e.target.checked
                          ? [...arr, value]
                          : arr.filter((p) => p !== value),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </Field>

          {/* ===== Step 2: Skräddarsy agent ===== */}
          <h2 style={sectionH2}>2. Skräddarsy agent</h2>

          <Field label="Namn">
            <input
              type="text"
              value={agentName}
              maxLength={40}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="Astrid"
              style={inputStyle}
            />
          </Field>

          <Field label="Språk (gäller nya konversationer)">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as AssistantConfig['language'])}
              style={inputStyle}
            >
              <option value="sv">Svenska</option>
              <option value="en">English</option>
              <option value="no">Norsk</option>
              <option value="da">Dansk</option>
              <option value="fi">Suomi</option>
            </select>
          </Field>

          <Field label="Land">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value as AssistantConfig['country'])}
              style={inputStyle}
            >
              <option value="SE">Sverige</option>
              <option value="NO">Norge</option>
              <option value="DK">Danmark</option>
              <option value="FI">Finland</option>
            </select>
          </Field>

          <Field label="Tone">
            <select
              value={agentTone}
              onChange={(e) => setAgentTone(e.target.value as AssistantConfig['agent']['tone'])}
              style={inputStyle}
            >
              <option value="friendly">Vänlig (standard)</option>
              <option value="professional">Professionell</option>
              <option value="casual">Avslappnad</option>
            </select>
          </Field>

          <Field label="Hälsningsfras">
            <input
              type="text"
              value={agentGreeting}
              maxLength={280}
              onChange={(e) => setAgentGreeting(e.target.value)}
              placeholder="Hej! Hur kan jag hjälpa dig?"
              style={inputStyle}
            />
          </Field>

          <Field label="Signatur">
            <input
              type="text"
              value={agentSignature}
              maxLength={120}
              onChange={(e) => setAgentSignature(e.target.value)}
              placeholder="— Astrid, Nordkust Support"
              style={inputStyle}
            />
          </Field>

          <Field label="Särskilda regler">
            <textarea
              value={agentRules}
              maxLength={2000}
              rows={4}
              onChange={(e) => setAgentRules(e.target.value)}
              placeholder="- Diskutera aldrig prissättning.&#10;- Erbjud DEMO10 till nya kunder som frågar om frakt."
              style={{ ...inputStyle, fontFamily: 'inherit' }}
            />
          </Field>

          <Field label="Tänkande-fraser (en per rad, roterar slumpvis)">
            <textarea
              value={thinkingVerbsText}
              rows={4}
              onChange={(e) => setThinkingVerbsText(e.target.value)}
              placeholder={'Funderar\nTänker\nSöker upp\nLetar upp dokument\nKnåpar'}
              style={{ ...inputStyle, fontFamily: 'inherit' }}
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              Visas medan agenten genererar svar. Tomma rader filtreras bort. Lämna helt
              tomt för att använda standard ({active.config.agent.thinkingVerbs.length}{' '}
              fraser).
            </div>
          </Field>

          <Field label="Felmeddelanden (tomt = använd standard på valt språk)">
            <div
              style={{
                background: '#f9fafb',
                borderRadius: 8,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <ErrorPhraseRow
                label="Allmänt fel"
                value={errorGeneric}
                onChange={setErrorGeneric}
                placeholder="Kunde inte skicka. Prova igen om en stund."
              />
              <ErrorPhraseRow
                label="Nätverk"
                value={errorNetwork}
                onChange={setErrorNetwork}
                placeholder="Nätverksfel. Kontrollera din anslutning."
              />
              <ErrorPhraseRow
                label="För många meddelanden"
                value={errorRateLimit}
                onChange={setErrorRateLimit}
                placeholder="För många meddelanden. Prova igen om {n} sekunder."
              />
              <ErrorPhraseRow
                label="För långt meddelande"
                value={errorTooLong}
                onChange={setErrorTooLong}
                placeholder="Ditt meddelande är för långt. Förkorta det och prova igen."
              />
              <ErrorPhraseRow
                label="Lång konversation"
                value={errorTooManyTurns}
                onChange={setErrorTooManyTurns}
                placeholder="Konversationen har blivit lång. Starta en ny för att fortsätta."
              />
              <ErrorPhraseRow
                label="Inte konfigurerad"
                value={errorUnconfigured}
                onChange={setErrorUnconfigured}
                placeholder="Chatten är inte konfigurerad. Kontakta butiken."
              />
            </div>
          </Field>

          <Field label={`Few-shot-exempel (${examples.length}/${MAX_FEW_SHOT})`}>
            <div>
              {examples.map((ex, i) => (
                <div
                  key={i}
                  style={{
                    background: '#f9fafb',
                    borderRadius: 8,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <input
                    type="text"
                    value={ex.user}
                    maxLength={500}
                    placeholder={`Kundens fråga (exempel ${i + 1})`}
                    onChange={(e) =>
                      setExamples((arr) =>
                        arr.map((x, j) => (j === i ? { ...x, user: e.target.value } : x)),
                      )
                    }
                    style={{ ...inputStyle, marginBottom: 6 }}
                  />
                  <textarea
                    value={ex.assistant}
                    maxLength={1000}
                    rows={2}
                    placeholder="Önskat svar"
                    onChange={(e) =>
                      setExamples((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, assistant: e.target.value } : x,
                        ),
                      )
                    }
                    style={{ ...inputStyle, fontFamily: 'inherit' }}
                  />
                  <button
                    type="button"
                    onClick={() => setExamples((arr) => arr.filter((_, j) => j !== i))}
                    style={ghostButtonStyle}
                  >
                    Ta bort
                  </button>
                </div>
              ))}
              {examples.length < MAX_FEW_SHOT && (
                <button
                  type="button"
                  onClick={() =>
                    setExamples((arr) => [...arr, { user: '', assistant: '' }])
                  }
                  style={ghostButtonStyle}
                >
                  + Lägg till exempel
                </button>
              )}
            </div>
          </Field>

          {/* ===== Step 3: Skräddarsy chattruta ===== */}
          <h2 style={sectionH2}>3. Skräddarsy chattruta</h2>

          <Field label="Primärfärg (header, bubbla, sänd-knapp) — live">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ ...inputStyle, width: 64, height: 36, padding: 2 }}
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ ...inputStyle, width: 120, marginLeft: 8 }}
              />
            </div>
          </Field>

          <Field label="Accentfärg (fokus-ramar)">
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                style={{ ...inputStyle, width: 64, height: 36, padding: 2 }}
              />
              <input
                type="text"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                style={{ ...inputStyle, width: 120, marginLeft: 8 }}
              />
            </div>
          </Field>

          <Field label="Ikon">
            <select
              value={iconStyle}
              onChange={(e) =>
                setIconStyle(e.target.value as AssistantConfig['widget']['iconStyle'])
              }
              style={inputStyle}
            >
              <option value="bot">Bot (standard)</option>
              <option value="chat_bubble">Chattbubbla</option>
              <option value="sparkle">Glitter</option>
              <option value="help">Frågetecken</option>
            </select>
          </Field>

          <Field label={`Bredd: ${widgetWidth} px`}>
            <input
              type="range"
              min={300}
              max={600}
              step={10}
              value={widgetWidth}
              onChange={(e) => setWidgetWidth(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </Field>

          <Field label={`Höjd: ${widgetHeight} px`}>
            <input
              type="range"
              min={400}
              max={800}
              step={10}
              value={widgetHeight}
              onChange={(e) => setWidgetHeight(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </Field>

          <h2 style={sectionH2}>Knowledge base ({documents.length})</h2>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 12px' }}>
            PDF / Markdown / TXT, max 5 MB. Choose whether the doc is scoped to{' '}
            <strong>{active.name}</strong> only or shared with every assistant in the shop.
          </p>

          <Field label="Scope for the next upload">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  color: '#374151',
                }}
              >
                <input
                  type="radio"
                  name="upload-scope"
                  checked={uploadScope === 'assistant'}
                  onChange={() => setUploadScope('assistant')}
                />
                Bara {active.name}
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  color: '#374151',
                }}
              >
                <input
                  type="radio"
                  name="upload-scope"
                  checked={uploadScope === 'shared'}
                  onChange={() => setUploadScope('shared')}
                />
                Delas med alla assistenter
              </label>
            </div>
          </Field>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
              flexWrap: 'wrap',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain"
              onChange={(e) => setChosenFile(e.target.files?.[0] ?? null)}
              disabled={isUploading}
              style={{ fontSize: 12, flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              onClick={uploadDoc}
              disabled={!chosenFile || isUploading}
              style={primaryButtonStyle}
            >
              {isUploading ? 'Indexing…' : 'Upload'}
            </button>
          </div>

          {fetcher.data?.intent === 'upload-doc' && fetcher.data.ok === false && (
            <p style={{ fontSize: 12, color: '#dc2626', margin: '0 0 12px' }}>
              {fetcher.data.error}
            </p>
          )}

          {documents.length === 0 && (
            <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>
              No documents yet.
            </p>
          )}

          {documents.map((d) => (
            <div
              key={d.id}
              style={{
                background: '#f9fafb',
                borderRadius: 8,
                padding: 10,
                marginBottom: 8,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#111827',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={d.filename}
                >
                  {d.filename}
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  {statusBadge(d.status)} · {d.chunkCount} chunks ·{' '}
                  {(d.sizeBytes / 1024).toFixed(1)} KB ·{' '}
                  {scopeLabel(d.assistantId, assistants, active.id)}
                </div>
                {d.error && (
                  <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>
                    {d.error}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => removeDoc(d.id)} style={ghostButtonStyle}>
                Delete
              </button>
            </div>
          ))}

          <div
            style={{
              marginTop: 16,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button type="button" onClick={save} disabled={isSaving} style={primaryButtonStyle}>
              {isSaving && !restartAfterSave ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={saveAndRestart}
              disabled={isSaving}
              style={secondaryButtonStyle}
            >
              {isSaving && restartAfterSave ? 'Saving…' : 'Save & restart chat'}
            </button>
            {fetcher.data?.intent === 'save-settings' && fetcher.data.ok && !isSaving && (
              <span style={{ fontSize: 12, color: '#10b981' }}>Saved.</span>
            )}
            {fetcher.data?.intent === 'save-settings' && fetcher.data.ok === false && (
              <span style={{ fontSize: 12, color: '#dc2626' }}>{fetcher.data.error}</span>
            )}
          </div>
        </div>

        {/* === RIGHT: live chat preview === */}
        <div>
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              fontSize: 13,
              color: '#6b7280',
            }}
          >
            <strong style={{ color: '#111827', fontSize: 14 }}>
              Chatting with: {active.name}
              {active.isDefault && ' (default)'}
            </strong>
            <div style={{ marginTop: 4 }}>
              Brand color updates instantly. Persona / tone / rules apply on the next
              message after Save. Language / greeting / country need "Save & restart chat".
              Switching assistants creates a fresh conversation.
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>
              session <code>{conversationId.slice(0, 8)}…</code> · assistant{' '}
              <code>{active.id.slice(0, 8)}…</code>
            </div>
          </div>

          <div
            ref={containerRef}
            style={
              {
                position: 'relative',
                // The container is sized to fit the configured widget — so
                // the merchant sees exactly the dimensions a customer would.
                width: widgetWidth + 40,
                height: widgetHeight + 100,
                minHeight: widgetHeight + 100,
                background: 'white',
                borderRadius: 12,
                overflow: 'hidden',
                contain: 'layout',
                border: '1px solid #e5e7eb',
                ['--primary' as string]: hexToHslComponents(primaryColor),
                ['--ring' as string]: hexToHslComponents(accentColor),
              } as React.CSSProperties
            }
          >
            {container && (
              <ChatRuntimeProvider
                apiUrl="/api/chat/stream"
                widgetToken={widgetToken}
                conversationId={conversationId}
                assistantId={active.id}
              >
                <AssistantModal
                  container={container}
                  defaultOpen
                  width={widgetWidth}
                  height={widgetHeight}
                  thinkingVerbs={thinkingVerbsText
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)}
                  greeting={agentGreeting}
                />
              </ChatRuntimeProvider>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorPhraseRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, color: '#374151', marginBottom: 2 }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        maxLength={200}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

function scopeLabel(
  assistantId: string | null,
  assistants: AssistantSummary[],
  activeId: string,
): string {
  if (!assistantId) return 'Delad';
  if (assistantId === activeId) return 'Endast denna';
  const owner = assistants.find((a) => a.id === assistantId);
  return owner ? `Annan: ${owner.name}` : 'Annan assistent';
}

function statusBadge(status: string): string {
  switch (status) {
    case 'indexed':
      return '✓ indexed';
    case 'ingesting':
      return '⋯ ingesting';
    case 'failed':
      return '✗ failed';
    default:
      return status;
  }
}

const sectionH2: React.CSSProperties = {
  margin: '20px 0 12px',
  fontSize: 14,
  fontWeight: 600,
  color: '#111827',
  paddingBottom: 6,
  borderBottom: '1px solid #e5e7eb',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  fontSize: 13,
  border: '1px solid #d1d5db',
  borderRadius: 6,
  outline: 'none',
  background: 'white',
  color: '#111827',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  background: '#1f2937',
  color: 'white',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  background: 'white',
  color: '#1f2937',
  border: '1px solid #d1d5db',
};

const ghostButtonStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  background: 'transparent',
  color: '#6b7280',
  border: 'none',
  cursor: 'pointer',
  textDecoration: 'underline',
};

function hexToHslComponents(hex: string): string {
  const fallback = '222 47% 11%';
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return fallback;
  const r = parseInt(m[1]!.slice(0, 2), 16) / 255;
  const g = parseInt(m[1]!.slice(2, 4), 16) / 255;
  const b = parseInt(m[1]!.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
