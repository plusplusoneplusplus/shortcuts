# AGENTS.md

Guidance for AI agents working in this repository. NEVER create document files unless explicitly asked.

## Key Design Choice (Maintained manually, AI should NEVER update this section)

- CoC:
    - multi-repo support is required. Never design or implement a feature that would break multi-repo scenario.
    - copilot-sdk wrapper should NEVER add a sendFollowUp method or something similar. copilot-sdk-wrapper layer or above should NEVER try to add keep-alive/session-object cache.
    - Prefer use file path in the prompt instead of expanding the prompt with file's content.

## Repo Layout (one-liner)

npm workspaces monorepo with one frozen VS Code extension and four published Node packages (`forge`, `coc`, `coc-client`, `deep-wiki`). `packages/vscode-extension/` is **FROZEN — do not read, edit, or reason about its code.**

## Load the CoC Knowledge Skill

For anything touching CoC, forge, deep-wiki, coc-client, the dashboard SPA, REST API, workflow engine, memory system, LLM tools, process store, admin config, MCP settings, Ralph, loops, EnDev, the Windows service, monorepo layout, build/test/release flow, or repo conventions — **load `.github/skills/coc-knowledge/SKILL.md` and read the relevant `references/*.md` files** before responding or editing.

Quick-start pointers (full detail lives in the skill):

- **Monorepo, build, test, changesets release** → [monorepo.md](.github/skills/coc-knowledge/references/monorepo.md)
- **CoC server module layout / executors / startup** → [server-architecture.md](.github/skills/coc-knowledge/references/server-architecture.md)
- **Admin config field registry + admin UI styling** → [admin-config.md](.github/skills/coc-knowledge/references/admin-config.md)
- **Workspace MCP merge & allow-list** → [mcp-settings.md](.github/skills/coc-knowledge/references/mcp-settings.md)
- **EnDev xDPU eligibility & skill surfacing** → [endev.md](.github/skills/coc-knowledge/references/endev.md)
- **Windows service (`Manage-CoCService.ps1`)** → [coc-service.md](.github/skills/coc-knowledge/references/coc-service.md)
- **Ralph iterative sessions + promote endpoint** → [ralph.md](.github/skills/coc-knowledge/references/ralph.md)
- **Recurring loops + wakeups + circuit breakers** → [loops.md](.github/skills/coc-knowledge/references/loops.md)
- **Deep Wiki six-phase pipeline** → [deep-wiki.md](.github/skills/coc-knowledge/references/deep-wiki.md)
- **REST API catalog** → [rest-api.md](.github/skills/coc-knowledge/references/rest-api.md)

## Hard Invariants (apply even before reading the skill)

- **Multi-repo:** every feature must support multiple workspaces.
- **Repo-scoped data:** all per-repo runtime data lives under `~/.coc/repos/<workspaceId>/`; resolve paths with `getRepoDataPath(dataDir, workspaceId, filename)`. Never add new top-level dirs under `~/.coc/` for per-repo data.
- **Work items:** create/update via `POST http://localhost:4000/api/workspaces/<workspaceId>/work-items` — never write `work-items/*.json` files directly.
- **VS Code extension is frozen:** do not read, edit, or reason about `packages/vscode-extension/`. It is not an npm workspace.
- **No SDK session caching:** `copilot-sdk-wrapper` and above must never add `sendFollowUp` or keep-alive/session caches.
- **Model resolution order:** `task.config.model` > `PerRepoPreferences.defaultModels[mode]` > `defaultModel` > CLI default.
- **Node.js ≥ 24** for every package (`engines.node`).
