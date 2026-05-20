import 'dotenv/config';
import { loadOrCreateDefaultAssistant, updateAssistant } from '../shopify-app/nordic-support-agent/app/lib/assistants.ts';

/**
 * Update the preview-shop's default assistant so its widget config matches
 * the design's defaults exactly: near-black brand, coral accent, chat-bubble
 * launcher icon, circle send + launcher shapes, etc. Idempotent — run again
 * after tweaking design defaults and it'll re-flatten the row.
 */

const SHOP = 'preview-shop.myshopify.com';
const assistant = await loadOrCreateDefaultAssistant(SHOP);

const next = {
  ...assistant.config,
  widget: {
    ...assistant.config.widget,
    primaryColor: '#1a1a1a',
    accentColor: '#e85d4a',
    iconStyle: 'chat_bubble',
    launcherShape: 'circle',
    sendShape: 'circle',
    sendFill: 'solid',
    launcherIconColor: '#ffffff',
    sendIconColor: '#ffffff',
    width: 380,
    height: 600,
  },
};

const updated = await updateAssistant(assistant.id, { config: next });
console.log('Updated', updated.id, updated.name, '— widget config flattened to design defaults.');
