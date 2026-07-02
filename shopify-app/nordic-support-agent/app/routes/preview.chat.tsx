import { useEffect, useRef, useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { useFetcher, useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import { createConversation } from '../lib/conversations.ts';
import {
  bumpTokenEpoch,
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
import { requireWorkspace } from '../lib/workspace-auth.ts';
import { AssistantModal } from '../components/assistant-ui/assistant-modal';
import { ChatRuntimeProvider } from '../components/assistant-ui/chat-runtime';

/**
 * Unified test surface. Multiple assistants per workspace, each with
 * its own config + chat. The active assistant is tracked in the URL
 * (?a=<id>) so the form remounts with the right config on switch.
 *
 * Workspace resolution: the session cookie identifies an authenticated
 * user; requireWorkspace resolves their active workspace, whose id
 * becomes the "shop" value used by every shop-scoped query. No session
 * means a redirect to /signin — in every environment.
 */
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
  sourceUrl: string | null;
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
  /** This server's public origin — used to build the install snippet. */
  origin: string;
  active: {
    id: string;
    name: string;
    isDefault: boolean;
    published: boolean;
    tokenEpoch: number;
    config: AssistantConfig;
  };
  assistants: AssistantSummary[];
  documents: DocumentRow[];
}

function buildOrigin(request: Request, url: URL): string {
  const fwdProto = request.headers.get('X-Forwarded-Proto');
  const fwdHost = request.headers.get('X-Forwarded-Host') ?? request.headers.get('Host');
  if (fwdProto && fwdHost) return `${fwdProto}://${fwdHost}`;
  return url.origin;
}

async function pickActive(
  shop: string,
  requestedId: string | null,
): Promise<AssistantRecord> {
  if (requestedId) {
    const found = await getAssistant(requestedId);
    if (found && found.shop === shop) return found;
  }
  return loadOrCreateDefaultAssistant(shop);
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const url = new URL(request.url);
  const { workspace } = await requireWorkspace(request);
  const shop = workspace.id;
  const active = await pickActive(shop, url.searchParams.get('a'));
  const all = await listAssistants(shop);
  const convo = await createConversation(shop, {
    language: active.config.language,
    country: active.config.country,
    verifiedEmail: null,
  });
  // Scope the doc list to what this assistant can actually see at retrieval
  // time: its own docs + shared (assistantId === null). Other assistants'
  // private docs would only confuse the merchant.
  const docs = (await listDocuments(shop)).filter(
    (d) => d.assistantId === null || d.assistantId === active.id,
  );
  return {
    widgetToken: signWidgetToken(shop, {
      assistantId: active.id,
      epoch: active.tokenEpoch,
    }),
    conversationId: convo.id,
    // Honor proxy headers — tunnels and Vercel terminate TLS upstream so
    // url.origin would otherwise be http:// in dev, producing a broken
    // install snippet.
    origin: buildOrigin(request, url),
    active: {
      id: active.id,
      name: active.name,
      isDefault: active.isDefault,
      published: active.published,
      tokenEpoch: active.tokenEpoch,
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
      sourceUrl: d.sourceUrl,
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
  const { workspace } = await requireWorkspace(request);
  const shop = workspace.id;

  // --- assistant lifecycle ---
  if (intent === 'create-assistant') {
    const name = String(formData.get('name') ?? '').trim() || 'Untitled assistant';
    try {
      const created = await createAssistant({ shop, name });
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

  // --- security: publish toggle + token revocation ---
  if (intent === 'toggle-published') {
    const id = String(formData.get('id') ?? '');
    const published = String(formData.get('published') ?? '') === 'true';
    if (!id) return { ok: false, intent: 'toggle-published', error: 'missing id' };
    try {
      await updateAssistant(id, { published });
      return { ok: true, intent: 'toggle-published' };
    } catch (err) {
      return { ok: false, intent: 'toggle-published', error: (err as Error).message };
    }
  }
  if (intent === 'revoke-tokens') {
    const id = String(formData.get('id') ?? '');
    if (!id) return { ok: false, intent: 'revoke-tokens', error: 'missing id' };
    try {
      await bumpTokenEpoch(id);
      return { ok: true, intent: 'revoke-tokens', message: 'Tokens revoked.' };
    } catch (err) {
      return { ok: false, intent: 'revoke-tokens', error: (err as Error).message };
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
        shop,
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
    await deleteDocument(shop, id);
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
      sitemapUrl: formData.get('business.sitemapUrl') ?? '',
      sitemapExcludeGlobs: formData.get('business.sitemapExcludeGlobs') ?? undefined,
    },
    agent: {
      name: formData.get('agent.name') ?? undefined,
      tone: formData.get('agent.tone') ?? undefined,
      greeting: formData.get('agent.greeting') ?? '',
      signature: formData.get('agent.signature') ?? '',
      customRules: formData.get('agent.customRules') ?? '',
      errorPhrases: {
        generic: formData.get('agent.errorPhrases.generic') ?? '',
        network: formData.get('agent.errorPhrases.network') ?? '',
        rateLimit: formData.get('agent.errorPhrases.rateLimit') ?? '',
        tooLong: formData.get('agent.errorPhrases.tooLong') ?? '',
        tooManyTurns: formData.get('agent.errorPhrases.tooManyTurns') ?? '',
        unconfigured: formData.get('agent.errorPhrases.unconfigured') ?? '',
      },
      handoffEmail: formData.get('agent.handoffEmail') ?? '',
      handoffSubjectTemplate: formData.get('agent.handoffSubjectTemplate') ?? undefined,
      handoffBodyTemplate: formData.get('agent.handoffBodyTemplate') ?? undefined,
      fewShotExamples,
    },
    widget: {
      primaryColor: formData.get('widget.primaryColor') ?? undefined,
      accentColor: formData.get('widget.accentColor') ?? undefined,
      iconStyle: formData.get('widget.iconStyle') ?? undefined,
      launcherShape: formData.get('widget.launcherShape') ?? undefined,
      launcherIconColor: formData.get('widget.launcherIconColor') ?? undefined,
      sendIcon: formData.get('widget.sendIcon') ?? undefined,
      sendShape: formData.get('widget.sendShape') ?? undefined,
      sendFill: formData.get('widget.sendFill') ?? undefined,
      sendIconColor: formData.get('widget.sendIconColor') ?? undefined,
      placeholder: formData.get('widget.placeholder') ?? undefined,
      width: Number(formData.get('widget.width') ?? 380),
      height: Number(formData.get('widget.height') ?? 600),
      launcherSize: Number(formData.get('widget.launcherSize') ?? 60),
      panelRadius: Number(formData.get('widget.panelRadius') ?? 20),
      bubbleRadius: Number(formData.get('widget.bubbleRadius') ?? 18),
      fontFamily:
        formData.get('widget.fontFamily') ??
        '"Geist", system-ui, -apple-system, sans-serif',
      fontSizeBase: Number(formData.get('widget.fontSizeBase') ?? 15),
      showAvatar: formData.get('widget.showAvatar') === 'true',
      showDot: formData.get('widget.showDot') === 'true',
      theme: formData.get('widget.theme') ?? undefined,
      shadow: formData.get('widget.shadow') ?? undefined,
      subtitle: formData.get('widget.subtitle') ?? '',
      surfaces: {
        bg: formData.get('widget.surfaces.bg') ?? '',
        ink: formData.get('widget.surfaces.ink') ?? '',
        bubbleInBg: formData.get('widget.surfaces.bubbleInBg') ?? '',
        bubbleInInk: formData.get('widget.surfaces.bubbleInInk') ?? '',
        inputBg: formData.get('widget.surfaces.inputBg') ?? '',
      },
      // Newline-separated in the textarea; trim + drop empties before
      // handing to Zod (which expects string[]).
      allowedOrigins: String(formData.get('widget.allowedOrigins') ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    language: formData.get('language') ?? undefined,
    country: formData.get('country') ?? undefined,
    verificationTier: Number(formData.get('verificationTier') ?? 1),
  };
  try {
    await updateAssistant(id, { config: candidate });
    return { ok: true, intent: 'save-settings' };
  } catch (err) {
    // Format Zod issues as a short, human-readable list instead of raw
    // JSON so the dashboard's error toast is intelligible.
    const issues =
      err && typeof err === 'object' && 'issues' in err
        ? ((err as { issues: Array<{ path: Array<string | number>; message: string }> }).issues)
        : null;
    const detail = issues
      ? issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')
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
  const { widgetToken, conversationId, origin, active, assistants, documents } = data;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chosenFile, setChosenFile] = useState<File | null>(null);

  // Accordion — one section open at a time. Default: business (Step 1).
  type SectionKey = 'active' | 'business' | 'agent' | 'widget' | 'kb' | 'install';
  const [openSection, setOpenSection] = useState<SectionKey>('business');
  const toggle = (k: SectionKey) =>
    setOpenSection((cur) => (cur === k ? ('' as SectionKey) : k));

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
  const [sitemapUrl, setSitemapUrl] = useState(active.config.business.sitemapUrl);
  const [sitemapExcludeGlobs, setSitemapExcludeGlobs] = useState(
    active.config.business.sitemapExcludeGlobs,
  );
  const [crawling, setCrawling] = useState(false);
  const [crawlReport, setCrawlReport] = useState<null | {
    ok: boolean;
    error?: string;
    report?: {
      fetchedSitemapUrls: number;
      candidatePages: number;
      skippedByGlob: number;
      skippedUnchanged: number;
      ingested: number;
      failed: number;
      removedNowExcluded: number;
      errors: Array<{ url: string; error: string }>;
    };
  }>(null);

  // === Step 2: agent ===
  const [agentName, setAgentName] = useState(active.config.agent.name);
  const [agentTone, setAgentTone] = useState<AssistantConfig['agent']['tone']>(
    active.config.agent.tone,
  );
  const [agentGreeting, setAgentGreeting] = useState(active.config.agent.greeting);
  const [agentSignature, setAgentSignature] = useState(active.config.agent.signature);
  const [agentRules, setAgentRules] = useState(active.config.agent.customRules);
  const [examples, setExamples] = useState<FewShotExample[]>(active.config.agent.fewShotExamples);
  // Error phrases as multi-line text (one per line) for easy editing.
  const [errorGeneric, setErrorGeneric] = useState(active.config.agent.errorPhrases.generic);
  const [errorNetwork, setErrorNetwork] = useState(active.config.agent.errorPhrases.network);
  const [errorRateLimit, setErrorRateLimit] = useState(active.config.agent.errorPhrases.rateLimit);
  const [errorTooLong, setErrorTooLong] = useState(active.config.agent.errorPhrases.tooLong);
  const [errorTooManyTurns, setErrorTooManyTurns] = useState(active.config.agent.errorPhrases.tooManyTurns);
  const [errorUnconfigured, setErrorUnconfigured] = useState(active.config.agent.errorPhrases.unconfigured);
  const [handoffEmail, setHandoffEmail] = useState(active.config.agent.handoffEmail);
  const [handoffSubjectTemplate, setHandoffSubjectTemplate] = useState(
    active.config.agent.handoffSubjectTemplate,
  );
  const [handoffBodyTemplate, setHandoffBodyTemplate] = useState(
    active.config.agent.handoffBodyTemplate,
  );
  const [language, setLanguage] = useState(active.config.language);
  const [country, setCountry] = useState(active.config.country);
  const [verificationTier, setVerificationTier] = useState<0 | 1 | 2>(
    active.config.verificationTier ?? 1,
  );

  // === Step 3: widget ===
  const [primaryColor, setPrimaryColor] = useState(active.config.widget.primaryColor);
  const [accentColor, setAccentColor] = useState(active.config.widget.accentColor);
  const [iconStyle, setIconStyle] = useState<AssistantConfig['widget']['iconStyle']>(
    active.config.widget.iconStyle,
  );
  const [launcherShape, setLauncherShape] = useState<AssistantConfig['widget']['launcherShape']>(
    active.config.widget.launcherShape,
  );
  const [launcherIconColor, setLauncherIconColor] = useState(
    active.config.widget.launcherIconColor,
  );
  const [sendIcon, setSendIcon] = useState<AssistantConfig['widget']['sendIcon']>(
    active.config.widget.sendIcon,
  );
  const [sendShape, setSendShape] = useState<AssistantConfig['widget']['sendShape']>(
    active.config.widget.sendShape,
  );
  const [sendFill, setSendFill] = useState<AssistantConfig['widget']['sendFill']>(
    active.config.widget.sendFill,
  );
  const [sendIconColor, setSendIconColor] = useState(active.config.widget.sendIconColor);
  const [placeholder, setPlaceholder] = useState(active.config.widget.placeholder);
  const [widgetWidth, setWidgetWidth] = useState(active.config.widget.width);
  const [widgetHeight, setWidgetHeight] = useState(active.config.widget.height);
  const [allowedOrigins, setAllowedOrigins] = useState(
    active.config.widget.allowedOrigins.join('\n'),
  );
  // Design's extra tokens
  const [launcherSize, setLauncherSize] = useState(active.config.widget.launcherSize);
  const [panelRadius, setPanelRadius] = useState(active.config.widget.panelRadius);
  const [bubbleRadius, setBubbleRadius] = useState(active.config.widget.bubbleRadius);
  const [fontFamily, setFontFamily] = useState(active.config.widget.fontFamily);
  const [fontSizeBase, setFontSizeBase] = useState(active.config.widget.fontSizeBase);
  const [showAvatar, setShowAvatar] = useState(active.config.widget.showAvatar);
  const [showDot, setShowDot] = useState(active.config.widget.showDot);
  const [theme, setTheme] = useState<AssistantConfig['widget']['theme']>(active.config.widget.theme);
  const [shadow, setShadow] = useState<AssistantConfig['widget']['shadow']>(active.config.widget.shadow);
  const [subtitle, setSubtitle] = useState(active.config.widget.subtitle);
  const [surfaceBg, setSurfaceBg] = useState(active.config.widget.surfaces.bg);
  const [surfaceInk, setSurfaceInk] = useState(active.config.widget.surfaces.ink);
  const [bubbleInBg, setBubbleInBg] = useState(active.config.widget.surfaces.bubbleInBg);
  const [bubbleInInk, setBubbleInInk] = useState(active.config.widget.surfaces.bubbleInInk);
  const [inputBg, setInputBg] = useState(active.config.widget.surfaces.inputBg);

  // Assistant rename
  const [renameValue, setRenameValue] = useState(active.name);

  // Chat container portal
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    setContainer(containerRef.current);
  }, []);

  // Bumped whenever a save-settings round-trip completes successfully, so
  // the widget preview iframe reloads and the new /api/widget-config
  // response (colors, shapes, tokens) gets picked up.
  const [previewVersion, setPreviewVersion] = useState(0);
  // Iframe ref — we postMessage token updates here on every state change
  // so the widget previews live without requiring a Save round-trip.
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  // Bumped when the iframe finishes loading, so the live-tokens effect
  // re-fires and pushes the current snapshot into a freshly mounted widget.
  const [iframeLoadTick, setIframeLoadTick] = useState(0);
  useEffect(() => {
    if (
      fetcher.state === 'idle' &&
      fetcher.data?.ok &&
      fetcher.data.intent === 'save-settings'
    ) {
      setPreviewVersion((v) => v + 1);
    }
  }, [fetcher.state, fetcher.data]);

  // Live token postMessage: whenever any widget-shaped state changes,
  // push the resolved tokens into the iframe so the preview reflects
  // edits instantly (no Save round-trip required).
  useEffect(() => {
    const win = previewIframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      {
        type: 'nordic-support:tokens',
        tokens: {
          primaryColor,
          accentColor,
          launcherIconColor,
          sendIconColor,
          theme,
          shadow,
          launcherShape,
          sendShape,
          sendFill,
          iconStyle,
          sendIcon,
          width: widgetWidth,
          height: widgetHeight,
          launcherSize,
          panelRadius,
          bubbleRadius,
          fontFamily,
          fontSizeBase,
          surfaceBg,
          surfaceInk,
          bubbleInBg,
          bubbleInInk,
          inputBg,
          agentName,
          subtitle,
          placeholder,
          showAvatar,
          showDot,
        },
      },
      '*',
    );
  }, [
    primaryColor, accentColor, launcherIconColor, sendIconColor,
    theme, shadow, launcherShape, sendShape, sendFill, iconStyle, sendIcon,
    widgetWidth, widgetHeight, launcherSize, panelRadius, bubbleRadius,
    fontFamily, fontSizeBase,
    surfaceBg, surfaceInk, bubbleInBg, bubbleInInk, inputBg,
    agentName, subtitle, placeholder, showAvatar, showDot,
    previewVersion, iframeLoadTick,
  ]);

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
    form.set('business.sitemapUrl', sitemapUrl);
    form.set('business.sitemapExcludeGlobs', sitemapExcludeGlobs);
    // Agent — Step 2
    // Agent name is required (min 1 char). Coerce an empty value to a
    // safe default so a half-edited title in the Widget customizer
    // doesn't fail validation and surface a Zod error toast.
    form.set('agent.name', agentName.trim() || 'Support');
    form.set('agent.tone', agentTone);
    form.set('agent.greeting', agentGreeting);
    form.set('agent.signature', agentSignature);
    form.set('agent.customRules', agentRules);
    form.set('agent.errorPhrases.generic', errorGeneric);
    form.set('agent.errorPhrases.network', errorNetwork);
    form.set('agent.errorPhrases.rateLimit', errorRateLimit);
    form.set('agent.errorPhrases.tooLong', errorTooLong);
    form.set('agent.errorPhrases.tooManyTurns', errorTooManyTurns);
    form.set('agent.errorPhrases.unconfigured', errorUnconfigured);
    form.set('agent.handoffEmail', handoffEmail);
    form.set('agent.handoffSubjectTemplate', handoffSubjectTemplate);
    form.set('agent.handoffBodyTemplate', handoffBodyTemplate);
    form.set(
      'agent.fewShotExamples',
      JSON.stringify(examples.filter((e) => e.user.trim() && e.assistant.trim())),
    );
    form.set('language', language);
    form.set('country', country);
    form.set('verificationTier', String(verificationTier));
    // Widget — Step 3
    form.set('widget.primaryColor', primaryColor);
    form.set('widget.accentColor', accentColor);
    form.set('widget.iconStyle', iconStyle);
    form.set('widget.launcherShape', launcherShape);
    form.set('widget.launcherIconColor', launcherIconColor);
    form.set('widget.sendIcon', sendIcon);
    form.set('widget.sendShape', sendShape);
    form.set('widget.sendFill', sendFill);
    form.set('widget.sendIconColor', sendIconColor);
    form.set('widget.placeholder', placeholder);
    form.set('widget.width', String(widgetWidth));
    form.set('widget.height', String(widgetHeight));
    form.set('widget.launcherSize', String(launcherSize));
    form.set('widget.panelRadius', String(panelRadius));
    form.set('widget.bubbleRadius', String(bubbleRadius));
    form.set('widget.fontFamily', fontFamily);
    form.set('widget.fontSizeBase', String(fontSizeBase));
    form.set('widget.showAvatar', String(showAvatar));
    form.set('widget.showDot', String(showDot));
    form.set('widget.theme', theme);
    form.set('widget.shadow', shadow);
    form.set('widget.subtitle', subtitle);
    form.set('widget.surfaces.bg', surfaceBg);
    form.set('widget.surfaces.ink', surfaceInk);
    form.set('widget.surfaces.bubbleInBg', bubbleInBg);
    form.set('widget.surfaces.bubbleInInk', bubbleInInk);
    form.set('widget.surfaces.inputBg', inputBg);
    form.set('widget.allowedOrigins', allowedOrigins);
    return form;
  }

  const save = () => {
    setRestartAfterSave(false);
    fetcher.submit(buildSettingsForm(), { method: 'POST' });
  };

  // Saves first (so any sitemap URL edits land), then POSTs the crawl
  // request and surfaces the resulting report inline.
  const crawlNow = async () => {
    if (!sitemapUrl.trim()) return;
    setCrawlReport(null);
    setCrawling(true);
    try {
      // Persist any pending edits to the assistant config first.
      const saveForm = buildSettingsForm();
      await fetch(window.location.pathname + window.location.search, {
        method: 'POST',
        body: saveForm,
      });
      const fd = new FormData();
      fd.set('assistantId', active.id);
      const res = await fetch('/api/crawl-sitemap', { method: 'POST', body: fd });
      const data = (await res.json()) as typeof crawlReport;
      setCrawlReport(data);
      // Refresh the doc list so newly ingested pages show up.
      revalidator.revalidate();
    } catch (err) {
      setCrawlReport({ ok: false, error: (err as Error).message });
    } finally {
      setCrawling(false);
    }
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
        className="resp-two-col"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 420px) 1fr',
          gap: 24,
          maxWidth: 1680,
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
          <SectionHeader
            label="Aktiv assistent"
            open={openSection === 'active'}
            onClick={() => toggle('active')}
            first
          />
          {openSection === 'active' && (
          <>
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

          </>
          )}

          {/* ===== Step 1: Företagsinformation ===== */}
          <SectionHeader
            label="1. Företagsinformation"
            open={openSection === 'business'}
            onClick={() => toggle('business')}
          />
          {openSection === 'business' && (
          <>
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
              <option value="beauty_clinic">Skönhetsklinik / spa</option>
              <option value="dental">Tandvård</option>
              <option value="healthcare">Vårdgivare (fysio, kiro, optik, …)</option>
              <option value="real_estate">Fastighetsbolag / hyresvärd</option>
              <option value="consulting">Konsultverksamhet</option>
              <option value="education">Utbildning / kurser</option>
              <option value="restaurant">Restaurang / café</option>
              <option value="physical_retail">Fysisk butik</option>
              <option value="service">Övrig tjänst</option>
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

          </>
          )}

          {/* ===== Step 2: Skräddarsy agent ===== */}
          <SectionHeader
            label="2. Skräddarsy agent"
            open={openSection === 'agent'}
            onClick={() => toggle('agent')}
          />
          {openSection === 'agent' && (
          <>
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

          <Field label="Identitetsverifiering för orderdata">
            <select
              value={verificationTier}
              onChange={(e) =>
                setVerificationTier(Number(e.target.value) as 0 | 1 | 2)
              }
              style={inputStyle}
            >
              <option value={0}>Ingen — endast kunskapsbas och eskalering</option>
              <option value={1}>Lätt — ordernummer + e-post måste matcha (endast status)</option>
              <option value={2}>Stark — engångskod via e-post krävs (full PII)</option>
            </select>
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              Lätt: agenten kan svara på ”var är min order” utan att läcka namn
              eller adress. Stark: krävs när agenten visar adress, betalning
              eller utför ändringar.
            </div>
          </Field>

          <Field label="Eskalerings-e-post (skickas hit när agenten lämnar över till människa)">
            <input
              type="email"
              value={handoffEmail}
              onChange={(e) => setHandoffEmail(e.target.value)}
              placeholder="support@example.com"
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              Tomt = ingen eskalering. Agenten kommer då hänvisa kunden till er
              vanliga kontaktadress istället för att skapa ett ärende.
            </div>
          </Field>

          <Field label="Ämnesrad för eskaleringsmejl">
            <input
              type="text"
              value={handoffSubjectTemplate}
              maxLength={200}
              onChange={(e) => setHandoffSubjectTemplate(e.target.value)}
              placeholder="[Support] {reason}: {summary_short}"
              style={inputStyle}
            />
          </Field>

          <Field label="Mejlmall (placeholders: {agentName}, {reason}, {summary}, {summary_short}, {conversationId}, {verifiedEmail})">
            <textarea
              value={handoffBodyTemplate}
              rows={8}
              onChange={(e) => setHandoffBodyTemplate(e.target.value)}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              Okända placeholders lämnas oförändrade (lätt att felsöka). Mejl skickas
              som ren text.
            </div>
          </Field>

          </>
          )}

          {/* ===== Step 3: Skräddarsy chattruta ===== */}
          <SectionHeader
            label="3. Skräddarsy chattruta"
            open={openSection === 'widget'}
            onClick={() => toggle('widget')}
          />
          {openSection === 'widget' && (
          <WidgetCustomizer
            primaryColor={primaryColor} setPrimaryColor={setPrimaryColor}
            accentColor={accentColor} setAccentColor={setAccentColor}
            launcherIconColor={launcherIconColor} setLauncherIconColor={setLauncherIconColor}
            sendIconColor={sendIconColor} setSendIconColor={setSendIconColor}
            iconStyle={iconStyle} setIconStyle={setIconStyle}
            launcherShape={launcherShape} setLauncherShape={setLauncherShape}
            sendIcon={sendIcon} setSendIcon={setSendIcon}
            sendShape={sendShape} setSendShape={setSendShape}
            sendFill={sendFill} setSendFill={setSendFill}
            placeholder={placeholder} setPlaceholder={setPlaceholder}
            widgetWidth={widgetWidth} setWidgetWidth={setWidgetWidth}
            widgetHeight={widgetHeight} setWidgetHeight={setWidgetHeight}
            launcherSize={launcherSize} setLauncherSize={setLauncherSize}
            panelRadius={panelRadius} setPanelRadius={setPanelRadius}
            bubbleRadius={bubbleRadius} setBubbleRadius={setBubbleRadius}
            fontFamily={fontFamily} setFontFamily={setFontFamily}
            fontSizeBase={fontSizeBase} setFontSizeBase={setFontSizeBase}
            showAvatar={showAvatar} setShowAvatar={setShowAvatar}
            showDot={showDot} setShowDot={setShowDot}
            theme={theme} setTheme={setTheme}
            shadow={shadow} setShadow={setShadow}
            subtitle={subtitle} setSubtitle={setSubtitle}
            agentName={agentName} setAgentName={setAgentName}
            surfaceBg={surfaceBg} setSurfaceBg={setSurfaceBg}
            surfaceInk={surfaceInk} setSurfaceInk={setSurfaceInk}
            bubbleInBg={bubbleInBg} setBubbleInBg={setBubbleInBg}
            bubbleInInk={bubbleInInk} setBubbleInInk={setBubbleInInk}
            inputBg={inputBg} setInputBg={setInputBg}
          />
          )}

          <SectionHeader
            label={`4. Kunskapskällor (${documents.length})`}
            open={openSection === 'kb'}
            onClick={() => toggle('kb')}
          />
          {openSection === 'kb' && (
          <>
          <h3 style={kbSubH}>Sitemap-indexering</h3>

          <Field label="Sitemap-URL (för att indexera webbsidor som källor)">
            <input
              type="url"
              value={sitemapUrl}
              maxLength={500}
              onChange={(e) => setSitemapUrl(e.target.value)}
              placeholder="https://hopestockholm.com/sitemap.xml"
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              Vi hämtar varje sida, plockar huvudinnehållet och lägger till det i
              kunskapsbasen — varje träff bär med sig sidans URL så agenten kan länka till källan.
            </div>
          </Field>

          <Field label="Uteslut sökvägar (en glob per rad)">
            <textarea
              value={sitemapExcludeGlobs}
              rows={4}
              onChange={(e) => setSitemapExcludeGlobs(e.target.value)}
              placeholder={'/cart\n/checkout\n/account/*\n/products/*'}
              style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12 }}
            />
            <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
              <code>*</code> = ett segment, <code>**</code> = vad som helst. Standard
              skippar varukorg, kassa, kontosidor och produktsidor.
            </div>
          </Field>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <button
              type="button"
              onClick={crawlNow}
              disabled={crawling || !sitemapUrl.trim()}
              style={primaryButtonStyle}
            >
              {crawling ? 'Hämtar…' : 'Hämta & indexera nu'}
            </button>
            {crawling && (
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                Kan ta en stund för större sajter.
              </span>
            )}
          </div>

          {crawlReport && crawlReport.ok && crawlReport.report && (
            <div
              style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                padding: 10,
                fontSize: 12,
                color: '#166534',
                marginBottom: 12,
              }}
            >
              Klar: <strong>{crawlReport.report.ingested}</strong> nya/uppdaterade,{' '}
              <strong>{crawlReport.report.skippedUnchanged}</strong> oförändrade,{' '}
              <strong>{crawlReport.report.skippedByGlob}</strong> uteslutna,{' '}
              <strong>{crawlReport.report.failed}</strong> misslyckades (av{' '}
              {crawlReport.report.fetchedSitemapUrls} URL:er i sitemap).
              {crawlReport.report.removedNowExcluded > 0 && (
                <> Tog bort <strong>{crawlReport.report.removedNowExcluded}</strong> tidigare indexerade sidor som nu uteslöts.</>
              )}
              {crawlReport.report.errors.length > 0 && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer' }}>
                    {crawlReport.report.errors.length} fel
                  </summary>
                  <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
                    {crawlReport.report.errors.slice(0, 10).map((e, i) => (
                      <li key={i} style={{ color: '#991b1b' }}>
                        <code>{e.url}</code>: {e.error}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {crawlReport && !crawlReport.ok && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: 10,
                fontSize: 12,
                color: '#991b1b',
                marginBottom: 12,
              }}
            >
              Kunde inte indexera: {crawlReport.error}
            </div>
          )}

          <h3 style={kbSubH}>Ladda upp dokument</h3>
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
                  {d.sourceUrl && ' · sitemap'}
                </div>
                {d.sourceUrl && (
                  <div
                    style={{
                      fontSize: 11,
                      color: '#2563eb',
                      marginTop: 2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={d.sourceUrl}
                  >
                    <a href={d.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>
                      {d.sourceUrl}
                    </a>
                  </div>
                )}
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
          </>
          )}

          <SectionHeader
            label="5. Installation & säkerhet"
            open={openSection === 'install'}
            onClick={() => toggle('install')}
          />
          {openSection === 'install' && (
            <>
              <InstallSnippet origin={origin} assistantId={active.id} />
              <InstallSecurity
                assistantId={active.id}
                published={active.published}
                allowedOrigins={allowedOrigins}
                onAllowedOriginsChange={setAllowedOrigins}
                tokenEpoch={active.tokenEpoch}
              />
            </>
          )}

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
            ref={containerRef}
            style={
              {
                position: 'relative',
                // Fixed-size "viewport" — simulates a storefront page corner.
                // The launcher pins to bottom-right; the modal sizes itself
                // independently from the configured widget width/height.
                width: '100%',
                height: 'calc(100vh - 80px)',
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
            {/* Render the production widget.js inside an iframe so what
             * appears here is byte-identical to what merchants embed on
             * their site. The iframe sandboxes the widget's fixed-position
             * launcher / panel to the right pane, and reloads on every
             * settings save so colour/shape/copy edits show immediately. */}
            <iframe
              ref={previewIframeRef}
              key={previewVersion}
              src={`/widget-test.html?token=${encodeURIComponent(widgetToken)}&open=1`}
              title="Widget preview"
              onLoad={() => {
                // Push the current token snapshot once the widget has
                // actually mounted — initial mount messaging would race
                // the iframe load otherwise.
                setIframeLoadTick((n) => n + 1);
              }}
              style={{
                width: '100%',
                height: '100%',
                border: 0,
                background: 'transparent',
              }}
            />
            {container ? null : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function InstallSnippet({ origin, assistantId }: { origin: string; assistantId: string }) {
  const snippet = `<script src="${origin}/widget.js" data-assistant="${assistantId}" async defer></script>`;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(snippet).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div style={{ marginTop: 4, marginBottom: 12 }}>
      <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0', lineHeight: 1.45 }}>
        Klistra in den här raden i sajtens <code style={{ fontSize: 11 }}>{'<head>'}</code> eller
        precis innan <code style={{ fontSize: 11 }}>{'</body>'}</code>. Widgeten hämtar
        en kortlivad publik token och konfigurationen automatiskt.
      </p>
      <pre
        style={{
          background: '#0f172a',
          color: '#e2e8f0',
          padding: 12,
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.5,
          overflowX: 'auto',
          whiteSpace: 'pre',
          margin: 0,
        }}
      >
        <code>{snippet}</code>
      </pre>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button type="button" onClick={copy} style={secondaryButtonStyle}>
          {copied ? 'Kopierat' : 'Kopiera'}
        </button>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>
          Token-livslängd 24 h — widgeten förnyar automatiskt vid varje besök.
        </span>
      </div>
    </div>
  );
}

function InstallSecurity({
  assistantId,
  published,
  allowedOrigins,
  onAllowedOriginsChange,
  tokenEpoch,
}: {
  assistantId: string;
  published: boolean;
  allowedOrigins: string;
  onAllowedOriginsChange: (next: string) => void;
  tokenEpoch: number;
}) {
  const fetcher = useFetcher<ActionResponse>();
  const inFlight = fetcher.state !== 'idle';

  const togglePublished = () => {
    const fd = new FormData();
    fd.set('intent', 'toggle-published');
    fd.set('id', assistantId);
    fd.set('published', String(!published));
    fetcher.submit(fd, { method: 'post' });
  };

  const revoke = () => {
    if (!confirm('Återkalla alla widget-tokens för denna assistent? Befintliga installationer hämtar nya automatiskt vid nästa sidladdning.')) {
      return;
    }
    const fd = new FormData();
    fd.set('intent', 'revoke-tokens');
    fd.set('id', assistantId);
    fetcher.submit(fd, { method: 'post' });
  };

  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: '#374151' };
  const helpStyle: React.CSSProperties = { fontSize: 11, color: '#6b7280', margin: '4px 0 8px 0' };

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={published} onChange={togglePublished} disabled={inFlight} />
          <span style={labelStyle}>Publicerad</span>
        </label>
        <p style={helpStyle}>
          Avpublicera för att tillfälligt blockera den publika tokenslutpunkten — befintliga
          tokens fortsätter fungera tills de förnyas eller återkallas.
        </p>
      </div>

      <div>
        <label htmlFor="allowedOrigins" style={labelStyle}>
          Tillåtna domäner
        </label>
        <p style={helpStyle}>
          En per rad. Tom = alla domäner (rekommenderas bara under utveckling).
          Exempel: <code style={{ fontSize: 11 }}>hope-sthlm.com</code>,{' '}
          <code style={{ fontSize: 11 }}>*.hope-sthlm.com</code>,{' '}
          <code style={{ fontSize: 11 }}>https://shop.example.com</code>.
        </p>
        <textarea
          id="allowedOrigins"
          value={allowedOrigins}
          onChange={(e) => onAllowedOriginsChange(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder="hope-sthlm.com&#10;*.hope-sthlm.com"
          style={{
            width: '100%',
            minHeight: 80,
            padding: 8,
            fontSize: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            resize: 'vertical',
          }}
        />
      </div>

      <div>
        <label style={labelStyle}>Återkalla widget-tokens</label>
        <p style={helpStyle}>
          Aktuell epok: <strong>{tokenEpoch}</strong>. Klicka för att invalidera alla
          tokens som minted innan nu. Tryggt vid läckage eller vid byte av domän.
        </p>
        <button type="button" onClick={revoke} disabled={inFlight} style={secondaryButtonStyle}>
          {inFlight && fetcher.formData?.get('intent') === 'revoke-tokens'
            ? 'Återkallar…'
            : 'Återkalla alla tokens'}
        </button>
        {fetcher.data?.intent === 'revoke-tokens' && fetcher.data.ok && (
          <span style={{ marginLeft: 8, fontSize: 12, color: '#10b981' }}>Återkallade.</span>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  open,
  onClick,
  first,
}: {
  label: string;
  open: boolean;
  onClick: () => void;
  first?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        margin: first ? '0 0 12px' : '12px 0',
        padding: '8px 0',
        fontSize: 14,
        fontWeight: 600,
        color: '#111827',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid #e5e7eb',
        cursor: 'pointer',
        textAlign: 'left',
      }}
      aria-expanded={open}
    >
      <span>{label}</span>
      <span style={{ fontSize: 12, color: '#6b7280', transition: 'transform 120ms', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
        ▶
      </span>
    </button>
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

const kbSubH: React.CSSProperties = {
  margin: '12px 0 8px',
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: 0.4,
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

// ============================================================
// Widget customizer — design-style left rail
// Quick presets, Theme & shadow, Colors, Surfaces, Shapes, Sizes,
// Typography, Header content. Mirrors the layout from the Claude
// Design source so anything live-tunable in the design is live-
// tunable here.
// ============================================================

type WidgetPreset = {
  name: string;
  brand: string;
  accent: string;
  licon: string;
  sicon: string;
  theme: 'light' | 'dark';
  font?: string;
  surfaces?: {
    bg?: string;
    ink?: string;
    bubbleInBg?: string;
    bubbleInInk?: string;
    inputBg?: string;
  };
};

const WIDGET_PRESETS: WidgetPreset[] = [
  { name: 'Cream',  brand: '#1a1a1a', accent: '#e85d4a', licon: '#ffffff', sicon: '#ffffff', theme: 'light' },
  { name: 'Tandem', brand: '#2c4a3e', accent: '#c8a87a', licon: '#f5f1ea', sicon: '#f5f1ea', theme: 'light',
    font: '"Inter Tight", system-ui, sans-serif',
    surfaces: { bg: '#f7f4ee', ink: '#1f2823', bubbleInBg: '#ece6d8', bubbleInInk: '#1f2823', inputBg: '#f0ebde' } },
  { name: 'Cobalt', brand: '#1e40af', accent: '#fbbf24', licon: '#ffffff', sicon: '#ffffff', theme: 'light' },
  { name: 'Forest', brand: '#14532d', accent: '#84cc16', licon: '#ffffff', sicon: '#ffffff', theme: 'light' },
  { name: 'Ember',  brand: '#9a3412', accent: '#fde68a', licon: '#ffffff', sicon: '#ffffff', theme: 'light' },
  { name: 'Violet', brand: '#6d28d9', accent: '#22d3ee', licon: '#ffffff', sicon: '#ffffff', theme: 'light' },
  { name: 'Slate',  brand: '#0f172a', accent: '#38bdf8', licon: '#ffffff', sicon: '#ffffff', theme: 'dark'  },
  { name: 'Plum',   brand: '#3b0764', accent: '#f0abfc', licon: '#ffffff', sicon: '#ffffff', theme: 'dark'  },
  { name: 'Carbon', brand: '#0a0a0a', accent: '#22c55e', licon: '#22c55e', sicon: '#0a0a0a', theme: 'dark'  },
];

const FONT_CHOICES: Array<{ label: string; value: string }> = [
  { label: 'Geist (default)', value: '"Geist", system-ui, -apple-system, sans-serif' },
  { label: 'Inter Tight', value: '"Inter Tight", system-ui, sans-serif' },
  { label: 'IBM Plex Sans', value: '"IBM Plex Sans", system-ui, sans-serif' },
  { label: 'System UI', value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
];

interface WidgetCustomizerProps {
  primaryColor: string; setPrimaryColor: (v: string) => void;
  accentColor: string; setAccentColor: (v: string) => void;
  launcherIconColor: string; setLauncherIconColor: (v: string) => void;
  sendIconColor: string; setSendIconColor: (v: string) => void;
  iconStyle: AssistantConfig['widget']['iconStyle']; setIconStyle: (v: AssistantConfig['widget']['iconStyle']) => void;
  launcherShape: AssistantConfig['widget']['launcherShape']; setLauncherShape: (v: AssistantConfig['widget']['launcherShape']) => void;
  sendIcon: AssistantConfig['widget']['sendIcon']; setSendIcon: (v: AssistantConfig['widget']['sendIcon']) => void;
  sendShape: AssistantConfig['widget']['sendShape']; setSendShape: (v: AssistantConfig['widget']['sendShape']) => void;
  sendFill: AssistantConfig['widget']['sendFill']; setSendFill: (v: AssistantConfig['widget']['sendFill']) => void;
  placeholder: string; setPlaceholder: (v: string) => void;
  widgetWidth: number; setWidgetWidth: (v: number) => void;
  widgetHeight: number; setWidgetHeight: (v: number) => void;
  launcherSize: number; setLauncherSize: (v: number) => void;
  panelRadius: number; setPanelRadius: (v: number) => void;
  bubbleRadius: number; setBubbleRadius: (v: number) => void;
  fontFamily: string; setFontFamily: (v: string) => void;
  fontSizeBase: number; setFontSizeBase: (v: number) => void;
  showAvatar: boolean; setShowAvatar: (v: boolean) => void;
  showDot: boolean; setShowDot: (v: boolean) => void;
  theme: AssistantConfig['widget']['theme']; setTheme: (v: AssistantConfig['widget']['theme']) => void;
  shadow: AssistantConfig['widget']['shadow']; setShadow: (v: AssistantConfig['widget']['shadow']) => void;
  subtitle: string; setSubtitle: (v: string) => void;
  agentName: string; setAgentName: (v: string) => void;
  surfaceBg: string; setSurfaceBg: (v: string) => void;
  surfaceInk: string; setSurfaceInk: (v: string) => void;
  bubbleInBg: string; setBubbleInBg: (v: string) => void;
  bubbleInInk: string; setBubbleInInk: (v: string) => void;
  inputBg: string; setInputBg: (v: string) => void;
}

function WidgetCustomizer(p: WidgetCustomizerProps) {
  const applyPreset = (preset: WidgetPreset) => {
    p.setPrimaryColor(preset.brand);
    p.setAccentColor(preset.accent);
    p.setLauncherIconColor(preset.licon);
    p.setSendIconColor(preset.sicon);
    p.setTheme(preset.theme);
    if (preset.font) p.setFontFamily(preset.font);
    // Surface overrides: explicit values win; empty resets to theme defaults.
    p.setSurfaceBg(preset.surfaces?.bg ?? '');
    p.setSurfaceInk(preset.surfaces?.ink ?? '');
    p.setBubbleInBg(preset.surfaces?.bubbleInBg ?? '');
    p.setBubbleInInk(preset.surfaces?.bubbleInInk ?? '');
    p.setInputBg(preset.surfaces?.inputBg ?? '');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <CustomizerGroup title="Quick presets">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          {WIDGET_PRESETS.map((preset) => {
            const active = p.primaryColor.toLowerCase() === preset.brand.toLowerCase();
            return (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset)}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  gap: 6, padding: 8, border: active ? '1px solid #111827' : '1px solid #e5e7eb',
                  borderRadius: 10, background: '#fff', cursor: 'pointer', fontSize: 11,
                  color: '#374151', fontFamily: 'inherit',
                }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: preset.brand,
                  border: '1px solid ' + (preset.theme === 'dark' ? '#334155' : '#e5e7eb'),
                  position: 'relative', display: 'inline-block',
                }}>
                  <span style={{
                    position: 'absolute', right: -2, bottom: -2,
                    width: 12, height: 12, borderRadius: '50%',
                    background: preset.accent, border: '2px solid #fff',
                  }} />
                </span>
                {preset.name}
              </button>
            );
          })}
        </div>
      </CustomizerGroup>

      <CustomizerGroup title="Theme & shadow">
        <Row label="theme">
          <Segmented
            value={p.theme}
            options={[{ v: 'light', l: 'light' }, { v: 'dark', l: 'dark' }]}
            onChange={(v) => p.setTheme(v as AssistantConfig['widget']['theme'])}
          />
        </Row>
        <Row label="shadow">
          <Segmented
            value={p.shadow}
            options={[{ v: 'none', l: 'none' }, { v: 'subtle', l: 'subtle' }, { v: 'medium', l: 'medium' }, { v: 'strong', l: 'strong' }]}
            onChange={(v) => p.setShadow(v as AssistantConfig['widget']['shadow'])}
          />
        </Row>
      </CustomizerGroup>

      <CustomizerGroup title="Colors">
        <ColorRow label="brand"         value={p.primaryColor}      onChange={p.setPrimaryColor} />
        <ColorRow label="accent"        value={p.accentColor}       onChange={p.setAccentColor} />
        <ColorRow label="launcher icon" value={p.launcherIconColor} onChange={p.setLauncherIconColor} />
        <ColorRow label="send icon"     value={p.sendIconColor}     onChange={p.setSendIconColor} />
      </CustomizerGroup>

      <CustomizerGroup
        title="Surfaces"
        hint="Override theme defaults. Switching theme resets these."
      >
        <ColorRow label="panel bg"        value={p.surfaceBg}    onChange={p.setSurfaceBg}   placeholder="#ffffff" />
        <ColorRow label="panel text"      value={p.surfaceInk}   onChange={p.setSurfaceInk}  placeholder="#18140f" />
        <ColorRow label="AI bubble"       value={p.bubbleInBg}   onChange={p.setBubbleInBg}  placeholder="#f1ebde" />
        <ColorRow label="AI bubble text"  value={p.bubbleInInk}  onChange={p.setBubbleInInk} placeholder="#18140f" />
        <ColorRow label="input bg"        value={p.inputBg}      onChange={p.setInputBg}     placeholder="#faf6ee" />
      </CustomizerGroup>

      <CustomizerGroup title="Shapes">
        <Row label="launcher">
          <Segmented
            value={p.launcherShape}
            options={[{ v: 'circle', l: 'circle' }, { v: 'rounded', l: 'rounded' }, { v: 'square', l: 'square' }]}
            onChange={(v) => p.setLauncherShape(v as AssistantConfig['widget']['launcherShape'])}
          />
        </Row>
        <Row label="send">
          <Segmented
            value={p.sendShape}
            options={[{ v: 'circle', l: 'circle' }, { v: 'rounded', l: 'rounded' }, { v: 'square', l: 'square' }]}
            onChange={(v) => p.setSendShape(v as AssistantConfig['widget']['sendShape'])}
          />
        </Row>
        <Row label="send fill">
          <Segmented
            value={p.sendFill}
            options={[{ v: 'solid', l: 'solid' }, { v: 'outline', l: 'outline' }, { v: 'ghost', l: 'ghost' }]}
            onChange={(v) => p.setSendFill(v as AssistantConfig['widget']['sendFill'])}
          />
        </Row>
        <Row label="icon style">
          <Segmented
            value={p.iconStyle}
            options={[
              { v: 'bot', l: 'bot' },
              { v: 'chat_bubble', l: 'chat' },
              { v: 'sparkle', l: 'sparkle' },
              { v: 'help', l: 'help' },
            ]}
            onChange={(v) => p.setIconStyle(v as AssistantConfig['widget']['iconStyle'])}
          />
        </Row>
        <Row label="send icon">
          <Segmented
            value={p.sendIcon}
            options={[
              { v: 'arrow_up', l: 'arrow up' },
              { v: 'arrow_right', l: 'arrow →' },
              { v: 'send_plane', l: 'plane' },
            ]}
            onChange={(v) => p.setSendIcon(v as AssistantConfig['widget']['sendIcon'])}
          />
        </Row>
      </CustomizerGroup>

      <CustomizerGroup title="Sizes">
        <SliderRow label="panel width"    value={p.widgetWidth}  min={300} max={600} step={10} unit="px" onChange={p.setWidgetWidth} />
        <SliderRow label="panel height"   value={p.widgetHeight} min={400} max={800} step={10} unit="px" onChange={p.setWidgetHeight} />
        <SliderRow label="launcher size"  value={p.launcherSize} min={40}  max={96}  step={2}  unit="px" onChange={p.setLauncherSize} />
        <SliderRow label="panel radius"   value={p.panelRadius}  min={0}   max={36}  step={1}  unit="px" onChange={p.setPanelRadius} />
        <SliderRow label="bubble radius"  value={p.bubbleRadius} min={0}   max={28}  step={1}  unit="px" onChange={p.setBubbleRadius} />
      </CustomizerGroup>

      <CustomizerGroup title="Typography">
        <Row label="font family">
          <select
            value={p.fontFamily}
            onChange={(e) => p.setFontFamily(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          >
            {FONT_CHOICES.map((f) => (
              <option key={f.label} value={f.value}>{f.label}</option>
            ))}
          </select>
        </Row>
        <SliderRow label="base size" value={p.fontSizeBase} min={12} max={20} step={1} unit="px" onChange={p.setFontSizeBase} />
      </CustomizerGroup>

      <CustomizerGroup title="Header content">
        <Row label="title">
          <input
            type="text"
            value={p.agentName}
            onChange={(e) => p.setAgentName(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
            placeholder="Nimbus Support"
          />
        </Row>
        <Row label="subtitle">
          <input
            type="text"
            value={p.subtitle}
            onChange={(e) => p.setSubtitle(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
            placeholder="Usually replies in a few minutes"
          />
        </Row>
        <Row label="show avatar">
          <Segmented
            value={p.showAvatar ? 'on' : 'off'}
            options={[{ v: 'on', l: 'on' }, { v: 'off', l: 'off' }]}
            onChange={(v) => p.setShowAvatar(v === 'on')}
          />
        </Row>
        <Row label="online dot">
          <Segmented
            value={p.showDot ? 'on' : 'off'}
            options={[{ v: 'on', l: 'on' }, { v: 'off', l: 'off' }]}
            onChange={(v) => p.setShowDot(v === 'on')}
          />
        </Row>
        <Row label="placeholder">
          <input
            type="text"
            value={p.placeholder}
            onChange={(e) => p.setPlaceholder(e.target.value)}
            maxLength={80}
            style={{ ...inputStyle, width: '100%' }}
            placeholder="Type a message…"
          />
        </Row>
      </CustomizerGroup>
    </div>
  );
}

function CustomizerGroup({ title, hint, children }: {
  title: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ paddingBottom: 18, marginBottom: 18, borderBottom: '1px dashed #e5e7eb' }}>
      <h3 style={{
        fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em',
        color: '#6b6359', margin: '0 0 12px', fontWeight: 600,
      }}>{title}</h3>
      {hint && (
        <p style={{ margin: '-4px 0 12px', fontSize: 11.5, color: '#9ca3af', lineHeight: 1.4 }}>{hint}</p>
      )}
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '110px 1fr', gap: 12,
      alignItems: 'center', marginBottom: 10,
    }}>
      <label style={{ fontSize: 12.5, color: '#18140f' }}>{label}</label>
      <div>{children}</div>
    </div>
  );
}

function ColorRow({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  // Color input requires a valid 7-char hex; if the user-stored value is empty
  // (meaning "use theme default") we keep the picker pointed at a neutral
  // placeholder but stash empty in the actual state.
  const colorForPicker = /^#[0-9a-f]{6}$/i.test(value) ? value : (placeholder || '#000000');
  return (
    <Row label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={colorForPicker}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 36, height: 28, border: '1px solid #e5e7eb', borderRadius: 6, padding: 0, background: 'none', cursor: 'pointer' }}
        />
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, flex: 1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5 }}
        />
      </div>
    </Row>
  );
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: Array<{ v: T; l: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{
      display: 'inline-flex', border: '1px solid #e5e7eb', borderRadius: 8,
      background: '#fff', padding: 2, gap: 0,
    }}>
      {options.map((opt) => {
        const active = opt.v === value;
        return (
          <button
            key={opt.v}
            type="button"
            onClick={() => onChange(opt.v)}
            style={{
              padding: '5px 10px', border: 0, borderRadius: 6,
              background: active ? '#111827' : 'transparent',
              color: active ? '#fff' : '#374151',
              fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {opt.l}
          </button>
        );
      })}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <label style={{ fontSize: 12.5, color: '#18140f' }}>{label}</label>
        <span style={{ fontSize: 11, color: '#6b6359', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#111827' }}
      />
    </div>
  );
}

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
