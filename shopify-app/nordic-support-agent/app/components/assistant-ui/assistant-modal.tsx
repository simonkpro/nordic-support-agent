import { forwardRef } from 'react';
import { AssistantModalPrimitive } from '@assistant-ui/react';
import { Bot, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Thread } from './thread';

interface AssistantModalProps {
  /** Anchor container — when omitted, anchors to the body. */
  container?: HTMLElement;
  defaultOpen?: boolean;
}

/**
 * Floating chat modal — bot icon button bottom-right that morphs to a
 * chevron when open, plus a slide-from-bottom-right popover hosting the
 * Thread. Based on assistant-ui's reference modal example.
 */
export function AssistantModal({ container, defaultOpen }: AssistantModalProps) {
  return (
    <AssistantModalPrimitive.Root defaultOpen={defaultOpen}>
      <AssistantModalPrimitive.Anchor className="absolute right-4 bottom-4 size-11">
        <AssistantModalPrimitive.Trigger asChild>
          <AssistantModalButton />
        </AssistantModalPrimitive.Trigger>
      </AssistantModalPrimitive.Anchor>
      <AssistantModalPrimitive.Content
        sideOffset={16}
        avoidCollisions={false}
        portalProps={container ? { container } : undefined}
        className={cn(
          'border-border bg-popover text-popover-foreground z-50 h-[500px] w-[400px] overflow-clip rounded-xl border p-0 shadow-lg outline-none',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-2',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-2',
        )}
      >
        <Thread />
      </AssistantModalPrimitive.Content>
    </AssistantModalPrimitive.Root>
  );
}

interface AssistantModalButtonProps {
  'data-state'?: 'open' | 'closed';
}

const AssistantModalButton = forwardRef<HTMLButtonElement, AssistantModalButtonProps>(
  function AssistantModalButton({ 'data-state': state, ...rest }, ref) {
    const tooltip = state === 'open' ? 'Close assistant' : 'Open assistant';
    return (
      <button
        ref={ref}
        type="button"
        aria-label={tooltip}
        className={cn(
          'bg-primary text-primary-foreground relative inline-flex size-full items-center justify-center rounded-full shadow-md',
          'transition-transform hover:scale-110 active:scale-90',
        )}
        {...rest}
      >
        <Bot
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
