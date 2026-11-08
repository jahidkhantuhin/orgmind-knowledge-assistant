# OrgMind

OrgMind is a company-internal knowledge assistant built around agentic retrieval-augmented generation (RAG). It is designed to help teams find trustworthy answers grounded in the information their organization already owns.

## Step 1: Monorepo foundation

This first foundation includes a pnpm TypeScript workspace, an Express 5 API with dependency health checks, a Next.js dashboard shell, local MongoDB Atlas Local and Redis services, and CI quality checks. The API reports a degraded state until both data services are reachable.

## Step 2: Database, authentication, and RBAC

Added Better Auth email/password sessions backed by MongoDB, validated organizations and memberships, versioned index bootstrap, and an idempotent admin seed. Registration can create a new workspace, where the registrant becomes admin, or join a workspace through an email-bound invitation with its assigned role. Admin-only membership management is protected by API role checks.

## Step 3: Document upload and ingestion

The Knowledge base now accepts PDF, DOCX, Markdown, and TXT files. Documents are stored locally, queued through Redis, extracted to bounded plain text, and shown with processing status. Admins and members can upload and delete; viewers can browse. Set `UPLOAD_STORAGE_DIR`, `MAX_DOCUMENT_UPLOAD_BYTES`, or `MAX_DOCUMENT_TEXT_BYTES` in `.env` to adjust the local storage path and limits.

## Step 4: Chunking, embeddings, and vector storage

Parsed documents are split into overlapping, heading-aware chunks while keeping Markdown table rows together. Gemini embeddings are generated behind a provider interface in batches, normalized to the configured dimensions, and stored as BSON float32 vectors in the `chunks` collection. MongoDB Vector Search and text search indexes include organization, collection, document, and ACL filter fields. Open a document from Knowledge base to inspect its chunk previews or reprocess it. Set `GOOGLE_API_KEY` before uploading or reprocessing documents. The local MongoDB service uses the Atlas Local `preview` image to provide local Search and Vector Search; it is for development and testing.

**Embedding delay note:** A Gemini free-tier token-per-minute HTTP 429 was encountered during PDF ingestion. The provider retries rate-limit errors up to five times, waiting at least 65 seconds between retries for per-minute token limits; the BullMQ job can also retry up to three times. During these waits the document remains at “Embedding.” If the quota remains exhausted, processing eventually fails. Wait for the quota to reset or use an account with sufficient Gemini quota, then reprocess the document. The project does not change provider billing or quota.

**Development logging note:** Pino emits structured API logs. The optional Compose `app` profile runs the API and web app as containers so their logs can be listed, followed, or filtered with `docker compose logs`; local log storage is bounded to three 10 MB files per service.

## Step 5: Streaming, document-grounded chat

Open **Assistant** from the workspace to ask questions about processed documents. Each answer streams as it is generated; citations are shown only for sources referenced by the answer. Selecting a citation previews its passage and links to the source document. Conversations can be created, renamed, reopened, and deleted. History is private to the signed-in user within their organization.

The API uses Vercel AI SDK `ai@7.0.163` and Google provider `@ai-sdk/google@4.0.112`. It embeds each question using the existing Gemini query-embedding provider, then runs a MongoDB `$vectorSearch` filtered to the active organization and default collection. Up to `CHAT_TOP_K` relevant passages are supplied to the configured Google model. Results below `CHAT_MIN_RELEVANCE_SCORE` are excluded; when no eligible passage remains, the assistant returns a clear “I don't know” response. The model is instructed to use only the retrieved passages and cite factual claims. Recent conversation history is sent as context (up to 20 messages), while MongoDB retains and returns up to 200 messages per conversation.

Set `GOOGLE_API_KEY` in `.env` for both question embeddings and answer generation. `CHAT_MODEL` defaults to `gemini-3.5-flash-lite`, a current low-latency model. If your `.env` explicitly sets `CHAT_MODEL`, update it too. `CHAT_TOP_K` defaults to `5` (allowed range: 1–20); `CHAT_MIN_RELEVANCE_SCORE` defaults to `0.45` (allowed range: 0–1). The chat storage indexes are applied by `pnpm db:migrate`. The MongoDB Vector Search index must also be READY, and at least one document must be fully processed before document-grounded answers can be retrieved.

## Step 6: Hybrid retrieval

Chat retrieval can use MongoDB `$rankFusion` to combine semantic `$vectorSearch` results with full-text `$search` (BM25) results from the same `chunks` collection. Each search is filtered by the active organization and default collection. Reciprocal rank fusion combines each result's position, so vector and text scores do not need to share a scale. The assistant receives the fused top passages and continues to stream citations as before. In development, expand **Retrieval debug** under an answer to inspect each returned chunk's vector rank/score, keyword rank/score, and fused score.

`CHAT_RETRIEVAL_STRATEGY` selects `hybrid` (default) or `vector`; the vector option preserves the Step 5 retrieval path. `CHAT_VECTOR_SEARCH_WEIGHT` and `CHAT_KEYWORD_SEARCH_WEIGHT` default to `0.7` and `0.3`. Weights can be set to zero individually, but not both. MongoDB `$rankFusion` requires MongoDB 8.0 or later. Compose pins the verified `mongodb/mongodb-atlas-local:8.3.9` image, which includes local Search and Vector Search. After switching from the former `preview` image, pull and recreate the MongoDB container while preserving your data volumes:

```powershell
docker compose pull mongodb
docker compose up -d --wait mongodb
pnpm db:search-indexes
```

Pipeline-builder tests run with `pnpm --filter @orgmind/api test`. An optional integration test uses the MongoDB URI in `.env`, creates temporary Search and Vector Search indexes and fixture chunks, and skips if MongoDB is unavailable. The developer debug drawer is hidden in production builds.

## Step 7: Reranking and contextual retrieval

An admin can open **Settings → Members → Retrieval settings** to enable query rewriting and Cohere reranking for the workspace. Query rewriting uses the configured Google chat model; Cohere Rerank API v2 with `rerank-v5.0-fast` reorders the top `CHAT_RERANK_CANDIDATE_COUNT` search candidates before the top `CHAT_TOP_K` passages are used. The development Retrieval debug drawer shows fused rank and score alongside rerank rank and score, so the ordering change is visible. Cohere is called with the built-in `fetch`; no Cohere SDK is required. Reranking is unavailable until `COHERE_API_KEY` is set.

Optional contextual enrichment generates a short, source-grounded context sentence and prepends it to each chunk only for embedding. Original chunk text remains the displayed source. It is disabled by default to avoid added ingestion time and model usage; enable it with `CONTEXTUAL_ENRICHMENT_ENABLED=true`, then reprocess documents. A MongoDB cache keyed by organization, document, chunk content, and model avoids repeating generation during reprocessing; cache entries expire after `CONTEXT_ENRICHMENT_CACHE_TTL_DAYS` (default 180) and are removed when the document is deleted. Query rewriting is disabled by default and can be enabled from workspace settings.

```powershell
pnpm db:migrate
pnpm --filter @orgmind/api test
```

Set `COHERE_API_KEY` in `.env`, run migrations, and enable **Rerank search results** in admin settings to verify Cohere ordering. Enable **Rewrite search queries** there to verify query rewriting. To verify enrichment, set `CONTEXTUAL_ENRICHMENT_ENABLED=true`, reprocess a document, then reprocess it again and confirm the second pass uses cached contexts.

## Step 8: Permission-aware retrieval

Documents can be shared by workspace role, individual account, or team group. Workspace admins always retain access. In **Settings → Members**, an admin can add or remove workspace members, create a role-assigned invitation for a new account, create/rename/delete groups, and assign workspace members to groups. Removing the final admin is blocked; deleting a group removes its memberships so access granted only through that group is revoked. Invitation links are bound to the invited email, expire after seven days, and can be used once. Existing accounts should be added through **Add existing account**. When a person belongs to multiple workspaces, use the workspace selector in the sidebar to switch between them.

Registration offers two paths: create a new workspace with a case-insensitively unique company name, or join using an administrator invitation link/code. Joining does not create an extra personal workspace. Workspace names are normalized and protected by a unique MongoDB index; older duplicate names are retained while new duplicates are rejected.

In **Knowledge base**, set a folder name before upload. Admins can select **Share** on a document and apply its access to just that document or the entire folder. New uploads inherit the folder's permissions and include the uploader. A document-only permission change leaves the folder's default policy intact. Role, user, and group ACL tokens are copied to each chunk. Permission changes update document and chunk records in one MongoDB transaction. Older documents and chunks stay workspace-visible through migration `006-acl-backfill`; migration `008-document-collection-access` initializes their folder policies.

The API filters by organization and ACL inside both the MongoDB `$vectorSearch` leg and the `$search` leg of `$rankFusion`; the vector-only strategy also applies the ACL prefilter. The application does not retrieve unrestricted candidates and filter them afterward. Document listing, details, chunk previews, deletion, and reprocessing also check the caller's access. Conversation history and prior model context omit assistant answers whose cited documents the user can no longer access.

To try it locally:

```powershell
pnpm db:migrate
pnpm --filter @orgmind/api test
pnpm dev
```

To verify invitations, open **Settings → Members**, create an invitation for an email and role, then open the generated link in a private window and register with that exact email. The account joins the invited workspace with the selected role. Try the link a second time or with another email; it should be rejected. To verify workspace name uniqueness, attempt to register a new workspace using a name already in use; registration should ask for a different name or an invitation. The MongoDB hybrid retrieval integration test creates temporary indexes and skips when the configured MongoDB service is unavailable.

To verify member and group administration, add at least two workspace admins, then remove a non-admin from **Workspace members** and confirm they can no longer switch to or access that workspace. Try removing the last admin; the app should block it. Under **Manage groups**, rename a group and verify its folder sharing remains attached to the same group, then delete a test group and confirm its members lose access that was granted only through that group.

For document access, create a team group and assign the invited account to it. Upload a test document into a folder such as `people-ops`, select **Share**, choose **Entire folder**, select the group, and click **Save access**. Sign in as that member and ask a question answered by the document. Remove the account from the group and retry; the document should no longer appear in its Knowledge base list or in retrieved citations.

## Quick start

Requirements: Node.js 22.13+, pnpm 11.28+, and Docker Compose.

```sh
docker compose up -d --wait
pnpm install
pnpm db:migrate
pnpm db:search-indexes
pnpm db:seed
pnpm dev
```

If you do not already have a local `.env` file, copy `.env.example` to `.env` before starting the services. Keep your local `.env` values when updating the example.

Open [http://localhost:3000](http://localhost:3000). The API status badge should show “API operational” after MongoDB and Redis are healthy. API health is available at [http://localhost:4000/health](http://localhost:4000/health).

### View development logs in Docker Compose

The default `pnpm dev` command runs the API and web app on the host, so Docker Compose cannot display those application logs. To run the apps in Compose instead, use the optional `app` profile (do not run `pnpm dev` at the same time because both use ports 3000 and 4000):

```powershell
docker compose --profile app up -d --build --wait
docker compose --profile app logs --follow --tail=100 --no-log-prefix api
```

Filter recent API warning/error logs or embedding-related messages in PowerShell:

```powershell
docker compose --profile app logs --since=1h --no-log-prefix api | Select-String '"level":(40|50)'
docker compose --profile app logs --follow --tail=200 --no-log-prefix api | Select-String '429|quota|embedding'
```

Use `web`, `mongodb`, or `redis` in place of `api` to view another service. Compose keeps bounded local logs (up to three 10 MB files per service). API logs remain structured Pino JSON, and no extra logging library is needed. Stop the Compose development stack with `docker compose --profile app down`; named data volumes are preserved.

Open **Knowledge base** in the workspace navigation to add documents. Local uploads are stored under the API process working directory at `.data/uploads` by default and are not committed. Add a Gemini API key to `.env` before uploading, then open a document to see its chunks and reprocess it. Open **Assistant** to query the processed material and inspect the citations returned with answers.

## Workspace

- `apps/web` — Next.js App Router interface with Tailwind CSS and a shadcn/ui-ready component setup.
- `apps/api` — Express 5 service with validated environment configuration, logging, security middleware, health checks, and centralized errors.
- `packages/shared` — shared Zod schemas and API contract types.

The seeded local account uses `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` from `.env`. Change the sample password before sharing a development environment.

## Quality checks

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The authentication integration test uses the separate `TEST_MONGODB_DATABASE` database. Run it with Docker services available. The `db:search-indexes` command creates the version-controlled Search index definitions and waits until both are queryable; rerun it after changing the embedding dimensions.

## Author

Jahid Khan Tuhin, Full Stack JavaScript Engineer
