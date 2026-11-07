'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ChatCitationSchema,
  RetrievalDebugChunkSchema,
  citationsReferencedInAnswer,
  ConversationListResponseSchema,
  ConversationMessagesResponseSchema,
  ConversationSummarySchema,
  type ChatCitation,
  type RetrievalDebugChunk,
  type ConversationSummary,
} from '@orgmind/shared';
import { ThemeToggle } from './theme-toggle';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
type OrgMindMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: (
    | { type: 'text'; text: string }
    | { type: 'data-citations'; data: ChatCitation[] }
    | { type: 'data-retrieval-debug'; data: RetrievalDebugChunk[] }
  )[];
};

function toUiMessages(
  messages: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    citations: ChatCitation[];
    retrievalDebug: RetrievalDebugChunk[];
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
    ],
  }));
}

export function ChatWorkspace({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start a conversation.');
    }
  }

  async function renameConversation(conversation: ConversationSummary) {
    const title = window.prompt('Conversation name', conversation.title)?.trim();
    if (!title || title === conversation.title) return;
    const response = await fetch(
      `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/chat/conversations/${encodeURIComponent(conversation.id)}`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      },
    );
    if (!response.ok) {
      setError('Could not rename this conversation.');
      return;
    }
    const payload: unknown = await response.json();
    const updated = ConversationSummarySchema.parse(
      (payload as { conversation: unknown }).conversation,
    );
    setConversations((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function deleteConversation(conversation: ConversationSummary) {
    if (!window.confirm(`Delete “${conversation.title}” and its messages?`)) return;
    const response = await fetch(
      `${apiUrl}/organizations/${encodeURIComponent(organizationId)}/chat/conversations/${encodeURIComponent(conversation.id)}`,
      { method: 'DELETE', credentials: 'include' },
    );
    if (!response.ok) {
      setError('Could not delete this conversation.');
      return;
    }
    const remaining = conversations.filter((item) => item.id !== conversation.id);
    setConversations(remaining);
    if (selectedId === conversation.id) setSelectedId(remaining[0]?.id ?? '');
  }

  const currentConversation = conversations.find((item) => item.id === selectedId);

  return (
    <main className="chat-page">
      <header className="chat-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">O</span>
          <span>
            orgmind<span className="brand-dot">.</span>
          </span>
        </Link>
        <div className="chat-topbar-actions">
          <ThemeToggle className="knowledge-theme-toggle" />
          <Link href="/knowledge">Knowledge base</Link>
        </div>
      </header>
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
  const [input, setInput] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [selectedCitation, setSelectedCitation] = useState<ChatCitation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<OrgMindMessage[]>([]);
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

  useEffect(() => () => activeRequest.current?.abort(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

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
      let citationsFinalized = false;
      let done = false;
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
          } else if (part.type === 'text-delta' && typeof part.delta === 'string') {
            answerText += part.delta;
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== responseMessageId) return message;
                const textPart = message.parts.find((item) => item.type === 'text');
                return {
                  ...message,
                  parts: textPart
                    ? message.parts.map((item) =>
                        item === textPart
                          ? { ...item, text: (item.text + part.delta) as string }
                          : item,
                      )
                    : [...message.parts, { type: 'text', text: part.delta as string }],
                };
              }),
            );
          } else if (part.type === 'error' && typeof part.errorText === 'string') {
            setStreamError(part.errorText);
            setSelectedCitation(null);
            setMessages((current) =>
              current.map((message) =>
                message.id === responseMessageId
                  ? {
                      ...message,
                      parts: message.parts.filter(
                        (item) =>
                          item.type !== 'data-citations' && item.type !== 'data-retrieval-debug',
                      ),
                    }
                  : message,
              ),
            );
          } else if (part.type === 'finish' && !citationsFinalized) {
            citationsFinalized = true;
            const usedCitations = citationsReferencedInAnswer(answerText, streamedCitations);
            if (usedCitations.length === 0) setSelectedCitation(null);
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== responseMessageId) return message;
                const parts: OrgMindMessage['parts'] = message.parts.filter(
                  (item) => item.type !== 'data-citations' && item.type !== 'data-retrieval-debug',
                );
                if (usedCitations.length > 0) {
                  parts.push({ type: 'data-citations', data: usedCitations });
                }
                if (streamedRetrievalDebug.length > 0) {
                  parts.push({ type: 'data-retrieval-debug', data: streamedRetrievalDebug });
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
      onUpdated();
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setStreamError(cause instanceof Error ? cause.message : 'Could not generate an answer.');
        setMessages((current) => current.filter((message) => message.id !== localAssistantId));
      }
    } finally {
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
        </header>
        <div className="chat-message-list" aria-live="polite">
          {historyLoading ? (
            <p className="chat-loading">Loading messages…</p>
          ) : messages.length === 0 ? (
            <div className="chat-empty-state">
              <div className="chat-empty-icon">✳</div>
              <h3>Ask your workspace</h3>
              <p>OrgMind searches your documents and cites the passages behind each answer.</p>
            </div>
          ) : (
            messages.map((message) => (
              <article className={`chat-message message-${message.role}`} key={message.id}>
                <div className="chat-message-label">
                  {message.role === 'user' ? 'You' : 'OrgMind'}
                </div>
                <div className="chat-message-content">
                  {message.parts.map((part, index) => {
                    if (part.type === 'text')
                      return <p key={`${message.id}-${index}`}>{part.text}</p>;
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
                                  <th>Fused</th>
                                </tr>
                              </thead>
                              <tbody>
                                {part.data.map((row) => (
                                  <tr key={row.chunkId}>
                                    <td>
                                      {row.documentName} · #{row.chunkIndex + 1}
                                    </td>
                                    <td>
                                      {row.vectorRank ?? '—'} / {row.vectorScore?.toFixed(4) ?? '—'}
                                    </td>
                                    <td>
                                      {row.keywordRank ?? '—'} /{' '}
                                      {row.keywordScore?.toFixed(4) ?? '—'}
                                    </td>
                                    <td>{row.fusedScore.toFixed(5)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </details>
                      );
                    }
                    return null;
                  })}
                  {status === 'streaming' &&
                    message.role === 'assistant' &&
                    !message.parts.some((part) => part.type === 'text' && part.text.length > 0) && (
                      <p className="chat-loading">Searching your documents…</p>
                    )}
                </div>
              </article>
            ))
          )}
          {status === 'streaming' && messages.at(-1)?.role === 'user' && (
            <p className="chat-loading">Searching your documents…</p>
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
          <div ref={bottomRef} />
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
            <span>Answers are based on documents in this workspace.</span>
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
