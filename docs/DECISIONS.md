# Architecture decisions

Architecture decision records for OrgMind. **Author: Jahid Khan Tuhin, Full Stack JavaScript Engineer.**

## ADR 001 — Express 5 for the API

- **Status:** Accepted
- **Decision:** Keep the API on Express 5 with explicit route → controller → service → repository layers.
- **Why:** It is a familiar Node.js HTTP framework with native async route error forwarding and a small, inspectable middleware model. That keeps the application boundary understandable while the domain grows.
- **Trade-off:** OrgMind owns validation, dependency wiring, and API conventions instead of relying on a larger opinionated framework. Shared schemas and middleware enforce consistency.

## ADR 002 — MongoDB native hybrid search

- **Status:** Accepted
- **Decision:** Store source records, chunks, and vectors in MongoDB and combine `$vectorSearch` with `$search` using `$rankFusion`.
- **Why:** Search candidates can be filtered by organization and ACL inside each search leg, and application data and retrieval indexes share one operational database.
- **Trade-off:** Hybrid retrieval depends on MongoDB Search and Vector Search index availability; there is no separate `$text` or external-search fallback. Local development uses MongoDB Atlas Local 8.3.9.

## ADR 003 — Redis and BullMQ for ingestion

- **Status:** Accepted
- **Decision:** Process parsing, chunking, and embedding as retryable background jobs.
- **Why:** Upload requests return promptly and the UI can show processing progress while rate-limited embedding retries run.
- **Trade-off:** Redis is required for ingestion and rate limits; failed jobs need operator visibility and user-triggered reprocessing.

## ADR 004 — Provider interfaces with hosted and local options

- **Status:** Accepted
- **Decision:** Use Gemini as the default provider and keep Ollama implementations behind the existing chat and embedding interfaces.
- **Why:** The hosted path is easy to try, while local mode supports development without sending prompts or documents to a hosted model.
- **Trade-off:** Models can differ in speed, quality, token accounting, and compatibility. Embeddings created by different provider/model profiles are intentionally searched separately and may require reprocessing.

## ADR 005 — Simple and Agentic RAG are explicit choices

- **Status:** Accepted
- **Decision:** Preserve a bounded Simple path and make the multi-step Agentic path selectable.
- **Why:** Direct questions can use fewer model calls; more complex questions can benefit from query planning, relevance grading, bounded retries, and groundedness checks.
- **Trade-off:** Agentic work adds latency and model usage, so iteration and estimated-cost guards bound its work. Neither mode guarantees factual correctness; citations and user feedback remain review signals.
