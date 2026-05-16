import { useEffect, useState } from 'react';
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import { ArrowUp, Bot, User } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ThreadProps {
  /** Phrases cycled through every ~2.5s while the assistant is generating. */
  thinkingVerbs?: string[];
  /** Optional greeting line — shown in the empty state above the prompt. */
  greeting?: string;
}

/**
 * Minimal Thread component built on assistant-ui primitives. Provides:
 * - Auto-scrolling message viewport
 * - User vs assistant bubble styling
 * - Composer with submit + auto-submit-on-enter
 * - Rotating "thinking" indicator while assistant is producing a reply
 */
export function Thread({ thinkingVerbs, greeting }: ThreadProps = {}) {
  return (
    <ThreadPrimitive.Root className="bg-popover text-popover-foreground flex h-full flex-col">
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        <ThreadPrimitive.Empty>
          <div className="text-muted-foreground flex h-full items-center justify-center text-sm">
            {greeting?.trim() || 'Hi! How can I help?'}
          </div>
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />

        <ThreadPrimitive.If running>
          <ThinkingIndicator verbs={thinkingVerbs ?? []} />
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>

      <Composer />
    </ThreadPrimitive.Root>
  );
}

function ThinkingIndicator({ verbs }: { verbs: string[] }) {
  // Use defaults if the merchant cleared their list.
  const effective = verbs.length > 0 ? verbs : ['Thinking'];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (effective.length <= 1) return;
    // Random walk so two runs don't always cycle the same way.
    const t = setInterval(() => {
      setIndex((i) => {
        if (effective.length === 1) return 0;
        let next = Math.floor(Math.random() * effective.length);
        if (next === i) next = (next + 1) % effective.length;
        return next;
      });
    }, 2500);
    return () => clearInterval(t);
  }, [effective.length]);

  return (
    <div className="flex justify-start">
      <div className="flex items-start gap-2">
        <div className="bg-primary text-primary-foreground flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="text-muted-foreground bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-sm italic">
          {effective[index]}
          <span className="ns-thinking-ellipsis">…</span>
        </div>
      </div>
    </div>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="flex max-w-[80%] items-start gap-2">
        <div className="bg-primary text-primary-foreground rounded-2xl rounded-br-sm px-3 py-2 text-sm whitespace-pre-wrap">
          <MessagePrimitive.Parts />
        </div>
        <div className="bg-muted text-muted-foreground flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
          <User className="h-3.5 w-3.5" />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="flex max-w-[80%] items-start gap-2">
        <div className="bg-primary text-primary-foreground flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="bg-muted text-foreground rounded-2xl rounded-bl-sm px-3 py-2 text-sm whitespace-pre-wrap">
          <MessagePrimitive.Parts />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="border-border flex items-end gap-2 border-t p-3">
      <ComposerPrimitive.Input
        rows={1}
        autoFocus
        placeholder="Type your message…"
        className={cn(
          'placeholder:text-muted-foreground flex-1 resize-none border-none bg-transparent px-2 py-2 text-sm outline-none',
          'max-h-32',
        )}
      />
      <ComposerPrimitive.Send asChild>
        <button
          type="submit"
          className={cn(
            'bg-primary text-primary-foreground inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md',
            'transition-opacity hover:opacity-90 disabled:opacity-40',
          )}
          aria-label="Send"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}
