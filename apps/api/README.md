# OrgMind API

Express 5 API for authentication, sessions, tenant membership, document upload and ingestion, chunking, embeddings, and health reporting. Better Auth uses the MongoDB adapter; organizations, memberships, documents, and chunks use repositories validated by shared Zod schemas.

## Local commands

From the repository root, start MongoDB Atlas Local and Redis with `docker compose up -d --wait`, then run `pnpm db:migrate`, `pnpm db:search-indexes`, `pnpm db:seed`, and `pnpm dev`.

Authentication routes are available at `/auth/register`, `/auth/login`, `/auth/logout`, and `/auth/me`. Registration accepts either a new unique workspace name or a valid invitation code; joining by invitation creates the account directly in that workspace with the invited role and does not create a personal workspace. `GET /auth/invitations/:code?email=...` verifies an email-bound invite. Better Auth's handler is mounted at `/api/auth/*`. Admins can list, create, and revoke invitations at `/organizations/:organizationId/invitations`; links expire after seven days and are single-use. Existing accounts can be added with a role using `POST /organizations/:organizationId/members` and removed with `DELETE /organizations/:organizationId/members/:userId`. The API refuses to remove the final workspace admin.

Team groups are managed through admin-only `GET` and `POST /organizations/:organizationId/groups`, `PATCH /organizations/:organizationId/groups/:groupId` to rename, and `DELETE /organizations/:organizationId/groups/:groupId` to delete. Deleting a group also clears its membership assignments, so group-based document access is revoked.

Documents can be listed at `GET /organizations/:organizationId/documents`, uploaded as a multipart `file` at `POST /organizations/:organizationId/documents`, inspected at `GET /organizations/:organizationId/documents/:documentId`, reprocessed at `POST /organizations/:organizationId/documents/:documentId/reingest`, and deleted at `DELETE /organizations/:organizationId/documents/:documentId`. Admins and members can upload, reprocess, and delete; organization viewers can list and inspect. Redis runs a BullMQ worker for PDF, DOCX, Markdown, and TXT extraction, structure-aware chunking, and embeddings.

Set `GOOGLE_API_KEY` in the root `.env` to enable Gemini embeddings. Defaults are `EMBEDDING_MODEL=gemini-embedding-001`, `EMBEDDING_DIMENSIONS=768`, `CHUNK_TARGET_CHARACTERS=1800`, `CHUNK_OVERLAP_CHARACTERS=250`, and `MAX_EMBEDDING_BATCH_SIZE=32`. Configure `UPLOAD_STORAGE_DIR` (default `./.data/uploads`), `MAX_DOCUMENT_UPLOAD_BYTES` (default 10 MiB), and `MAX_DOCUMENT_TEXT_BYTES` (default 3 MiB) as needed. Run `pnpm db:migrate` for collection indexes and `pnpm db:search-indexes` to create the version-controlled vector/text indexes and wait for READY.

## Maintainer

Jahid Khan Tuhin, Full Stack JavaScript Engineer
