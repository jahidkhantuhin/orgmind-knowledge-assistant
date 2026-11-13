# Contributing

Thanks for helping improve OrgMind. Keep changes focused, use TypeScript strict mode, and add or update tests for behavior changes. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` before opening a pull request. Husky runs lint, typecheck, and unit/integration tests sequentially before a normal Git push and blocks at the first failure. Start Docker services so MongoDB-dependent integration tests run instead of skipping.

For browser coverage, stop any running `pnpm dev` process, follow the isolated test-database setup in the Step 16 README section, then run `pnpm test:e2e`. Playwright starts its own API in test mode and its own web server. This flow needs Docker Compose, MongoDB Atlas Local Search/Vector Search indexes, Redis, and a configured `GOOGLE_API_KEY`; it makes real embedding and chat requests. Do not use a production database for local end-to-end tests.

GitHub Actions is the shared CI check. Its Playwright job is optional and can be enabled with repository variable `RUN_PLAYWRIGHT_E2E=true` and secret `GOOGLE_API_KEY`.

## Maintainer

Jahid Khan Tuhin, Full Stack JavaScript Engineer
