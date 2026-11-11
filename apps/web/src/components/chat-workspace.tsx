'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  ChatCitationSchema,
  RetrievalDebugChunkSchema,
  citationsReferencedInAnswer,
  ConversationListResponseSchema,
  ConversationMessagesResponseSchema,
  ConversationSummarySchema,
  ChatObservabilitySchema,
  SecurityNoticeSchema,
  type ChatCitation,
  type ChatObservability,
  type RetrievalDebugChunk,
  type ConversationSummary,
  type MembershipRole,
  type SecurityNotice,
} from '@orgmind/shared';
import { WorkspaceNavigation } from './workspace-navigation';
import { useFeedback } from './feedback-provider';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type OrgMindMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: (
    | { type: 'text'; text: string }
    | { type: 'data-citations'; data: ChatCitation[] }
    | { type: 'data-retrieval-debug'; data: RetrievalDebugChunk[] }
    | { type: 'data-observability'; data: ChatObservability }
    | { type: 'data-security-notice'; data: SecurityNotice }
    | { type: 'data-agent-step'; data: AgentTimelineStep }
  )[];
};

type AgentTimelineStep = {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'retrying' | 'skipped';
  detail?: string;
};

function toUiMessages(
  messages: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    citations: ChatCitation[];
    retrievalDebug: RetrievalDebugChunk[];
    observability?: ChatObservability | undefined;
    securityNotice?: SecurityNotice | undefined;
  }[],
): OrgMindMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    parts: [
      { type: 'text', text: message.content },
      ...(message.role === 'assistant' && message.citations.length > 0
        ? [{ type: 'data-citations' as const, data: message.citations }]
        : []),
      ...(message.role === 'assistant' && message.retrievalDebug.length > 0
        ? [{ type: 'data-retrieval-debug' as const, data: message.retrievalDebug }]
        : []),
      ...(message.role === 'assistant' && message.observability
        ? [{ type: 'data-observability' as const, data: message.observability }]
        : []),
      ...(message.role === 'assistant' && message.securityNotice
        ? [{ type: 'data-security-notice' as const, data: message.securityNotice }]
        : []),
    ],
  }));
}

export function ChatWorkspace({
  organizationId,
  organizationName,
  role,
}: {
  organizationId: string;
  organizationName: string;
  role: MembershipRole;
}) {
  const { confirm, notify, prompt, updateToast } = useFeedback();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshConversations = useCallback(async () => {
    const response = await fetch(
      `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/chat/conversations`,
      { credentials: 'include', cache: 'no-store' },
    );
    if (!response.ok) throw new Error('Could not load your conversations.');
    const result = ConversationListResponseSchema.parse(await response.json());
    setConversations(result.conversations);
    return result.conversations;
  }, [organizationId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await refreshConversations();
        if (active && result[0]) setSelectedId(result[0].id);
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Could not load conversations.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshConversations]);

  async function createConversation() {
    setError('');
    const toastId = notify({
      kind: 'loading',
      title: 'Starting conversation',
      description: 'Opening a fresh thread…',
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/chat/conversations`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ organizationId }),
        },
      );
      if (!response.ok) throw new Error('Could not start a new conversation.');
      const payload: unknown = await response.json();
      const conversation = ConversationSummarySchema.parse(
        (payload as { conversation: unknown }).conversation,
      );
      setConversations((current) => [conversation, ...current]);
      setSelectedId(conversation.id);
      updateToast(toastId, {
        kind: 'success',
        title: 'Conversation started',
        description: 'Ask a question about your workspace knowledge.',
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not start conversation',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    }
  }

  async function renameConversation(conversation: ConversationSummary) {
    const title = await prompt({
      title: 'Rename conversation',
      message: 'Give this thread a name that will be easy to find later.',
      initialValue: conversation.title,
      placeholder: 'Conversation name',
      confirmLabel: 'Save name',
      danger: false,
    });
    if (!title || title === conversation.title) return;
    const toastId = notify({
      kind: 'loading',
      title: 'Renaming conversation',
      description: `Saving “${title}”…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/chat/conversations/${encodeURIComponent(conversation.id)}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        },
      );
      if (!response.ok) throw new Error('Could not rename this conversation.');
      const payload: unknown = await response.json();
      const updated = ConversationSummarySchema.parse(
        (payload as { conversation: unknown }).conversation,
      );
      setConversations((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      updateToast(toastId, {
        kind: 'success',
        title: 'Conversation renamed',
        description: `Saved as “${updated.title}”.`,
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not rename conversation',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    }
  }

  async function deleteConversation(conversation: ConversationSummary) {
    if (
      !(await confirm({
        title: `Delete “${conversation.title}”?`,
        message: 'This conversation and its messages will be permanently removed.',
        confirmLabel: 'Delete conversation',
      }))
    )
      return;
    const toastId = notify({
      kind: 'loading',
      title: 'Deleting conversation',
      description: `Removing “${conversation.title}”…`,
    });
    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/chat/conversations/${encodeURIComponent(conversation.id)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!response.ok) throw new Error('Could not delete this conversation.');
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      if (selectedId === conversation.id) setSelectedId(remaining[0]?.id ?? '');
      updateToast(toastId, {
        kind: 'success',
        title: 'Conversation deleted',
        description: `“${conversation.title}” was removed.`,
        persistent: false,
      });
    } catch (cause) {
      updateToast(toastId, {
        kind: 'error',
        title: 'Could not delete conversation',
        description: cause instanceof Error ? cause.message : 'Please try again.',
        persistent: false,
      });
    }
  }

  const currentConversation = conversations.find((item) => item.id === selectedId);

  return (
    <main className="chat-page">
      <WorkspaceNavigation active="assistant" role={role} />
      <div className="chat-layout">
        <aside className="chat-history" aria-label="Conversation history">
          <div className="chat-history-heading">
            <div>
              <p className="eyebrow">{organizationName.toUpperCase()}</p>
              <h1>Conversations</h1>
            </div>
            <button
              className="primary-button chat-new-button"
              onClick={() => void createConversation()}
            >
              + New
            </button>
          </div>
          {error && (
            <p className="chat-error" role="alert">
              {error}
            </p>
          )}
          {loading ? (
            <p className="chat-history-empty">Loading conversations…</p>
          ) : conversations.length === 0 ? (
            <div className="chat-history-empty">
              Start a conversation to ask about your workspace documents.
            </div>
          ) : (
            <nav className="conversation-list">
              {conversations.map((conversation) => (
                <div
                  className={`conversation-item${selectedId === conversation.id ? ' is-selected' : ''}`}
                  key={conversation.id}
                >
                  <button
                    className="conversation-select"
                    type="button"
                    onClick={() => setSelectedId(conversation.id)}
                  >
                    <span>{conversation.title}</span>
                    <small>{new Date(conversation.updatedAt).toLocaleDateString()}</small>
                  </button>
                  <div className="conversation-actions">
                    <button
                      type="button"
                      aria-label={`Rename ${conversation.title}`}
                      onClick={() => void renameConversation(conversation)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${conversation.title}`}
                      onClick={() => void deleteConversation(conversation)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </nav>
          )}
          <Link className="chat-back-link" href="/">
            ← Workspace overview
          </Link>
        </aside>
        <section className="chat-main" aria-label="Knowledge assistant chat">
          {currentConversation ? (
            <ChatThread
              key={currentConversation.id}
              conversation={currentConversation}
              organizationId={organizationId}
              onUpdated={() => void refreshConversations()}
            />
          ) : (
            <div className="chat-welcome">
              <span className="chat-welcome-mark">✳</span>
              <p className="eyebrow">GROUNDED IN YOUR WORKSPACE</p>
              <h2>What would you like to know?</h2>
              <p>
                Ask a question about your uploaded documents. Answers include links to the passages
                they use.
              </p>
              <button className="primary-button" onClick={() => void createConversation()}>
                Start a conversation →
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ChatThread({
  conversation,
  organizationId,
  onUpdated,
}: {
  conversation: ConversationSummary;
  organizationId: string;
  onUpdated: () => void;
}) {
  const { dismissToast, notify, updateToast } = useFeedback();
  const [input, setInput] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [selectedCitation, setSelectedCitation] = useState<ChatCitation | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const followScrollRef = useRef(true);
  const pendingTextRef = useRef('');
  const textTimerRef = useRef<number | null>(null);
  const [messages, setMessages] = useState<OrgMindMessage[]>([]);
  const [mode, setMode] = useState<'simple' | 'agentic'>('simple');
  const [modelPreference, setModelPreference] = useState<'auto' | 'fast' | 'strong'>('auto');
  const [status, setStatus] = useState<'ready' | 'streaming'>('ready');
  const [streamError, setStreamError] = useState('');
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(
          `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/chat/conversations/${encodeURIComponent(conversation.id)}`,
          { credentials: 'include', cache: 'no-store' },
        );
        if (!response.ok) throw new Error('Could not load this conversation.');
        const detail = ConversationMessagesResponseSchema.parse(await response.json());
        if (active) setMessages(toUiMessages(detail.messages));
      } catch (cause) {
        if (active)
          setHistoryError(cause instanceof Error ? cause.message : 'Could not load messages.');
      } finally {
        if (active) setHistoryLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [conversation.id, organizationId, setMessages]);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
      if (textTimerRef.current !== null) window.clearTimeout(textTimerRef.current);
      textTimerRef.current = null;
      pendingTextRef.current = '';
    },
    [],
  );

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList || !followScrollRef.current) return;
    const scrollToLatest = () => {
      if (followScrollRef.current) {
        messageList.scrollTo({ top: messageList.scrollHeight, behavior: 'auto' });
      }
    };
    scrollToLatest();

    const observer = new ResizeObserver(scrollToLatest);
    observer.observe(messageList);
    const latestMessage = messageList.lastElementChild;
    if (latestMessage) observer.observe(latestMessage);
    return () => observer.disconnect();
  }, [messages, historyLoading, streamError]);

  function updateFollowScroll(element: HTMLDivElement) {
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    followScrollRef.current = distanceFromBottom < 120;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || status !== 'ready' || historyLoading) return;
    const userMessage: OrgMindMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: question }],
    };
    const localAssistantId = crypto.randomUUID();
    const assistantMessage: OrgMindMessage = {
      id: localAssistantId,
      role: 'assistant',
      parts: [{ type: 'text', text: '' }],
    };
    const controller = new AbortController();
    activeRequest.current = controller;
    followScrollRef.current = true;
    pendingTextRef.current = '';
    if (textTimerRef.current !== null) window.clearTimeout(textTimerRef.current);
    textTimerRef.current = null;
    const toastId = notify({
      kind: 'loading',
      title: 'Searching your workspace',
      description: 'Finding relevant passages and preparing an answer…',
    });
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setStatus('streaming');
    setStreamError('');
    setInput('');
    setSelectedCitation(null);

    try {
      const response = await fetch(
        `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/chat`,
        {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            organizationId,
            conversationId: conversation.id,
            mode,
            modelPreference,
            messages: [userMessage],
          }),
        },
      );
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const errorValue =
          typeof payload === 'object' && payload !== null && 'error' in payload
            ? payload.error
            : null;
        const message =
          typeof errorValue === 'object' &&
          errorValue !== null &&
          'message' in errorValue &&
          typeof errorValue.message === 'string'
            ? errorValue.message
            : 'Could not generate an answer.';
        throw new Error(message);
      }
      if (!response.body) throw new Error('The chat stream was not available.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let responseMessageId = localAssistantId;
      let answerText = '';
      let streamedCitations: ChatCitation[] = [];
      let streamedRetrievalDebug: RetrievalDebugChunk[] = [];
      let streamedObservability: ChatObservability | undefined;
      let streamedSecurityNotice: SecurityNotice | undefined;
      let citationsFinalized = false;
      let streamFailed = false;
      let done = false;

      const appendText = (delta: string) => {
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== responseMessageId) return message;
            const textPart = message.parts.find((item) => item.type === 'text');
            return {
              ...message,
              parts: textPart
                ? message.parts.map((item) =>
                    item === textPart ? { ...item, text: textPart.text + delta } : item,
                  )
                : [...message.parts, { type: 'text', text: delta }],
            };
          }),
        );
      };

      const scheduleTextFlush = () => {
        if (textTimerRef.current !== null) return;
        textTimerRef.current = window.setTimeout(() => {
          textTimerRef.current = null;
          const pending = pendingTextRef.current;
          if (!pending) return;

          const targetLength = Math.min(14, pending.length);
          const boundaryOffset = pending
            .slice(Math.min(8, targetLength), Math.min(26, pending.length))
            .search(/\s/);
          const revealLength =
            boundaryOffset >= 0
              ? Math.min(26, Math.min(8, targetLength) + boundaryOffset + 1)
              : targetLength;
          const delta = pending.slice(0, revealLength);
          pendingTextRef.current = pending.slice(revealLength);
          appendText(delta);
          if (pendingTextRef.current) scheduleTextFlush();
        }, 45);
      };

      const waitForPendingText = async () => {
        while (pendingTextRef.current || textTimerRef.current !== null) {
          await new Promise((resolve) => window.setTimeout(resolve, 20));
        }
      };

      while (!done) {
        const result = await reader.read();
        buffer += decoder.decode(result.value, { stream: !result.done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? '';
        for (const rawEvent of events) {
          const data = rawEvent
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data || data === '[DONE]') continue;
          let chunk: unknown;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          if (!chunk || typeof chunk !== 'object' || !('type' in chunk)) continue;
          const part = chunk as { type: string; [key: string]: unknown };
          if (part.type === 'start' && typeof part.messageId === 'string') {
            responseMessageId = part.messageId;
            setMessages((current) =>
              current.map((message) =>
                message.id === localAssistantId ? { ...message, id: responseMessageId } : message,
              ),
            );
          } else if (part.type === 'data-citations' && Array.isArray(part.data)) {
            const citations = part.data.flatMap((citation) => {
              const parsed = ChatCitationSchema.safeParse(citation);
              return parsed.success ? [parsed.data] : [];
            });
            streamedCitations = citations;
          } else if (part.type === 'data-retrieval-debug' && Array.isArray(part.data)) {
            streamedRetrievalDebug = part.data.flatMap((entry) => {
              const parsed = RetrievalDebugChunkSchema.safeParse(entry);
              return parsed.success ? [parsed.data] : [];
            });
          } else if (part.type === 'data-observability') {
            const parsed = ChatObservabilitySchema.safeParse(part.data);
            streamedObservability = parsed.success ? parsed.data : undefined;
          } else if (part.type === 'data-security-notice') {
            const parsed = SecurityNoticeSchema.safeParse(part.data);
            if (parsed.success) {
              streamedSecurityNotice = parsed.data;
              setMessages((current) =>
                current.map((message) => {
                  if (message.id !== responseMessageId) return message;
                  const parts = [
                    ...message.parts.filter((item) => item.type !== 'data-security-notice'),
                    { type: 'data-security-notice' as const, data: parsed.data },
                  ];
                  return { ...message, parts };
                }),
              );
            }
          } else if (
            part.type === 'data-agent-step' &&
            typeof part.data === 'object' &&
            part.data !== null
          ) {
            const step = part.data as Partial<AgentTimelineStep>;
            if (
              typeof step.id === 'string' &&
              typeof step.label === 'string' &&
              ['running', 'completed', 'retrying', 'skipped'].includes(step.status ?? '')
            ) {
              const timelineStep = step as AgentTimelineStep;
              setMessages((current) =>
                current.map((message) => {
                  if (message.id !== responseMessageId) return message;
                  const parts = message.parts.filter((item) => item.type !== 'data-agent-step');
                  const oldSteps = message.parts.filter(
                    (
                      item,
                    ): item is Extract<
                      OrgMindMessage['parts'][number],
                      { type: 'data-agent-step' }
                    > => item.type === 'data-agent-step',
                  );
                  const nextSteps = oldSteps.filter((item) => item.data.id !== timelineStep.id);
                  nextSteps.push({ type: 'data-agent-step', data: timelineStep });
                  return { ...message, parts: [...parts, ...nextSteps] };
                }),
              );
            }
          } else if (part.type === 'text-delta' && typeof part.delta === 'string') {
            answerText += part.delta;
            pendingTextRef.current += part.delta;
            scheduleTextFlush();
          } else if (part.type === 'error' && typeof part.errorText === 'string') {
            streamFailed = true;
            setStreamError(part.errorText);
            updateToast(toastId, {
              kind: 'error',
              title: 'Could not finish answer',
              description: part.errorText,
              persistent: false,
            });
            setSelectedCitation(null);
            setMessages((current) =>
              current.map((message) =>
                message.id === responseMessageId
                  ? {
                      ...message,
                      parts: message.parts.filter(
                        (item) =>
                          item.type !== 'data-citations' &&
                          item.type !== 'data-retrieval-debug' &&
                          item.type !== 'data-observability' &&
                          item.type !== 'data-agent-step',
                      ),
                    }
                  : message,
              ),
            );
          } else if (part.type === 'finish' && !citationsFinalized) {
            citationsFinalized = true;
            await waitForPendingText();
            if (controller.signal.aborted) return;
            const usedCitations = citationsReferencedInAnswer(answerText, streamedCitations);
            if (usedCitations.length === 0) setSelectedCitation(null);
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== responseMessageId) return message;
                const parts: OrgMindMessage['parts'] = message.parts.filter(
                  (item) =>
                    item.type !== 'data-citations' &&
                    item.type !== 'data-retrieval-debug' &&
                    item.type !== 'data-observability' &&
                    item.type !== 'data-security-notice',
                );
                if (usedCitations.length > 0) {
                  parts.push({ type: 'data-citations', data: usedCitations });
                }
                if (streamedRetrievalDebug.length > 0) {
                  parts.push({ type: 'data-retrieval-debug', data: streamedRetrievalDebug });
                }
                if (streamedObservability) {
                  parts.push({ type: 'data-observability', data: streamedObservability });
                }
                if (streamedSecurityNotice) {
                  parts.push({ type: 'data-security-notice', data: streamedSecurityNotice });
                }
                return {
                  ...message,
                  parts,
                };
              }),
            );
          }
        }
        done = result.done;
      }
      await waitForPendingText();
      if (controller.signal.aborted) return;
      if (!streamFailed) {
        updateToast(toastId, {
          kind: 'success',
          title: 'Answer ready',
          description: 'Your response is ready in this conversation.',
          persistent: false,
        });
      }
      onUpdated();
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        dismissToast(toastId);
      } else {
        updateToast(toastId, {
          kind: 'error',
          title: 'Could not generate an answer',
          description: cause instanceof Error ? cause.message : 'Please try again.',
          persistent: false,
        });
        setStreamError(cause instanceof Error ? cause.message : 'Could not generate an answer.');
        setMessages((current) => current.filter((message) => message.id !== localAssistantId));
      }
    } finally {
      if (textTimerRef.current !== null) {
        window.clearTimeout(textTimerRef.current);
        textTimerRef.current = null;
      }
      pendingTextRef.current = '';
      if (activeRequest.current === controller) activeRequest.current = null;
      setStatus('ready');
    }
  }

  return (
    <div className="chat-thread-layout">
      <div className="chat-thread">
        <header className="chat-thread-heading">
          <div>
            <p className="eyebrow">ORG MIND ASSISTANT</p>
            <h2>{conversation.title}</h2>
          </div>
          <span className="chat-grounded-pill">
            <i /> Document-grounded
          </span>
          <div className="chat-mode-toggle" role="group" aria-label="Answer mode">
            <button
              type="button"
              aria-pressed={mode === 'simple'}
              onClick={() => setMode('simple')}
            >
              Simple
            </button>
            <button
              type="button"
              aria-pressed={mode === 'agentic'}
              onClick={() => setMode('agentic')}
            >
              Agentic
            </button>
          </div>
          <label className="chat-model-select">
            <span>Model</span>
            <select
              value={modelPreference}
              onChange={(event) =>
                setModelPreference(event.currentTarget.value as 'auto' | 'fast' | 'strong')
              }
              aria-label="Model selection"
            >
              <option value="auto">Auto</option>
              <option value="fast">Fast</option>
              <option value="strong">Strong</option>
            </select>
          </label>
        </header>
        <div
          className="chat-message-list"
          ref={messageListRef}
          onScroll={(event) => updateFollowScroll(event.currentTarget)}
          aria-live="polite"
        >
          {historyLoading ? (
            <p className="chat-loading">Loading messages…</p>
          ) : messages.length === 0 ? (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">✳</div>
              <h3>Ask your workspace</h3>
              <p>OrgMind searches your documents and cites the passages behind each answer.</p>
            </div>
          ) : (
            messages.map((message) => {
              const isStreamingAssistant =
                status === 'streaming' &&
                message.role === 'assistant' &&
                message.id === messages.at(-1)?.id;
              const hasText = message.parts.some(
                (part) => part.type === 'text' && part.text.length > 0,
              );
              return (
                <article className={`chat-message message-${message.role}`} key={message.id}>
                  <div className="chat-message-label">
                    {message.role === 'user' ? 'You' : 'OrgMind'}
                  </div>
                  <div
                    className={`chat-message-content${isStreamingAssistant ? ' is-streaming' : ''}`}
                  >
                    {message.parts.map((part, index) => {
                      if (part.type === 'text') {
                        if (!part.text && isStreamingAssistant) return null;
                        return (
                          <p key={`${message.id}-${index}`}>
                            {part.text}
                            {isStreamingAssistant && <span className="assistant-stream-caret" />}
                          </p>
                        );
                      }
                      if (part.type === 'data-citations') {
                        const citations = part.data as ChatCitation[];
                        return citations.length > 0 ? (
                          <div
                            className="citation-chips"
                            key={`${message.id}-${index}`}
                            aria-label="Answer sources"
                          >
                            {citations.map((citation) => (
                              <button
                                className="citation-chip"
                                key={citation.chunkId}
                                type="button"
                                onClick={() =>
                                  setSelectedCitation(ChatCitationSchema.parse(citation))
                                }
                              >
                                {citation.documentName} · #{citation.chunkIndex + 1}
                              </button>
                            ))}
                          </div>
                        ) : null;
                      }
                      if (part.type === 'data-security-notice') {
                        return (
                          <aside
                            className={`chat-security-notice is-${part.data.kind}`}
                            key={`${message.id}-${index}`}
                            role="status"
                          >
                            <span aria-hidden="true">
                              {part.data.kind === 'blocked' ? '⛨' : '✦'}
                            </span>
                            <p>{part.data.message}</p>
                          </aside>
                        );
                      }
                      if (part.type === 'data-observability' && part.data.cacheHit) {
                        return (
                          <span
                            className="semantic-cache-indicator"
                            key={`${message.id}-${index}`}
                            title="This answer was reused from a semantically similar, access-checked response."
                          >
                            ✦ Cached answer · {Math.round((part.data.cacheSimilarity ?? 0) * 100)}%
                            match
                          </span>
                        );
                      }
                      if (part.type === 'data-agent-step') {
                        const step = part.data;
                        return (
                          <div
                            className="agent-timeline"
                            key={`${message.id}-${step.id}`}
                            aria-label="Agent progress"
                          >
                            <span
                              className={`agent-step-dot is-${step.status}`}
                              aria-hidden="true"
                            />
                            <span className="agent-step-label">{step.label}</span>
                            {step.detail && (
                              <span className="agent-step-detail">{step.detail}</span>
                            )}
                          </div>
                        );
                      }
                      if (
                        part.type === 'data-retrieval-debug' &&
                        process.env.NODE_ENV === 'development'
                      ) {
                        return (
                          <details className="retrieval-debug" key={`${message.id}-${index}`}>
                            <summary>Retrieval debug · {part.data.length} chunks</summary>
                            <div className="retrieval-debug-table-wrap">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Chunk</th>
                                    <th>Vector rank / score</th>
                                    <th>Keyword rank / score</th>
                                    <th>Fused rank / score</th>
                                    <th>Rerank rank / score</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {part.data.map((row) => (
                                    <tr key={row.chunkId}>
                                      <td>
                                        {row.documentName} · #{row.chunkIndex + 1}
                                      </td>
                                      <td>
                                        {row.vectorRank ?? '—'} /{' '}
                                        {row.vectorScore?.toFixed(4) ?? '—'}
                                      </td>
                                      <td>
                                        {row.keywordRank ?? '—'} /{' '}
                                        {row.keywordScore?.toFixed(4) ?? '—'}
                                      </td>
                                      <td>
                                        {row.fusedRank ?? '—'} / {row.fusedScore.toFixed(5)}
                                      </td>
                                      <td>
                                        {row.rerankRank ?? '—'} /{' '}
                                        {row.rerankScore?.toFixed(4) ?? '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        );
                      }
                      if (
                        part.type === 'data-observability' &&
                        process.env.NODE_ENV === 'development'
                      ) {
                        const data = part.data;
                        return (
                          <details
                            className="chat-observability-debug"
                            key={`${message.id}-${index}`}
                          >
                            <summary>Usage &amp; performance</summary>
                            <dl>
                              <div>
                                <dt>Model</dt>
                                <dd>{data.modelId ?? '—'}</dd>
                              </div>
                              <div>
                                <dt>Tokens</dt>
                                <dd>
                                  {data.inputTokens.toLocaleString()} in ·{' '}
                                  {data.outputTokens.toLocaleString()} out
                                </dd>
                              </div>
                              <div>
                                <dt>Estimated cost</dt>
                                <dd>${data.estimatedCostUsd.toFixed(6)}</dd>
                              </div>
                              <div>
                                <dt>Retrieval</dt>
                                <dd>{Math.round(data.latencyMs.retrieval)} ms</dd>
                              </div>
                              <div>
                                <dt>MongoDB search</dt>
                                <dd>{Math.round(data.latencyMs.search)} ms</dd>
                              </div>
                              <div>
                                <dt>Embedding</dt>
                                <dd>{Math.round(data.latencyMs.embedding)} ms</dd>
                              </div>
                              <div>
                                <dt>Rerank</dt>
                                <dd>{Math.round(data.latencyMs.rerank)} ms</dd>
                              </div>
                              <div>
                                <dt>Generation</dt>
                                <dd>{Math.round(data.latencyMs.generation)} ms</dd>
                              </div>
                              <div>
                                <dt>Total</dt>
                                <dd>{Math.round(data.latencyMs.total)} ms</dd>
                              </div>
                              {data.traceId && (
                                <div>
                                  <dt>Trace ID</dt>
                                  <dd>{data.traceId}</dd>
                                </div>
                              )}
                            </dl>
                          </details>
                        );
                      }
                      return null;
                    })}
                    {isStreamingAssistant && !hasText && (
                      <div className="assistant-typing-indicator" role="status">
                        <span>Searching your documents</span>
                        <i />
                        <i />
                        <i />
                      </div>
                    )}
                  </div>
                </article>
              );
            })
          )}
          {historyError && (
            <p className="chat-error" role="alert">
              {historyError}
            </p>
          )}
          {streamError && (
            <p className="chat-error" role="alert">
              {streamError}
            </p>
          )}
        </div>
        <form className="chat-composer" onSubmit={submit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask a question about your documents…"
            maxLength={2_000}
            rows={2}
            disabled={historyLoading || status !== 'ready'}
          />
          <div className="chat-composer-footer">
            <span className="chat-composer-hint-desktop">
              Answers are based on documents in this workspace.
            </span>
            <span className="chat-composer-hint-mobile">Grounded in workspace documents.</span>
            <button
              className="primary-button"
              type="submit"
              disabled={!input.trim() || historyLoading || status !== 'ready'}
            >
              {status === 'streaming' ? 'Answering…' : 'Send'} <span>↑</span>
            </button>
          </div>
        </form>
      </div>
      {selectedCitation && (
        <aside className="source-preview" aria-label="Source passage">
          <div className="source-preview-heading">
            <div>
              <p className="eyebrow">SOURCE PASSAGE</p>
              <h3>{selectedCitation.documentName}</h3>
            </div>
            <button
              type="button"
              aria-label="Close source preview"
              onClick={() => setSelectedCitation(null)}
            >
              ×
            </button>
          </div>
          {selectedCitation.headingPath.length > 0 && (
            <p className="source-heading-path">{selectedCitation.headingPath.join(' / ')}</p>
          )}
          <p className="source-chunk-label">Chunk {selectedCitation.chunkIndex + 1}</p>
          <blockquote>
            <mark>{selectedCitation.passage}</mark>
          </blockquote>
          <Link
            className="source-open-link"
            href={`/knowledge/${encodeURIComponent(selectedCitation.documentId)}`}
          >
            Open document →
          </Link>
        </aside>
      )}
    </div>
  );
}
