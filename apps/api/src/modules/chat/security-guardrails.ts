import type { ChatCitation, SecurityNotice } from '@orgmind/shared';
import type { StreamTextTransform, ToolSet } from 'ai';
import type { RetrievalResult } from './retrieval.service.js';

const injectionPatterns = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+instructions?/iu,
  /disregard.{0,60}(?:instructions?|safety|policy|rules)/iu,
  /(?:reveal|print|repeat|show|output).{0,60}(?:system|developer|hidden)\s+prompt/iu,
  /you\s+are\s+now\s+(?:an?\s+)?(?:unrestricted|unfiltered|jailbroken)/iu,
  /(?:exfiltrate|send|upload).{0,60}(?:secrets?|credentials?|api\s+keys?)/iu,
];

const piiPatterns = [
  /\b(?:\d[ -]?){13,19}\b/gu,
  /\b\d{3}-\d{2}-\d{4}\b/gu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/gu,
];

export function looksLikePromptInjection(value: string): boolean {
  return injectionPatterns.some((pattern) => pattern.test(value));
}

export function redactPii(value: string): { text: string; count: number } {
  let text = value;
  let count = 0;
  for (const pattern of piiPatterns) {
    text = text.replace(pattern, () => {
      count += 1;
      return '[REDACTED]';
    });
  }
  return { text, count };
}

function passageContext(citations: ChatCitation[]): string {
  return citations
    .map(
      (citation, index) =>
        `[S${index + 1}] ${citation.documentName}${citation.headingPath.length ? ` — ${citation.headingPath.join(' / ')}` : ''}\n${citation.passage}`,
    )
    .join('\n\n');
}

export function secureRetrievedEvidence(
  result: RetrievalResult,
  piiRedactionEnabled: boolean,
): {
  result: RetrievalResult;
  blockedPassages: number;
  redactedValues: number;
} {
  let blockedPassages = 0;
  let redactedValues = 0;
  const blockedChunkIds = new Set<string>();
  const citations = result.citations.flatMap((citation) => {
    if (looksLikePromptInjection(citation.passage)) {
      blockedPassages += 1;
      blockedChunkIds.add(citation.chunkId);
      return [];
    }
    if (!piiRedactionEnabled) return [citation];
    const redacted = redactPii(citation.passage);
    redactedValues += redacted.count;
    return [redacted.count ? { ...citation, passage: redacted.text } : citation];
  });
  const debug = result.debug.filter((entry) => !blockedChunkIds.has(entry.chunkId));
  return {
    result: { ...result, citations, debug, context: passageContext(citations) },
    blockedPassages,
    redactedValues,
  };
}

export function securityNoticeFor(
  blockedPassages: number,
  redactedValues: number,
): SecurityNotice | undefined {
  if (blockedPassages > 0) {
    return {
      kind: 'blocked',
      message:
        'Potentially unsafe source instructions were excluded before the answer was generated.',
    };
  }
  if (redactedValues > 0) {
    return {
      kind: 'redacted',
      message: 'Sensitive-looking details were masked before they were sent to the assistant.',
    };
  }
  return undefined;
}

export function secureAssistantAnswer(
  answer: string,
  piiRedactionEnabled: boolean,
): { answer: string; notice?: SecurityNotice } {
  if (!piiRedactionEnabled) return { answer };
  const redacted = redactPii(answer);
  return redacted.count > 0
    ? {
        answer: redacted.text,
        notice: {
          kind: 'redacted',
          message: 'Sensitive-looking details were masked from this answer.',
        },
      }
    : { answer };
}

const STREAM_REDACTION_HOLDBACK = 260;

export function createPiiRedactionTransform(onRedaction: () => void): StreamTextTransform<ToolSet> {
  return () => {
    const bufferedById = new Map<string, string>();
    return new TransformStream({
      transform(part, controller) {
        if (part.type === 'text-delta') {
          const combined = (bufferedById.get(part.id) ?? '') + part.text;
          const safeBoundary = combined.length - STREAM_REDACTION_HOLDBACK;
          let cutAt = safeBoundary > 0 ? combined.lastIndexOf(' ', safeBoundary) : -1;
          if (cutAt < 0 && safeBoundary > 0) cutAt = combined.lastIndexOf('\n', safeBoundary);
          if (cutAt > 0) {
            const safe = redactPii(combined.slice(0, cutAt + 1));
            if (safe.count > 0) onRedaction();
            if (safe.text) controller.enqueue({ ...part, text: safe.text });
            bufferedById.set(part.id, combined.slice(cutAt + 1));
          } else {
            bufferedById.set(part.id, combined);
          }
          return;
        }
        if (part.type === 'text-end') {
          const buffered = bufferedById.get(part.id);
          if (buffered) {
            const safe = redactPii(buffered);
            if (safe.count > 0) onRedaction();
            if (safe.text) controller.enqueue({ type: 'text-delta', id: part.id, text: safe.text });
            bufferedById.delete(part.id);
          }
        }
        controller.enqueue(part);
      },
      flush(controller) {
        for (const [id, buffered] of bufferedById) {
          const safe = redactPii(buffered);
          if (safe.count > 0) onRedaction();
          if (safe.text) controller.enqueue({ type: 'text-delta', id, text: safe.text });
        }
      },
    });
  };
}
