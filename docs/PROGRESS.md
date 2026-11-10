# Project progress

## Step 1: Monorepo foundation

- Added a strict TypeScript pnpm workspace with shared Zod contracts and common formatting/lint tooling.
- Added an Express 5 API with environment validation, request IDs, pino logging, security middleware, MongoDB/Redis health checks, validation middleware, centralized errors, and graceful shutdown.
- Added a responsive Next.js dashboard shell with dark mode and a live API status badge.
- Added local MongoDB Atlas Local and Redis Compose services, environment example, and GitHub Actions CI.
- Added a Supertest health endpoint test.

## Step 2: Database, authentication, and RBAC

- Added Better Auth 1.7.18 with the official MongoDB adapter, email/password sessions, a trusted frontend origin, and cookie forwarding through Express.
- Added validated `users`, `organizations`, and `memberships` repositories, an idempotent versioned index runner, and an admin seed command.
- New registrations create a private workspace and an `admin` membership. `admin`, `member`, and `viewer` are modeled as shared role values; member listing requires admin access in the API.
- Added login/register forms, protected workspace pages, a sign-out control, and an admin-only Members settings page.
- Added auth flow integration coverage and RBAC unit tests; the auth flow test skips when the test MongoDB is not available.

## Step 3: Document upload and ingestion

- Added organization-scoped document records and indexes, role-checked upload/list/delete API routes, and local disk storage with configurable file and extracted-text size limits.
- Added a Redis-backed BullMQ ingestion worker with retries and status transitions. PDF, DOCX, Markdown, and TXT files are parsed to bounded plain text; extraction failures are visible on each document.
- Added the Knowledge base page with upload, processing status, and delete actions. Viewers can browse status; members and admins can upload and delete.
- Added parser and worker tests with PDF, DOCX, Markdown, and TXT fixtures. Local uploads are ignored by Git.

## Step 4: Chunking, embeddings, and vector storage

- Added a structure-aware chunker with heading paths, intact Markdown table rows, configurable size, and overlap.
- Added an embedding provider interface and Google Gemini implementation with sequential batches, retrieval task types, exponential retries for rate limits/transient failures, vector validation, and normalization.
- Added `chunks` records with tenant, collection, ACL, document, position, and heading metadata. Embeddings are stored as BSON float32 vectors. Chunk replacement and document deletion use MongoDB transactions.
- Extended the worker with chunking and embedding statuses, atomic chunk replacement, and retryable reprocessing. Added document detail and reprocess routes plus a chunk preview page.
- Added version-controlled MongoDB vector and text Search index definitions, filter fields for `orgId`, `collectionId`, `acl`, and `documentId`, and a command that waits for both indexes to become READY.
- Updated local MongoDB to Atlas Local `preview`, which bundles MongoDB Search and Vector Search, and added mocked chunker/provider tests.
- **Delay encountered:** Gemini returned HTTP 429 after the free-tier embedding token-per-minute quota was exceeded. The UI stays on “Embedding” while the provider backs off. The provider already retries transient and rate-limit errors up to five times, waiting at least 65 seconds for per-minute token limits; BullMQ can retry the ingestion job up to three times. If the quota remains exhausted, processing eventually fails. **Workaround:** wait for quota to reset or use a Gemini plan with sufficient quota, then reprocess the document. No quota increase or billing change was made in the project.
- **Local log workflow:** Added an optional Compose `app` profile for running the API and web app as containers. Pino continues to emit structured API logs; `docker compose logs` can follow or filter them. The Compose local log driver retains up to three 10 MB files per service. The existing host-based `pnpm dev` workflow remains available; see the README for Windows PowerShell commands.

## Step 5: Streaming, document-grounded chat

- Added an authenticated assistant page with conversation history, new/rename/delete actions, streamed answers, and responsive dark-mode styling.
- Added MongoDB conversation and message collections with user/organization-scoped access and indexes. Each conversation can load up to 200 prior messages; recent context sent to the model is capped at 20 messages.
- Added organization-filtered MongoDB `$vectorSearch` retrieval using the existing Gemini query embedding provider. Retrieval returns up to `CHAT_TOP_K` passages; results below `CHAT_MIN_RELEVANCE_SCORE` are omitted, and no matching sources produces a fixed “I don't know” response.
- Added AI SDK `ai@7.0.163` and `@ai-sdk/google@4.0.112` model/UI streaming with citations filtered to sources referenced in each answer. Answers are stored after streaming completes, and citations open a source passage preview with a link to the document.
- Added retrieval tests covering organization-scoped document lookup, relevance filtering, citation formatting, and empty-result behavior.
- Configure `GOOGLE_API_KEY` and optionally `CHAT_MODEL`, `CHAT_TOP_K`, and `CHAT_MIN_RELEVANCE_SCORE` in `.env`. The default chat model is `gemini-3.5-flash-lite`.
- Updated the chat model default after Gemini 2.5 access was restricted for new projects and Gemini 3.8 Flash returned a temporary 503 high-demand error during verification. A minimal Vercel AI SDK generation request succeeded with Gemini 3.5 Flash-Lite. Streamed model errors now give a model-access/quota hint instead of the generic “An error occurred” message.
- To try it locally, run `pnpm db:migrate`, start the existing services, sign in, open **Assistant**, and ask about a processed document. Existing organization documents must have completed embedding and the MongoDB vector index must be READY.

## Step 6: Hybrid retrieval

- Added a retrieval strategy interface selected by `CHAT_RETRIEVAL_STRATEGY`, keeping the Step 5 vector-only path available and making MongoDB hybrid retrieval the default.
- Added MongoDB `$rankFusion` over organization-filtered `$vectorSearch` and BM25 `$search` pipelines. `CHAT_VECTOR_SEARCH_WEIGHT` and `CHAT_KEYWORD_SEARCH_WEIGHT` configure their relative contribution (defaults: `0.7` and `0.3`).
- Added per-result vector and keyword ranks/scores plus the fused score to development-only Retrieval debug details in each chat answer. Debug results are saved with assistant messages and loaded with conversation history.
- Pinned Atlas Local in Docker Compose to `mongodb-atlas-local:8.3.9`; MongoDB `$rankFusion` requires version 8.0 or later, and this image provides the Search and Vector Search services used by the existing indexes.
- Retrieval requires both MongoDB Search and Vector Search indexes to be READY. There is no automatic fallback to native MongoDB `$text` search or an external provider. `CHAT_RETRIEVAL_STRATEGY=vector` removes the keyword leg but still requires MongoDB Vector Search; `pnpm db:search-indexes` provisions and waits for the project indexes.
- Added unit coverage for the hybrid aggregation pipeline and an opt-in local MongoDB integration test that creates temporary indexes and fixture data. The integration test skips when MongoDB cannot be reached.
- Configure `CHAT_RETRIEVAL_STRATEGY`, `CHAT_VECTOR_SEARCH_WEIGHT`, and `CHAT_KEYWORD_SEARCH_WEIGHT` in `.env`. See the README for image upgrade commands and verification steps.

## Step 7: Reranking and contextual retrieval

- Added a reranker interface with a Cohere Rerank API v2 implementation (`rerank-v5.0-fast`) that reranks configured top-N hybrid or vector candidates and preserves graceful fallback to the original retrieval order on provider errors.
- Added a Gemini-backed query rewriting service with fallback to the original question. Workspace admins can enable reranking and query rewriting through **Settings → Members → Retrieval settings**; API routes enforce admin role checks and persist organization settings.
- Added optional contextual chunk enrichment before embedding. Generated sentences are cached per organization, document, chunk content, and model in MongoDB with TTL expiry and document-delete cleanup. It is disabled by default to avoid extra ingestion cost and latency.
- Extended development retrieval diagnostics with fused and rerank ranks/scores. Added mocked reranker tests and enrichment cache unit tests.
- Configure `COHERE_API_KEY`, `COHERE_RERANK_MODEL`, and `CHAT_RERANK_CANDIDATE_COUNT` for reranking. Set `CONTEXTUAL_ENRICHMENT_ENABLED=true` to enrich future ingestion or reprocessing jobs; see `.env.example` and README for defaults and verification.

## Step 8: Permission-aware retrieval

- Added role, direct-user, and team-group ACL grants to documents and their chunks. Existing documents and chunks are backfilled as workspace-visible by migration `006-acl-backfill`; admins always retain access.
- Applied organization and ACL prefilters inside both `$vectorSearch` and `$search` in hybrid retrieval, and inside vector-only retrieval. Document lists, details, chunk previews, upload-to-folder, delete, and reprocess operations also enforce document access.
- Filtered stored assistant messages and retrieval diagnostics against the current ACL before returning conversation history or sending prior assistant context to the model; revoked-source answers are omitted.
- Added folder IDs to document uploads, plus admin sharing for one document or every document in a folder. ACL updates to documents and their chunks run in a MongoDB transaction.
- Added independent folder access policies: newly uploaded files inherit the folder policy, while document-only sharing does not alter folder defaults. Existing folder policies are backfilled by migration `008-document-collection-access`.
- Added admin controls to add and remove workspace members, create and assign team groups, rename groups, and delete groups. The API prevents removing the final admin; group deletion clears its member assignments so access granted only through the group is revoked.
- Registration now offers explicit create-workspace or join-by-invitation paths. Creating a workspace makes the registrant its admin; joining with an invitation creates the account directly in the target workspace with the assigned role. Invites are email-bound, expire after seven days, and can be accepted once; admins share the link manually and no invitation email is sent.
- Follow-up member management updates added role editing and an in-place **Refresh** control that fetches members and pending invitations together. Group assignment IDs are included in member responses so assignments remain visible after reload.
- Follow-up invitation UX copies a new invite link immediately and provides **Recreate & copy** per pending invite; creating a replacement revokes the prior pending invite for that email. Accepted, revoked, replaced, or expired codes are rejected, and redeemed invites leave the pending list on manual refresh.
- The document access dialog opens with document-only scope and the document's current ACL selected. It shows the always-authorized Admin role first and fits narrow screens without horizontal scrolling.
- New workspace names are normalized and unique. Migration `009-unique-workspace-names` backfills existing organizations and preserves older duplicate names with legacy-specific keys; migration `010-workspace-invitations` creates invitation indexes.
- Added ACL pipeline tests for both hybrid legs, principal role/user/group tests, and an optional MongoDB integration test for user, group, and cross-organization filtering. The integration test skips when MongoDB is unavailable.
- No new environment variables. Run `pnpm db:migrate` before testing so the ACL backfill and team-group index are applied.

## Step 9: Evaluation harness

- Added `packages/evals` with a deterministic golden dataset, fictional handbook and IT policy fixtures, retrieval recall@K and MRR, LLM-judge groundedness and answer relevance, regression gates, and Markdown report formatting.
- Added `pnpm eval:seed` to add or refresh the evaluation documents in a selected dedicated workspace using the existing chunking and Gemini embedding pipeline.
- Added `pnpm eval` to compare vector-only, hybrid, and hybrid-plus-Cohere-reranking retrieval; it generates answers and judge scores with the configured Gemini chat model, writes JSON/Markdown reports under `packages/evals/reports/`, and stores each result in MongoDB `evalRuns`.
- Added migration `011-evaluation-runs` and an admin-only API endpoint plus **Evals** dashboard for viewing recent per-run metric comparisons. Starting runs is developer-operated through the CLI; the dashboard does not launch evaluations.
- Added configurable pacing between Gemini answer and judge requests (`EVAL_GEMINI_REQUEST_INTERVAL_MS`, default 7000 ms) to reduce free-tier 429 failures; the current golden run can make up to 18 Gemini requests, so it runs more slowly and still shares quota with other project traffic.
- Added a deterministic `pnpm eval:smoke` CI job with a recall regression threshold. It does not call Google or Cohere services.
- Added `EVAL_ORGANIZATION_ID`, `EVAL_MIN_RECALL_AT_K`, `EVAL_MAX_RERANK_RECALL_DROP`, and `EVAL_GEMINI_REQUEST_INTERVAL_MS` to `.env.example`; README documents setup, provider quota impact, reports, comparison strategies, metric meanings, and what the pass badge checks.
- Added a dedicated README explanation of the development Retrieval debug table: vector, keyword, fused, and rerank ranks/scores; how to interpret missing values; and why scores across search systems are not directly comparable.

## Step 10: Chat observability and workspace usage

- Added OpenTelemetry API, Node SDK, and OTLP/HTTP trace exporter instrumentation for chat request, embedding, MongoDB search, reranking, and generation stages. Trace exporting is optional and disabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is empty.
- Added an optional OpenTelemetry Collector to the Docker Compose `app` profile with an OTLP/HTTP receiver and debug trace exporter. The regular host-based app workflow can send to `http://localhost:4318` when the collector is started separately.
- Persisted assistant message model ID, input/output/total tokens, estimated cost, trace ID when available, and latency for retrieval, embedding, MongoDB Search, reranking, generation, and end-to-end response. Migration `012-message-observability` adds the workspace/date usage index; old messages remain valid and are not counted if they have no metadata.
- Added a development-only **Usage & performance** drawer per assistant answer and an admin-only **Usage** dashboard with 30-day workspace totals, daily request/token charts, estimated costs, and average stage timings.
- Documented how to read per-answer details: model, input/output tokens, estimated cost, and retrieval, embedding, MongoDB search, rerank, generation, and total latency. Clarified that the drawer describes one answer, while **Usage** aggregates the workspace's recorded answers over the last 30 days; its chart is daily activity and stage latencies are averages. Stage times may overlap and should not be summed; older answers without metadata are excluded. These metrics help locate slow processing stages and understand workspace-level usage trends.
- Added `OTEL_EXPORTER_OTLP_ENDPOINT`, `GEMINI_INPUT_COST_USD_PER_MILLION_TOKENS` (default `0.3`), and `GEMINI_OUTPUT_COST_USD_PER_MILLION_TOKENS` (default `2.5`) to `.env.example`. Estimated cost uses configured paid-list rates, not actual billing; free-tier or provider billed usage may differ. Documented local Collector setup in README.
