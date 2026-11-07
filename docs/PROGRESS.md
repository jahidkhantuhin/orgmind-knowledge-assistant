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
- Added unit coverage for the hybrid aggregation pipeline and an opt-in local MongoDB integration test that creates temporary indexes and fixture data. The integration test skips when MongoDB cannot be reached.
- Configure `CHAT_RETRIEVAL_STRATEGY`, `CHAT_VECTOR_SEARCH_WEIGHT`, and `CHAT_KEYWORD_SEARCH_WEIGHT` in `.env`. See the README for image upgrade commands and verification steps.
