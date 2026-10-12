# Payroll Automation Platform — source package

This archive contains the complete current source for the React client, typed server actions, database schema, and all Drizzle migrations.

## Open and edit

1. Extract the archive and open the extracted folder in Google AI Studio or another TypeScript editor.
2. Install Bun 1.3.x (the Muse artifact SDK's canonical bundler uses Bun).
3. Run `bun install`.
4. Run `bun run typecheck` to verify both client and server TypeScript. The portable package suppresses only two inherited unused-local diagnostics; strict type checking remains enabled.

The Muse SDK used by this project is vendored at `vendor/space-sdk.tgz`; `package.json` points to that relative file, so dependency installation does not depend on an internal machine path.

## Important runtime note

The application is a server-backed Muse web artifact. Its UI source can be edited in any standard TypeScript environment, but its typed actions, database context, authentication, blob storage, and production build/publish pipeline run on the Muse artifact platform. Use the Muse artifact builder to build and publish the full application. Generated bundles, local databases, caches, and audit artifacts are intentionally excluded from this archive.

## Source layout

- `client/src/` — React UI and styles
- `server/src/` — typed actions, payroll calculation kernel, and schema
- `drizzle/` — forward SQL migrations and migration journal
- `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.base.json` — dependencies and build/typecheck configuration
- `space.json` — Muse artifact metadata
