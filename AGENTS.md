# Repository Guidelines

## Engineering principles
- Follow first principles and design by contract.
- Use asserts to catch incorrect usage; do not guard-rail invalid input outside the contract.
- Optimize and reduce redundancies; split into functions if the same work repeats.
- Test, iterate, and test again.
- Second-pass verification that all code is needed; delete if possible.
- When refactoring, compare logic to ensure behavior is unchanged; if changed, explain why.
- Avoid aliases/duplicate helpers; prefer a single canonical API. Do not keep backward-compat shims unless strictly required, and remove them promptly after migration.
- Keep dependencies minimal; prefer built-in libraries and self-contained code.
- Document non-obvious decisions in code comments and PR descriptions.

## Project Structure & Module Organization
- app/: Vue 2 + Vite frontend (src/components, src/views, router.ts, public/ assets).
- server/: Node/Express + GraphQL (TypeGraphQL). Resolvers in server/gql; entry is server.ts, compiled to dist/server/.
- providers/: External integrations and provider agents (e.g., tesla/).
- shared/: Cross-cutting utilities, GraphQL types, and clients shared by server/providers.
- dist/: Build output (do not edit). deploy/: Dockerfiles and scripts.
- bench/: Regression bench (seeded server, GraphQL and screenshot snapshots); see Testing Guidelines.

## Architecture Overview
- Frontend: Vue 2 SPA served by Vite, calls the server via GraphQL HTTP and subscriptions (graphql-ws).
- Server: Express + Apollo Server (TypeGraphQL). Persistence via PostgreSQL (pg-promise) and business logic in server/ logic and gql resolvers.
- Worker: Long-running agency (dist/server/agency.js) handling telemetry, scheduling, and provider calls; authenticates with INTERNAL_SERVICE_TOKEN.
- Providers: Pluggable integrations in providers/ (e.g., tesla/) used by the worker and server services.
- Build: Babel compiles server/providers/shared; Vite builds app. Outputs to dist/.

## Build, Test, and Development Commands
- npm run dev: Start Vite dev server for the UI at localhost (frontend only).
- npm run build: Build server (Babel) and app (Vite) into dist/.
- npm run serve: Preview built app (static preview via Vite).
- npm run start:server: Run compiled server from dist/server/server.js.
- npm run start:worker: Start background worker (agency) that talks to the server.
- npm run lint: ESLint fix across app/, providers/, server/, shared/.
- Docker: docker-compose up --build server worker postgres (reads .env/.env.example).

## Coding Style & Naming Conventions
- Language: TypeScript (server/providers/shared) and Vue 2 SFCs.
- Indentation: 2 spaces; prefer eslint:recommended + plugin:vue rules.
- Filenames: kebab-case for .ts and .vue (e.g., vehicle-schedule.vue, db-interface.ts).
- Imports: Use path aliases (@app/*, @server/*, @shared/*, @providers/*).
- Run npm run lint before committing; keep console usage minimal and purposeful.

## Testing Guidelines
- npm test: Unit tests (node:test) next to the code (*.test.mjs). Add targeted tests for critical logic (pricing, scheduling, auth).
- npm run test:bench: Regression bench for every dependency update or UI/GraphQL change. It builds, starts a throwaway Postgres 15 and the server on a frozen clock, seeds it by replaying four simulated days through the real Logic (bench/seed.mjs), then compares the app's GraphQL responses and screenshots of the built app against bench/snapshots/, and drives the UI like a user (buttons, slider drags, the date-time picker) while checking each resulting server call through the app's client. UI specs run at phone (412 wide) and desktop (1280 wide) size with separate baselines under bench/snapshots/<project>/; bench/dialogs.spec.mjs checks dialog parts on their own (slider limits, date-time picker rules, charge control buttons). An interaction spec must leave the seeded state as it found it (each ends by asserting so); new UI flows get a spec of their own. Tesla's car renders are answered with bench/vehicle-placeholder.svg: never commit or cache Tesla's images. Needs Postgres 15 server binaries, faketime and Playwright's Chromium (npx playwright install --with-deps chromium). It is not part of CI: run it locally (agents included) before and after a change.
- A bench failure is a regression until proven otherwise: inspect the diff images in test-results/bench/ first. Only an intended change updates the baselines (npx playwright test -c bench --update-snapshots), and the PR shows the updated snapshots.

## Commit & Pull Request Guidelines
- Messages: Short, imperative mood (e.g., Fix charge schedule). Optional Conventional Commit prefix (fix:, docs:, feat:), as seen in history.
- PRs: Describe rationale and impact; link issues; include screenshots/GIFs for UI; note config changes (.env). Ensure build, lint, and local run (server + worker) succeed.

## Security & Configuration Tips
- Secrets: Never commit real tokens or credentials. Use .env (see .env.example) and follow INSTALL for PostgreSQL setup.
- First run: Server generates INTERNAL_SERVICE_TOKEN; store it in .env for the worker.
- Node: Use v18.20.x (Volta pinned). Keep dependencies updated via ncu-update.sh/npm-update.sh when relevant.
