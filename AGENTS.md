# AGENTS.md

Guidance for AI agents working in this repository. NEVER create document files unless explicitly asked.

## Key Design Choice (Maintained manually, AI should NEVER update this section)

- CoC:
    - multi-repo support is required. Never design or implement a feature that would break multi-repo scenario.
    - copilot-sdk wrapper should NEVER add a sendFollowUp method or something similar. copilot-sdk-wrapper layer or above should NEVER try to add keep-alive/session-object cache.
    - Prefer use file path in the prompt instead of expanding the prompt with file's content.

## Repo Layout (one-liner)

npm workspaces monorepo for published Node packages including `coc-workflow`, `forge`, `coc`, `coc-client`, `coc-agent-sdk`, `coc-memory`, `deep-wiki`, `coccontainer`, `whatsapp-bot`, and `teams-bot`.

## Load the CoC Knowledge Skill

For anything touching CoC, forge, deep-wiki, coc-client, the dashboard SPA, REST API, workflow engine, memory system, LLM tools, process store, admin config, MCP settings, Ralph, loops, EnDev, the Windows service, monorepo layout, build/test/release flow, or repo conventions — **load `.github/skills/coc-knowledge/SKILL.md` and read the relevant `references/*.md` files** before responding or editing.

## Hard Invariants (apply even before reading the skill)

- **Multi-repo:** every feature must support multiple workspaces.
- **Repo-scoped data:** all per-repo runtime data lives under `~/.coc/repos/<workspaceId>/`; resolve paths with `getRepoDataPath(dataDir, workspaceId, filename)`. Never add new top-level dirs under `~/.coc/` for per-repo data.
- **Work items:** create/update via `POST http://localhost:4000/api/workspaces/<workspaceId>/work-items` — never write `work-items/*.json` files directly.
- **Warm client keep-alive (client process only):** `coc-agent-sdk` and above MAY keep a provider *client process* warm between turns, keyed by `(provider, workingDirectory)`, for a short idle TTL (`COC_WARM_CLIENT_TTL_MS`, default `300000`ms; `0` disables warming entirely). A fresh session is still created/resumed per turn on the warm client — never cache *session objects* and never add `sendFollowUp`. Warm clients are torn down on abort/interrupt/error, on TTL expiry, and on SDK `cleanup()`/`dispose()`. Providers that cannot stay warm (Claude, whose `query()` spawns per turn) fall back to cold-start transparently. See `WarmClientRegistry` in `coc-agent-sdk`. The SPA prewarms the client while the user types a follow-up, debounced by `COC_WARM_PREWARM_DEBOUNCE_MS` (default `500`ms; resolved on the server and surfaced via runtime config).
- **Model resolution order:** `task.config.model` > `PerRepoPreferences.defaultModels[mode]` > `defaultModel` > CLI default.
- **Node.js ≥ 24** for every package (`engines.node`).
- **Never switch branches:** AI must NEVER run `git checkout`, `git switch`, or any command that changes the current branch. Always work on the current branch as-is.
