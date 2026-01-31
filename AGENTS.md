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
- No formal test suite configured yet. For substantial changes, add targeted unit tests near code (e.g., server/__tests__) and keep coverage for critical logic (pricing, scheduling, auth) high. Ensure lint passes and build succeeds.

## Commit & Pull Request Guidelines
- Messages: Short, imperative mood (e.g., Fix charge schedule). Optional Conventional Commit prefix (fix:, docs:, feat:), as seen in history.
- PRs: Describe rationale and impact; link issues; include screenshots/GIFs for UI; note config changes (.env). Ensure build, lint, and local run (server + worker) succeed.

## Security & Configuration Tips
- Secrets: Never commit real tokens or credentials. Use .env (see .env.example) and follow INSTALL for PostgreSQL setup.
- First run: Server generates INTERNAL_SERVICE_TOKEN; store it in .env for the worker.
- Node: Use v18.20.x (Volta pinned). Keep dependencies updated via ncu-update.sh/npm-update.sh when relevant.
