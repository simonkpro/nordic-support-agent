import { forwardRef } from 'react';
import { AssistantModalPrimitive } from '@assistant-ui/react';
import {
  Bot,
  ChevronDown,
  HelpCircle,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  Thread,
  type SendFill,
  type SendIcon,
  type SendShape,
} from './thread';

export type IconStyle = 'bot' | 'chat_bubble' | 'sparkle' | 'help';
export type LauncherShape = 'circle' | 'rounded' | 'square';

interface AssistantModalProps {
  container?: HTMLElement;
  defaultOpen?: boolean;
  width?: number;
  height?: number;
  greeting?: string;
  iconStyle?: IconStyle;
  launcherShape?: LauncherShape;
  launcherIconColor?: string;
  placeholder?: string;
  sendIcon?: SendIcon;
  sendShape?: SendShape;
  sendFill?: SendFill;
  sendIconColor?: string;
}

export function AssistantModal({
  container,
  defaultOpen,
  width = 400,
  height = 500,
  greeting,
  iconStyle = 'bot',
  launcherShape = 'circle',
  launcherIconColor = '#ffffff',
  placeholder,
  sendIcon,
  sendShape,
  sendFill,
  sendIconColor,
}: AssistantModalProps) {
  return (
    <AssistantModalPrimitive.Root defaultOpen={defaultOpen}>
      <AssistantModalPrimitive.Anchor className="absolute right-4 bottom-4 size-11">
        <AssistantModalPrimitive.Trigger asChild>
          <AssistantModalButton
            iconStyle={iconStyle}
            launcherShape={launcherShape}
            launcherIconColor={launcherIconColor}
          />
        </AssistantModalPrimitive.Trigger>
      </AssistantModalPrimitive.Anchor>
      <AssistantModalPrimitive.Content
        sideOffset={16}
        avoidCollisions={false}
        portalProps={container ? { container } : undefined}
        style={{ width, height }}
        className={cn(
          'border-border bg-popover text-popover-foreground z-50 overflow-clip rounded-xl border p-0 shadow-lg outline-none',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-2',
        )}
      >
        <Thread
          greeting={greeting}
          placeholder={placeholder}
          sendIcon={sendIcon}
          sendShape={sendShape}
          sendFill={sendFill}
          sendIconColor={sendIconColor}
        />
      </AssistantModalPrimitive.Content>
    </AssistantModalPrimitive.Root>
  );
}

interface AssistantModalButtonProps {
  'data-state'?: 'open' | 'closed';
  iconStyle: IconStyle;
  launcherShape: LauncherShape;
  launcherIconColor: string;
}

const AssistantModalButton = forwardRef<HTMLButtonElement, AssistantModalButtonProps>(
  function AssistantModalButton(
    { 'data-state': state, iconStyle, launcherShape, launcherIconColor, ...rest },
    ref,
  ) {
    const tooltip = state === 'open' ? 'Close assistant' : 'Open assistant';
    const Glyph =
      iconStyle === 'chat_bubble'
        ? MessageCircle
        : iconStyle === 'sparkle'
          ? Sparkles
          : iconStyle === 'help'
            ? HelpCircle
            : Bot;
    const shapeCls =
      launcherShape === 'square'
        ? 'rounded-none'
        : launcherShape === 'rounded'
          ? 'rounded-xl'
          : 'rounded-full';
    return (
      <button
        ref={ref}
        type="button"
        aria-label={tooltip}
        style={{ color: launcherIconColor }}
        className={cn(
          'bg-primary relative inline-flex size-full items-center justify-center shadow-md',
          shapeCls,
          'transition-transform hover:scale-110 active:scale-90',
        )}
        {...rest}
      >
        <Glyph
          data-state={state}
          className="absolute size-5 transition-all data-[state=closed]:rotate-0 data-[state=closed]:scale-100 data-[state=open]:rotate-90 data-[state=open]:scale-0"
        />
        <ChevronDown
          data-state={state}
          className="absolute size-5 transition-all data-[state=closed]:-rotate-90 data-[state=closed]:scale-0 data-[state=open]:rotate-0 data-[state=open]:scale-100"
        />
        <span className="sr-only">{tooltip}</span>
      </button>
    );
  },
);
