---
status: pending
---

# 012: Remove deep-wiki serve Command and Server Directory

## Summary
Delete the deep-wiki serve command, the entire src/server/ directory, all server-related test files, and the SPA client build infrastructure from the deep-wiki package. Update CLI registration, type exports, build scripts, and documentation.

## Motivation
All server functionality has been moved to CoC. The deep-wiki package should only contain the generate/discover commands and their supporting modules.

## Changes

### Files to Create
- (none)

### Files to Modify

#### CLI & Type Registration
- **`packages/deep-wiki/src/cli.ts`** — Remove the entire `deep-wiki serve <wiki-dir>` command block (lines 288–338). This is a `program.command('serve')` chain with `.description()`, `.argument('<wiki-dir>')`, 11 `.option()` calls, and an `.action()` that lazy-imports `./commands/serve` and calls `executeServe()`.
- **`packages/deep-wiki/src/types.ts`** — Remove the `ServeCommandOptions` re-export at line 777 (`export type { ServeCommandOptions } from './server/types';`) and the surrounding comment block (lines 772–777).

#### Build Scripts & Package Manifest
- **`packages/deep-wiki/package.json`** — Remove the three server/SPA build scripts:
  - `"build:client"` — runs `node scripts/build-client.mjs`
  - `"build:copy-client"` — copies `src/server/spa/client/dist` to `dist/server/spa/client/dist`
  - Update `"build"` script to remove `npm run build:client` and `npm run build:copy-client` steps (keep `tsc && chmod +x dist/index.js`)
  - Remove `"dist/server/spa/client/dist"` from the `"files"` array (keep `dist/index.js` and `dist/index.js.map`)
  - No serve-specific dependencies to remove — server uses only Node.js built-ins (`http`, `fs`, `path`, `url`, `crypto`) plus `@plusplusoneplusplus/pipeline-core` which is shared.
- **`packages/deep-wiki/scripts/build-client.mjs`** — Delete (SPA client esbuild config, only used by server).

#### Documentation
- **`CLAUDE.md`** — Update deep-wiki section:
  - Remove `serve` from CLI commands list and descriptions
  - Remove "Debugging Serve Mode" subsection
  - Remove `server` from module listing
  - Remove `deep-wiki serve <wiki-dir>` command documentation
  - Update test file count (subtract server test files)
  - Add note that wiki serving is now in CoC (`coc wiki serve`)
- **`packages/deep-wiki/AGENTS.md`** — Update:
  - Remove `serve.ts` from `commands/` listing
  - Remove entire `server/` directory from package structure tree
  - Remove `### deep-wiki serve <wiki-dir>` CLI command section
  - Remove entire `## Debugging Serve Mode` section (Build and Start, Testing Ask AI, Testing Explore, Server Architecture, SSE Streaming Flow, Common Issues)
  - Remove server test files from testing section listing
  - Update test file count

### Files to Delete

#### Command File
- `packages/deep-wiki/src/commands/serve.ts` — 259 lines; `executeServe()`, `createAISendFunction()`, `openBrowser()`

#### Server Directory (entire `src/server/`)
- `packages/deep-wiki/src/server/index.ts` — Server creation, WikiServer/WikiServerOptions types, re-exports
- `packages/deep-wiki/src/server/router.ts` — HTTP request routing
- `packages/deep-wiki/src/server/api-handlers.ts` — REST API dispatch
- `packages/deep-wiki/src/server/ask-handler.ts` — AI Q&A with SSE streaming
- `packages/deep-wiki/src/server/explore-handler.ts` — Component deep-dive with SSE
- `packages/deep-wiki/src/server/context-builder.ts` — TF-IDF context retrieval
- `packages/deep-wiki/src/server/conversation-session-manager.ts` — Multi-turn session management
- `packages/deep-wiki/src/server/spa-template.ts` — SPA HTML/CSS/JS generation
- `packages/deep-wiki/src/server/wiki-data.ts` — Wiki data loading and querying
- `packages/deep-wiki/src/server/websocket.ts` — WebSocket server for watch mode
- `packages/deep-wiki/src/server/file-watcher.ts` — File system watcher
- `packages/deep-wiki/src/server/admin-handlers.ts` — Admin API handlers
- `packages/deep-wiki/src/server/generate-handler.ts` — Generate handler for server-triggered generation
- `packages/deep-wiki/src/server/types.ts` — `ServeCommandOptions` interface
- `packages/deep-wiki/src/server/spa/` — SPA subdirectory:
  - `packages/deep-wiki/src/server/spa/index.ts`
  - `packages/deep-wiki/src/server/spa/html-template.ts`
  - `packages/deep-wiki/src/server/spa/types.ts`
  - `packages/deep-wiki/src/server/spa/helpers.ts`
  - `packages/deep-wiki/src/server/spa/client/index.ts`
  - `packages/deep-wiki/src/server/spa/client/core.ts`
  - `packages/deep-wiki/src/server/spa/client/sidebar.ts`
  - `packages/deep-wiki/src/server/spa/client/toc.ts`
  - `packages/deep-wiki/src/server/spa/client/content.ts`
  - `packages/deep-wiki/src/server/spa/client/graph.ts`
  - `packages/deep-wiki/src/server/spa/client/theme.ts`
  - `packages/deep-wiki/src/server/spa/client/markdown.ts`
  - `packages/deep-wiki/src/server/spa/client/mermaid-zoom.ts`
  - `packages/deep-wiki/src/server/spa/client/ask-ai.ts`
  - `packages/deep-wiki/src/server/spa/client/admin.ts`
  - `packages/deep-wiki/src/server/spa/client/websocket.ts`
  - `packages/deep-wiki/src/server/spa/client/ask-widget.css`
  - `packages/deep-wiki/src/server/spa/client/styles.css`
  - `packages/deep-wiki/src/server/spa/client/globals.d.ts`
  - `packages/deep-wiki/src/server/spa/client/dist/bundle.js` (built artifact)
  - `packages/deep-wiki/src/server/spa/client/dist/bundle.css` (built artifact)

**Total: 14 server source files + 4 SPA source files + 7 SPA client source files + 2 SPA client dist files + 2 SPA client support files = ~35 files in `src/server/`**

#### Build Script
- `packages/deep-wiki/scripts/build-client.mjs` — esbuild config for SPA client bundling

#### Server Test Files (entire `test/server/`)
- `packages/deep-wiki/test/server/api-handlers.test.ts`
- `packages/deep-wiki/test/server/ask-handler.test.ts`
- `packages/deep-wiki/test/server/ask-api-integration.test.ts`
- `packages/deep-wiki/test/server/ask-panel.test.ts`
- `packages/deep-wiki/test/server/explore-handler.test.ts`
- `packages/deep-wiki/test/server/context-builder.test.ts`
- `packages/deep-wiki/test/server/conversation-session-manager.test.ts`
- `packages/deep-wiki/test/server/spa-template.test.ts`
- `packages/deep-wiki/test/server/websocket.test.ts`
- `packages/deep-wiki/test/server/wiki-data.test.ts`
- `packages/deep-wiki/test/server/file-watcher.test.ts`
- `packages/deep-wiki/test/server/index.test.ts`
- `packages/deep-wiki/test/server/admin-handlers.test.ts`
- `packages/deep-wiki/test/server/deep-dive-ui.test.ts`
- `packages/deep-wiki/test/server/dependency-graph.test.ts`
- `packages/deep-wiki/test/server/generate-handler.test.ts`
- `packages/deep-wiki/test/server/theme-support.test.ts`

#### Serve Command Test File
- `packages/deep-wiki/test/commands/serve.test.ts`

**Total deletions: ~35 src/server/ files + 1 command file + 1 build script + 18 test files = ~55 files**

## Implementation Notes

### How the Serve Command is Registered
In `cli.ts`, `createProgram()` builds a Commander `program` with chained `.command()` calls. The serve command (lines 288–338) is:
```typescript
program
    .command('serve')
    .description('Start an interactive server to explore the wiki')
    .argument('<wiki-dir>', 'Path to the wiki output directory')
    .option('-p, --port <number>', ...)
    // ... 10 more .option() calls
    .action(async (wikiDir, opts) => {
        const { executeServe } = await import('./commands/serve');
        // ...
    });
```
The lazy `import('./commands/serve')` means no top-level import to remove — just delete the entire `.command('serve')` chain block.

### Exports That Reference Server Modules
- `src/types.ts` line 777: `export type { ServeCommandOptions } from './server/types';` — must be removed.
- `src/server/index.ts` re-exports many types (`AskAIFunction`, `WikiServer`, `WikiServerOptions`, `ContextBuilder`, `WebSocketServer`, etc.) — all deleted with the directory.
- No other `src/` files import from `./server` (confirmed by grep). The main `src/index.ts` does NOT re-export server modules.

### Package.json Changes
- `"files"` array currently includes `"dist/server/spa/client/dist"` — remove this entry.
- `"build"` script is `"npm run build:client && tsc && npm run build:copy-client && chmod +x dist/index.js"` — simplify to `"tsc && chmod +x dist/index.js"`.
- Remove `"build:client"` and `"build:copy-client"` scripts entirely.
- The `"bin"` entry (`"deep-wiki": "./dist/index.js"`) stays unchanged.
- No dependencies to remove (server uses only Node.js built-ins + shared deps).

### Documentation Sections to Update
- **CLAUDE.md**: Deep Wiki section mentions `serve` in CLI commands, module listing, debugging instructions, and test descriptions.
- **AGENTS.md**: Contains full package structure tree, CLI command docs, debugging section, and test listing — all reference server extensively.

## Tests
- deep-wiki builds without server modules (`npm run build` in `packages/deep-wiki/`)
- deep-wiki `generate` still works
- deep-wiki `discover` still works
- Remaining deep-wiki tests pass (`npm run test:run` in `packages/deep-wiki/`)
- `deep-wiki --help` no longer lists `serve` command

## Acceptance Criteria
- [ ] `deep-wiki serve` command no longer exists
- [ ] `packages/deep-wiki/src/server/` directory deleted
- [ ] `packages/deep-wiki/src/commands/serve.ts` deleted
- [ ] `packages/deep-wiki/scripts/build-client.mjs` deleted
- [ ] Server test files removed from deep-wiki (`test/server/` + `test/commands/serve.test.ts`)
- [ ] `ServeCommandOptions` re-export removed from `types.ts`
- [ ] Build scripts cleaned up in `package.json` (no client build steps)
- [ ] `"files"` array cleaned up in `package.json` (no server SPA dist)
- [ ] deep-wiki package builds cleanly
- [ ] Remaining deep-wiki tests pass
- [ ] CLAUDE.md updated (serve references removed, CoC wiki docs noted)
- [ ] deep-wiki AGENTS.md updated (serve/server sections removed)

## Dependencies
- Depends on: 011 (server code and tests copied to CoC)
