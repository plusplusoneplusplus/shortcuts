# Monorepo Layout, Build, and Release

The repository is an npm workspaces monorepo for published Node packages. This file documents the cross-package contract, build/test commands, package management, and conventions enforced across the whole tree. Load it when planning multi-package changes, debugging build/release issues, or wiring new conventions.

## Products & Shared Packages

| Product | Location | Runtime | Description |
|---------|----------|---------|-------------|
| **CoC CLI** | `packages/coc/` | Node.js | CLI for executing YAML-based AI workflows (`coc run|validate|list|serve|wipe-data`) |
| **CoC Container** | `packages/coccontainer/` | Node.js | Container-oriented CoC server package with messaging integrations and service entry points |
| **CoC Client** | `packages/coc-client/` | Node.js/browser | Framework-free TypeScript client for CoC REST and realtime APIs |
| **Deep Wiki** | `packages/deep-wiki/` | Node.js | CLI that auto-generates comprehensive wikis for codebases (`deep-wiki seeds|discover|generate|theme|init`) |

| Shared Package | Location | Description |
|----------------|----------|-------------|
| **coc-workflow** | `packages/coc-workflow/` | Pure DAG workflow compiler/executor plus portable Ralph orchestration contracts/helpers, workflow types, validation, scheduling, node executors, result adapter, and legacy pipeline YAML compatibility types |
| **forge** | `packages/forge/` | Core AI utilities and compatibility surface: imports AI SDK from `coc-agent-sdk`, task queue, runtime policies, process store, git CLI, remote server connectors (`connectors` sub-path: SSH, DevTunnel), utilities, and workflow compatibility exports |
| **coc-agent-sdk** | `packages/coc-agent-sdk/` | Provider-agnostic AI agent SDK: `CopilotSDKService`, `CodexSDKService`, `SDKServiceRegistry`, session lifecycle, streaming state machine, MCP config, model registry |
| **coc-memory** | `packages/coc-memory/` | Memory V2 core package: SQLite-backed fact/episode stores, hybrid search, embedding provider abstraction, capture service, safety scanning |
| **coc-connector** | `packages/coc-connector/` | Consolidated messaging connectors behind one `MessagingConnector` contract — no CoC/forge deps. Core interface at the root (`@plusplusoneplusplus/coc-connector`), Teams at `/teams` (Graph API + MCP, used by `coc` and `coccontainer`), WhatsApp at `/whatsapp` (Baileys, lazy-loaded; used by `coccontainer` when `messaging.whatsapp.enabled` is true). Baileys + qrcode-terminal are `optionalDependencies`. Subpath exports avoid the `BotStatus` name collision; physical `teams/` + `whatsapp/` proxy `package.json` dirs let `moduleResolution: node10` consumers resolve the subpaths |

**Architectural boundary:** Shared behavior belongs in Node packages with explicit package contracts. UI-facing behavior for the CoC dashboard lives under `packages/coc/`; reusable REST clients live in `packages/coc-client/`; workflow, memory, SDK, and utility logic stay in their dedicated packages.

## Package Management & Publishing

Published workspaces (`coc`, `coc-workflow`, `forge`, `coc-agent-sdk`, `coc-memory`, `coc-client`, `deep-wiki`, `coccontainer`, `coc-connector`) are published to npm under the `@plusplusoneplusplus` scope with public access. Versioning and publishing are coordinated via **`@changesets/cli`** with an independent versioning strategy.

**How workspace packages are consumed:** `coc` and `deep-wiki` depend on published workspace packages via caret ranges. During local development, npm workspaces symlink them automatically. There is no bundling or copying into consumer packages — packages are resolved from `node_modules` at runtime.

**CoC build order:** `packages/coc-agent-sdk` builds before `coc-workflow`; `coc-workflow` builds before `forge` and `coc`; and `coc` depends on compiled `coc-agent-sdk`, `coc-client`, `coc-workflow`, `coc-memory`, and `coc-connector` output. The root `build:packages` script builds `coc-agent-sdk`, `coc-workflow`, `forge`, `coc-client`, `coc-memory`, and `coc-connector` before `coc`. Direct `packages/forge` builds run `scripts/prebuild.mjs` to build `coc-agent-sdk` and `coc-workflow` before `tsc`; direct `packages/coc` builds run `scripts/prebuild.mjs` to build `coc-agent-sdk`, `coc-client`, `coc-workflow`, and `coc-memory`, then clean `dist` before `tsc` emits package artifacts.

**Versioning workflow:**
1. Add a changeset: `npm run changeset` (interactive prompt for affected packages and semver bump)
2. Version packages: `npm run version-packages` (applies changesets, updates `package.json` versions and changelogs)
3. Publish: `npm run publish-packages` (builds all packages then runs `changeset publish`)

**CI desktop release:** `.github/workflows/release.yml` fires on `v*.*.*` tags (stable) and `v*.*.*-*` tags (pre-release, e.g. `-alpha.1`, `-beta.1`, `-rc.1`), and can also be run manually with `workflow_dispatch` for an existing tag. It builds macOS (DMG) and Windows (NSIS) desktop binaries in parallel, then creates a GitHub Release with all artifacts attached. Stable tags produce a draft release; pre-release tags produce a non-draft release marked as pre-release on GitHub. npm package publishing is done manually via `npm run publish-packages`.

**Changesets config:** `.changeset/config.json` — independent versioning, public access, `main` as base branch, `updateInternalDependencies: "patch"`.

**Minimum Node.js:** All packages require Node.js ≥ 24 (`engines.node`). CI runs on `24.x`.

## Build & Test

- **Build packages:** `npm run build:packages`
- **Build all:** `npm run build`
- **Compile:** `npm run compile` (alias for package build)
- **Test all:** `npm run test`
- **Test packages:** `npm run test:run` in any package directory (Vitest)
- **Lint:** `npm run lint`
- **Debug CoC:** `cd packages/coc && npm run build && npm link && cd ../..` then `coc run <path>` or `coc serve --no-open`
- **Debug Deep Wiki:** `cd packages/deep-wiki && npm run build && npm link && cd ../..` then `deep-wiki generate <repo>`
- **Run CoCContainer with rebuild loop:** `./scripts/coccontainer-serve-loop.sh --port 8080` installs dependencies, builds and links the package chain, verifies native dependencies such as `better-sqlite3`, then starts `coccontainer serve --no-open`
- **Run CoC as a service:** see [coc-service.md](coc-service.md)

### Native-module ABI (better-sqlite3 / node-pty)

The plain-Node server and the Electron desktop share one hoisted `node_modules`, but better-sqlite3 is a V8-ABI addon — its compiled `.node` matches exactly one runtime's `NODE_MODULE_VERSION` at a time (node-pty is N-API and ABI-stable). The preflight `packages/coc-desktop/scripts/ensure-native-abi.mjs` keeps this self-healing:

- **Desktop:** coc-desktop's `prestart` hook runs the preflight before every Electron launch (`npm run dev:desktop` and direct `npm run start -w packages/coc-desktop` alike). It probes by *exercising* each addon under Electron (`new Database(':memory:')` — better-sqlite3 dlopens lazily, so a bare `require()` proves nothing) and heals only the modules that fail.
- **Packaged agent CLIs:** the desktop build prepends bundled Copilot/Codex/Claude CLI directories to the forked server `PATH`. Copilot also unpacks both `@github/copilot/**` (the JS launcher executed by system Node) and `@github/copilot-*-*/**` (the platform binary package); leaving the launcher inside `app.asar` breaks packaged Copilot even when the native binary is unpacked.
- **Node server:** `npm run ensure:native:node` (root) flips the tree back for the plain-Node runtime.
- **Binary cache:** every verified build is stashed per `{module version, ABI, platform, arch}` under `node_modules/.cache/coc-native-abi/`, so flipping runtimes is a sub-second file restore after the first compile of each flavor. `rebuild:native` (`--force`, used by `build:desktop`) always recompiles.
- The two runtimes still cannot use the shared tree *simultaneously* — the last `ensure:*` run wins.
- **Electron pin is tied to better-sqlite3:** better-sqlite3 publishes Electron prebuilts per ABI, and that coverage trails Electron by a major or two — 11.x stops at electron-v133 (Electron 35), 12.x reaches electron-v146 (Electron 42). Electron 43 (ABI 148) has no prebuilt at any version, and better-sqlite3's C++ does not compile against its V8 15 (`External::Value` needs a tag arg), so bumping Electron past the covered range breaks `dev:desktop` and the mac release with a node-gyp error at install/packaging time. Check the [better-sqlite3 releases](https://github.com/WiseLibs/better-sqlite3/releases) for a matching `electron-v<abi>` asset before raising either version; the pact is pinned by `packages/coc-desktop/test/native-abi.test.ts`.
- Electron is resolved through Node's module resolution, not a fixed path — npm nests it under `packages/coc-desktop/node_modules` or hoists it to the root depending on the rest of the tree, and both layouts must work.

`scripts/ensure-native-dependency.mjs` (used by `coccontainer-serve-loop.sh`) is the standalone Node-side check; it also constructs an in-memory Database to force the lazy dlopen before trusting a load.

## Cross-Package Conventions

**Repo-scoped data:** All runtime data specific to a single repository must live under `~/.coc/repos/<workspaceId>/`. Use `getRepoDataPath(dataDir, workspaceId, filename)` from `packages/coc/src/server/` to resolve the path. Do **NOT** add new top-level directories under `~/.coc/` for per-repo data.

**Canonical origin IDs:** Forge git helpers export `resolveCanonicalOrigin()` / `resolveCanonicalOriginId()` from `@plusplusoneplusplus/forge/git`. They derive `gh_<owner>_<repo>` for GitHub, `ado_<org>_<project>` for Azure DevOps, `git_<remoteHash>` for unknown remotes, and `local_<workspaceId>` when no remote exists.

**Creating work items:** Work items are stored as JSON files in `~/.coc/repos/<originId>/work-items/` using canonical origin IDs (`local_<workspaceId>` for workspaces with no remote), not as `.plan.md` files in `tasks/`. Same-origin workspace directories are migrated into the canonical origin directory on first store access.

- **ALWAYS use the REST API** to create/update work items when the CoC server is running:
  ```
  POST http://localhost:4000/api/workspaces/<workspaceId>/work-items
  Body: { title, description, priority, tags, source }
  ```
- **Never write work-item JSON files directly** — the server uses an atomic write-queue.

**Model resolution:** `task.config.model` > `PerRepoPreferences.defaultModels[mode]` > `defaultModel` > CLI default.

## Development Notes

- TypeScript packages targeting Node.js ≥ 24
- Format on save and import organization enabled
- Cross-platform: Linux, macOS, Windows
