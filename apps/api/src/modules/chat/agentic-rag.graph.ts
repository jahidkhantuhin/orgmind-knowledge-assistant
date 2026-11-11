import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { ChatCitation, RetrievalDebugChunk } from '@orgmind/shared';
import type { RetrievalResult } from './retrieval.service.js';

const AgentState = Annotation.Root({
  question: Annotation<string>(),
  organizationId: Annotation<string>(),
  aclTokens: Annotation<string[]>(),
  queries: stateValue<string[]>(() => []),
  iteration: stateValue<number>(() => 0),
  needsRetrieval: stateValue<boolean>(() => true),
  relevant: stateValue<boolean>(() => false),
  retrievals: stateValue<RetrievalResult[]>(() => []),
  answer: stateValue<string>(() => ''),
  grounded: stateValue<boolean>(() => false),
  inputTokens: stateValue<number>(() => 0),
  outputTokens: stateValue<number>(() => 0),
  estimatedCostUsd: stateValue<number>(() => 0),
});

function stateValue<T>(defaultValue: () => T) {
  return Annotation<T>({ value: (_current, update) => update, default: defaultValue });
}

export type AgentStep = {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'retrying' | 'skipped';
  detail?: string;
};

export type AgenticRetrieval = RetrievalResult;
export type AgenticRunResult = {
  answer: string;
  citations: ChatCitation[];
  debug: RetrievalDebugChunk[];
  retrieval: { embedding: number; search: number; rerank: number; total: number };
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type AgenticDependencies = {
  retrieve: (
    _query: string,
    _organizationId: string,
    _aclTokens: string[],
  ) => Promise<AgenticRetrieval>;
  route: (_question: string) => Promise<{
    needsRetrieval: boolean;
    queries: string[];
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  }>;
  grade: (
    _question: string,
    _passages: string[],
  ) => Promise<{
    relevant: boolean;
    expandedQueries: string[];
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  }>;
  answer: (
    _question: string,
    _passages: string[],
  ) => Promise<{
    text: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  }>;
  verify: (
    _question: string,
    _passages: string[],
    _answer: string,
  ) => Promise<{
    grounded: boolean;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  }>;
  maxIterations: number;
  maxCostUsd: number;
  emit?: (_step: AgentStep) => void;
};

function addUsage(
  state: typeof AgentState.State,
  result: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number },
) {
  return {
    inputTokens: state.inputTokens + (result.inputTokens ?? 0),
    outputTokens: state.outputTokens + (result.outputTokens ?? 0),
    estimatedCostUsd: state.estimatedCostUsd + (result.estimatedCostUsd ?? 0),
  };
}

function passageTexts(retrievals: RetrievalResult[]) {
  const seen = new Set<string>();
  return retrievals
    .flatMap((item) => item.citations)
    .filter((citation) => {
      if (seen.has(citation.chunkId)) return false;
      seen.add(citation.chunkId);
      return true;
    })
    .map((citation, index) => `[S${index + 1}] ${citation.documentName}\n${citation.passage}`);
}

export function createAgenticRagGraph(dependencies: AgenticDependencies) {
  const emit = (id: string, label: string, status: AgentStep['status'], detail?: string) =>
    dependencies.emit?.({ id, label, status, ...(detail ? { detail } : {}) });

  const router = async (state: typeof AgentState.State) => {
    if (state.estimatedCostUsd >= dependencies.maxCostUsd)
      return { needsRetrieval: true, queries: [state.question] };
    emit('route', 'Understanding your question', 'running');
    const result = await dependencies.route(state.question);
    emit('route', 'Understanding your question', 'completed');
    if (!result.needsRetrieval)
      emit(
        'retrieve',
        'Searching workspace documents',
        'skipped',
        'This question does not need document search.',
      );
    return {
      needsRetrieval: result.needsRetrieval,
      queries: result.queries.slice(0, 2),
      ...addUsage(state, result),
    };
  };

  const retrieve = async (state: typeof AgentState.State) => {
    if (state.iteration > 0) emit('expand', 'Search expanded', 'completed');
    emit(
      'retrieve',
      'Searching workspace documents',
      'running',
      `Search pass ${state.iteration + 1}`,
    );
    const batch = await Promise.all(
      (state.queries.length ? state.queries : [state.question]).map((query) =>
        dependencies.retrieve(query, state.organizationId, state.aclTokens),
      ),
    );
    emit(
      'retrieve',
      'Searching workspace documents',
      'completed',
      `${batch.reduce((count, item) => count + item.citations.length, 0)} passages found`,
    );
    return { retrievals: [...state.retrievals, ...batch], iteration: state.iteration + 1 };
  };

  const grade = async (state: typeof AgentState.State) => {
    if (state.estimatedCostUsd >= dependencies.maxCostUsd) return { relevant: false, queries: [] };
    emit('grade', 'Checking passage relevance', 'running');
    const result = await dependencies.grade(state.question, passageTexts(state.retrievals));
    emit(
      'grade',
      'Checking passage relevance',
      'completed',
      result.relevant ? 'Relevant evidence found' : 'No strong evidence found',
    );
    return {
      relevant: result.relevant,
      queries: result.expandedQueries.slice(0, 2),
      ...addUsage(state, result),
    };
  };

  const expand = async (_state: typeof AgentState.State) => {
    emit('expand', 'Expanding the search', 'retrying', 'Trying a broader query');
    return {};
  };

  const draft = async (state: typeof AgentState.State) => {
    if (state.needsRetrieval && !state.relevant) {
      emit('draft', 'Drafting a grounded answer', 'skipped', 'No relevant evidence was found.');
      return { answer: '' };
    }
    if (state.estimatedCostUsd >= dependencies.maxCostUsd) {
      emit(
        'draft',
        'Drafting a grounded answer',
        'skipped',
        'The configured model-cost budget was reached.',
      );
      return { answer: '' };
    }
    emit('draft', 'Drafting a grounded answer', 'running');
    const result = await dependencies.answer(
      state.question,
      state.needsRetrieval ? passageTexts(state.retrievals) : [],
    );
    emit('draft', 'Drafting a grounded answer', 'completed');
    return { answer: result.text, ...addUsage(state, result) };
  };

  const verify = async (state: typeof AgentState.State) => {
    if (state.estimatedCostUsd >= dependencies.maxCostUsd) {
      emit(
        'verify',
        'Verifying answer support',
        'skipped',
        'The configured model-cost budget was reached.',
      );
      return { grounded: false };
    }
    if (!state.needsRetrieval || !state.relevant) {
      emit(
        'verify',
        'Verifying answer support',
        'skipped',
        'No document-grounded answer was produced.',
      );
      return { grounded: false };
    }
    emit('verify', 'Verifying answer support', 'running');
    const result = await dependencies.verify(
      state.question,
      passageTexts(state.retrievals),
      state.answer,
    );
    emit(
      'verify',
      'Verifying answer support',
      'completed',
      result.grounded
        ? 'Answer is supported by retrieved passages'
        : 'Evidence did not support the draft',
    );
    return { grounded: result.grounded, ...addUsage(state, result) };
  };

  const graph = new StateGraph(AgentState)
    .addNode('route', router)
    .addNode('retrieve', retrieve)
    .addNode('grade', grade)
    .addNode('expand', expand)
    .addNode('draft', draft)
    .addNode('verify', verify)
    .addEdge(START, 'route')
    .addConditionalEdges('route', (state) => (state.needsRetrieval ? 'retrieve' : 'draft'), [
      'retrieve',
      'draft',
    ])
    .addEdge('retrieve', 'grade')
    .addConditionalEdges(
      'grade',
      (state) =>
        state.relevant ||
        state.iteration >= dependencies.maxIterations ||
        state.estimatedCostUsd >= dependencies.maxCostUsd
          ? 'draft'
          : 'expand',
      ['draft', 'expand'],
    )
    .addEdge('expand', 'retrieve')
    .addEdge('draft', 'verify')
    .addEdge('verify', END)
    .compile();

  return {
    async run(input: {
      question: string;
      organizationId: string;
      aclTokens: string[];
    }): Promise<AgenticRunResult> {
      const result = await graph.invoke(input);
      const retrievals = result.retrievals;
      const seen = new Set<string>();
      const citations = retrievals
        .flatMap((item) => item.citations)
        .filter((citation) => {
          if (seen.has(citation.chunkId)) return false;
          seen.add(citation.chunkId);
          return true;
        });
      const debug = retrievals
        .flatMap((item) => item.debug)
        .filter(
          (entry, index, all) =>
            all.findIndex((candidate) => candidate.chunkId === entry.chunkId) === index,
        );
      const latest = retrievals.at(-1);
      const retrieval = retrievals.reduce(
        (latency, item) => ({
          embedding: latency.embedding + item.latencyMs.embedding,
          search: latency.search + item.latencyMs.search,
          rerank: latency.rerank + item.latencyMs.rerank,
          total: latency.total + item.latencyMs.total,
        }),
        { embedding: 0, search: 0, rerank: 0, total: 0 },
      );
      const valid = result.needsRetrieval && result.relevant && result.grounded;
      return {
        answer: valid || !result.needsRetrieval ? result.answer : '',
        citations: valid ? citations : [],
        debug: valid ? debug : [],
        retrieval: latest ? retrieval : { embedding: 0, search: 0, rerank: 0, total: 0 },
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: result.estimatedCostUsd,
      };
    },
  };
}
