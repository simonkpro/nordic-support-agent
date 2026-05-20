import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Form, redirect, useFetcher, useLoaderData } from 'react-router';
import { getWorkspaceFromRequest } from '../lib/workspace-auth';
import { loadOrCreateDefaultAssistant, updateAssistant } from '../lib/assistants';
import {
  FieldLabel,
  OnboardingShell,
  SegmentedPicker,
  TextInput,
} from '../components/onboarding-shell';
import { Card, SectionLabel, SHELL_TOKENS } from '../components/admin-shell';

type BusinessType =
  | 'ecommerce'
  | 'beauty_clinic'
  | 'dental'
  | 'healthcare'
  | 'real_estate'
  | 'consulting'
  | 'education'
  | 'restaurant'
  | 'physical_retail'
  | 'service'
  | 'other';

interface LoaderData {
  companyName: string;
  businessType: BusinessType;
  language: 'sv' | 'en' | 'no' | 'da' | 'fi';
  country: 'SE' | 'NO' | 'DK' | 'FI';
}

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const session = await getWorkspaceFromRequest(request);
  if (!session && process.env.NODE_ENV === 'production') throw redirect('/signin');
  const shop = session?.workspaceId ?? 'preview-shop.myshopify.com';
  const assistant = await loadOrCreateDefaultAssistant(shop);
  return {
    companyName: assistant.config.business.companyName || session?.workspaceName || '',
    businessType: assistant.config.business.type,
    language: assistant.config.language,
    country: assistant.config.country,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const session = await getWorkspaceFromRequest(request);
  if (!session && process.env.NODE_ENV === 'production') throw redirect('/signin');
  const shop = session?.workspaceId ?? 'preview-shop.myshopify.com';
  const form = await request.formData();
  const assistant = await loadOrCreateDefaultAssistant(shop);
  await updateAssistant(assistant.id, {
    config: {
      ...assistant.config,
      business: {
        ...assistant.config.business,
        companyName: String(form.get('companyName') ?? ''),
        type: form.get('type') as LoaderData['businessType'],
      },
      language: form.get('language') as LoaderData['language'],
      country: form.get('country') as LoaderData['country'],
    },
  });
  return redirect('/onboarding/knowledge');
};

const BUSINESS_TYPES: Array<{ value: BusinessType; label: string }> = [
  { value: 'ecommerce', label: 'E-handel' },
  { value: 'beauty_clinic', label: 'Skönhetsklinik' },
  { value: 'dental', label: 'Tandvård' },
  { value: 'healthcare', label: 'Vårdgivare' },
  { value: 'real_estate', label: 'Fastighetsbolag' },
  { value: 'consulting', label: 'Konsultverksamhet' },
  { value: 'education', label: 'Utbildning' },
  { value: 'restaurant', label: 'Restaurang' },
  { value: 'physical_retail', label: 'Fysisk butik' },
  { value: 'service', label: 'Övrig tjänst' },
  { value: 'other', label: 'Övrigt' },
];
const LANGUAGES: Array<{ value: LoaderData['language']; label: string }> = [
  { value: 'sv', label: 'SV' },
  { value: 'en', label: 'EN' },
  { value: 'no', label: 'NO' },
  { value: 'da', label: 'DA' },
  { value: 'fi', label: 'FI' },
];
const COUNTRIES: Array<{ value: LoaderData['country']; label: string }> = [
  { value: 'SE', label: 'SE' },
  { value: 'NO', label: 'NO' },
  { value: 'DK', label: 'DK' },
  { value: 'FI', label: 'FI' },
];

export default function OnboardingWelcome() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [businessType, setBusinessType] = useState(data.businessType);
  const [language, setLanguage] = useState(data.language);
  const [country, setCountry] = useState(data.country);

  return (
    <OnboardingShell
      step="welcome"
      title="Låt oss presentera din agent."
      subtitle="Några grundläggande uppgifter så att boten kan prata om din verksamhet på rätt språk och med rätt ton. Vi har förifyllt det vi kan."
      showSkip={false}
      primaryAction={{ method: 'POST', intent: 'save', nextHref: '/onboarding/knowledge' }}
      primaryActionState={fetcher.state}
    >
      <Form method="post" id="onboarding-form">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr',
            gap: 48,
            maxWidth: 980,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <FieldLabel label="Företagsnamn" required hint="förifyllt" />
              <TextInput name="companyName" defaultValue={data.companyName} required />
            </div>
            <div>
              <FieldLabel label="Bransch" required />
              <BadgeChips
                options={BUSINESS_TYPES}
                value={businessType}
                onChange={setBusinessType}
              />
              <input type="hidden" name="type" value={businessType} />
            </div>
            <div>
              <FieldLabel label="Standardspråk" required />
              <SegmentedPicker
                options={LANGUAGES}
                value={language}
                onChange={setLanguage}
                name="language"
              />
            </div>
            <div>
              <FieldLabel label="Land" required />
              <SegmentedPicker
                options={COUNTRIES}
                value={country}
                onChange={setCountry}
                name="country"
              />
            </div>
          </div>
          <Card>
            <SectionLabel>Varför vi frågar</SectionLabel>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {[
                'Agenten använder ditt företagsnamn när den hälsar på besökare.',
                'Branschen styr standard-systemprompten och kategoriseringen.',
                'Språket sätter widgetens UI och första meddelandet.',
                'Landet styr valuta, moms och tidszon som standard.',
              ].map((s, i) => (
                <li
                  key={i}
                  style={{
                    fontSize: 13,
                    color: SHELL_TOKENS.ink,
                    padding: '10px 0',
                    borderTop:
                      i === 0 ? 'none' : `1px dashed ${SHELL_TOKENS.lineDash}`,
                    lineHeight: 1.5,
                  }}
                >
                  {s}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Form>
    </OnboardingShell>
  );
}

/**
 * Pill-style chip selector — flex-wraps cleanly across rows and feels
 * lighter than a boxed radio grid for verticals that don't map well to
 * a tight column count. Selected chip is filled-ink with a leading
 * check mark; unselected is a hairline outline.
 */
function BadgeChips({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: BusinessType; label: string }>;
  value: BusinessType;
  onChange: (v: BusinessType) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '9px 16px',
              borderRadius: 999,
              border: `1px solid ${on ? SHELL_TOKENS.ink : SHELL_TOKENS.line}`,
              background: on ? SHELL_TOKENS.ink : 'transparent',
              color: on ? '#fff' : SHELL_TOKENS.ink,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: on ? 500 : 400,
              cursor: 'pointer',
              transition: 'background 120ms, color 120ms, border-color 120ms',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 999,
                border: `1px solid ${on ? '#fff' : SHELL_TOKENS.line}`,
                display: 'inline-grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              {on && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: '#fff',
                  }}
                />
              )}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
