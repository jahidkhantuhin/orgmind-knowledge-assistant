# OrgMind

OrgMind is a company-internal knowledge assistant built around agentic retrieval-augmented generation (RAG). It is designed to help teams find trustworthy answers grounded in the information their organization already owns.

## Step 1: Monorepo foundation

This first foundation includes a pnpm TypeScript workspace, an Express 5 API with dependency health checks, a Next.js dashboard shell, local MongoDB Atlas Local and Redis services, and CI quality checks. The API reports a degraded state until both data services are reachable.

## Step 2: Database, authentication, and RBAC

Added Better Auth email/password sessions backed by MongoDB, validated organizations and memberships, versioned index bootstrap, and an idempotent admin seed. The first registration creates an organization and an admin membership. Admin-only member listing is protected by API role checks and the Next.js server page.

## Step 3: Document upload and ingestion

The Knowledge base now accepts PDF, DOCX, Markdown, and TXT files. Documents are stored locally, queued through Redis, extracted to bounded plain text, and shown with processing status. Admins and members can upload and delete; viewers can browse. Set `UPLOAD_STORAGE_DIR`, `MAX_DOCUMENT_UPLOAD_BYTES`, or `MAX_DOCUMENT_TEXT_BYTES` in `.env` to adjust the local storage path and limits.

## Step 4: Chunking, embeddings, and vector storage

Parsed documents are split into overlapping, heading-aware chunks while keeping Markdown table rows together. Gemini embeddings are generated behind a provider interface in batches, normalized to the configured dimensions, and stored as BSON float32 vectors in the `chunks` collection. MongoDB Vector Search and text search indexes include organization, collection, document, and ACL filter fields. Open a document from Knowledge base to inspect its chunk previews or reprocess it. Set `GOOGLE_API_KEY` before uploading or reprocessing documents. The local MongoDB service uses the Atlas Local `preview` image to provide local Search and Vector Search; it is for development and testing.

**Embedding delay note:** A Gemini free-tier token-per-minute HTTP 429 was encountered during PDF ingestion. The provider retries rate-limit errors up to five times, waiting at least 65 seconds between retries for per-minute token limits; the BullMQ job can also retry up to three times. During these waits the document remains at “Embedding.” If the quota remains exhausted, processing eventually fails. Wait for the quota to reset or use an account with sufficient Gemini quota, then reprocess the document. The project does not change provider billing or quota.

**Development logging note:** Pino emits structured API logs. The optional Compose `app` profile runs the API and web app as containers so their logs can be listed, followed, or filtered with `docker compose logs`; local log storage is bounded to three 10 MB files per service.

## Step 5: Streaming, document-grounded chat

Open **Assistant** from the workspace to ask questions about processed documents. Each answer streams as it is generated and includes source citations; selecting a citation previews its passage and links to the source document. Conversations can be created, renamed, reopened, and deleted. History is private to the signed-in user within their organization.

The API uses Vercel AI SDK `ai@7.0.163` and Google provider `@ai-sdk/google@4.0.112`. It embeds each question using the existing Gemini query-embedding provider, then runs a MongoDB `$vectorSearch` filtered to the active organization and default collection. Up to `CHAT_TOP_K` relevant passages are supplied to the configured Google model. Results below `CHAT_MIN_RELEVANCE_SCORE` are excluded; when no eligible passage remains, the assistant returns a clear “I don't know” response. The model is instructed to use only the retrieved passages and cite factual claims. Recent conversation history is sent as context (up to 20 messages), while MongoDB retains and returns up to 200 messages per conversation.

Set `GOOGLE_API_KEY` in `.env` for both question embeddings and answer generation. `CHAT_MODEL` defaults to `gemini-3.5-flash-lite`, a current low-latency model. If your `.env` explicitly sets `CHAT_MODEL`, update it too. `CHAT_TOP_K` defaults to `5` (allowed range: 1–20); `CHAT_MIN_RELEVANCE_SCORE` defaults to `0.45` (allowed range: 0–1). The chat storage indexes are applied by `pnpm db:migrate`. The MongoDB Vector Search index must also be READY, and at least one document must be fully processed before document-grounded answers can be retrieved.

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
