import { useEffect, useState } from 'react';
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react';
import { ArrowRight, ArrowUp, Bot, Send, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';

export type SendIcon = 'arrow_up' | 'arrow_right' | 'send_plane';
export type SendShape = 'square' | 'rounded' | 'circle';
export type SendFill = 'solid' | 'outline' | 'ghost';

interface ThreadProps {
  /** Optional greeting line — shown in the empty state above the prompt. */
  greeting?: string;
  placeholder?: string;
  sendIcon?: SendIcon;
  sendShape?: SendShape;
  sendFill?: SendFill;
  sendIconColor?: string;
}

export function Thread({
  greeting,
  placeholder,
  sendIcon = 'arrow_up',
  sendShape = 'rounded',
  sendFill = 'solid',
  sendIconColor = '#ffffff',
}: ThreadProps = {}) {
  return (
    <ThreadPrimitive.Root className="bg-popover text-popover-foreground flex h-full flex-col">
      <ThreadPrimitive.Viewport className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        <ThreadPrimitive.Empty>
          <GreetingBubble greeting={greeting} />
        </ThreadPrimitive.Empty>

        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>

      <Composer
        placeholder={placeholder}
        sendIcon={sendIcon}
        sendShape={sendShape}
        sendFill={sendFill}
        sendIconColor={sendIconColor}
      />
    </ThreadPrimitive.Root>
  );
}

// Static "first bot message" shown before any real turn exists. Visually
// identical to AssistantMessage so the conversation reads as if the bot
// already greeted the customer — better warmth than centered grey text.
function GreetingBubble({ greeting }: { greeting?: string }) {
  const text = greeting?.trim() || 'Hi! How can I help?';
  // Delay the greeting by ~1s after open so it feels like the bot is
  // "joining" the chat rather than already shouting at you. The Empty
  // primitive only mounts this component when the thread is empty AND
  // visible, so a setTimeout from mount time is the right anchor.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(t);
  }, []);
  if (!visible) return null;
  return (
    <div className="flex justify-start animate-in fade-in slide-in-from-bottom-1 duration-200">
      <div className="flex max-w-[80%] items-start gap-2">
        <div className="bg-primary text-primary-foreground flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="bg-muted text-foreground ns-md rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
          <MarkdownText text={text} />
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
        <div className="bg-muted text-foreground ns-md rounded-2xl rounded-bl-sm px-3 py-2 text-sm">
          <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

// Renders a text part as markdown. GFM enables tables/strikethrough/etc.
// Links open in a new tab — they always point off-widget (merchant policy
// pages, blog posts, product pages).
function MarkdownText({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
            style={{ color: 'inherit' }}
          >
            {children}
          </a>
        ),
        // Tight defaults so paragraphs/lists/headings don't bloat the bubble.
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        h1: ({ children }) => <h1 className="mb-1 text-base font-semibold">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-1 text-sm font-semibold">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
        code: ({ children }) => (
          <code className="bg-background/60 rounded px-1 py-0.5 text-[12px]">{children}</code>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function Composer({
  placeholder,
  sendIcon,
  sendShape,
  sendFill,
  sendIconColor,
}: {
  placeholder?: string;
  sendIcon: SendIcon;
  sendShape: SendShape;
  sendFill: SendFill;
  sendIconColor: string;
}) {
  const SendGlyph =
    sendIcon === 'arrow_right' ? ArrowRight : sendIcon === 'send_plane' ? Send : ArrowUp;
  const shapeCls =
    sendShape === 'circle' ? 'rounded-full' : sendShape === 'square' ? 'rounded-none' : 'rounded-md';
  // Solid: button bg uses --primary, icon uses sendIconColor.
  // Outline: transparent bg + border in sendIconColor, icon in sendIconColor.
  // Ghost:   transparent bg, icon in sendIconColor.
  const btnStyle: React.CSSProperties =
    sendFill === 'solid'
      ? { color: sendIconColor }
      : sendFill === 'outline'
        ? { color: sendIconColor, borderColor: sendIconColor, borderWidth: 1, background: 'transparent' }
        : { color: sendIconColor, background: 'transparent' };
  const fillCls =
    sendFill === 'solid'
      ? 'bg-primary hover:opacity-90'
      : sendFill === 'outline'
        ? 'border hover:bg-primary/10'
        : 'hover:bg-primary/10';

  return (
    <ComposerPrimitive.Root className="border-border flex items-end gap-2 border-t p-3">
      <ComposerPrimitive.Input
        rows={1}
        autoFocus
        placeholder={placeholder?.trim() || 'Type your message…'}
        className={cn(
          'placeholder:text-muted-foreground flex-1 resize-none border-none bg-transparent px-2 py-2 text-sm outline-none',
          'max-h-32',
        )}
      />
      <ComposerPrimitive.Send asChild>
        <button
          type="submit"
          style={btnStyle}
          className={cn(
            'inline-flex h-9 w-9 flex-shrink-0 items-center justify-center transition',
            shapeCls,
            fillCls,
            'disabled:opacity-40',
          )}
          aria-label="Send"
        >
          <SendGlyph className="h-4 w-4" />
        </button>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}
