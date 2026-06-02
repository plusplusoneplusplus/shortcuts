# packages/coc

CoC CLI and integrated server. Consumes `@plusplusoneplusplus/coc-workflow`
directly for pure workflow compilation/execution, `@plusplusoneplusplus/forge`
for runtime/process/queue utilities, and `@plusplusoneplusplus/coc-agent-sdk`
for the provider-neutral LLM-tool contract (`Tool`, `defineTool`, etc.).

See the root `AGENTS.md` for cross-package conventions and **always load
`.github/skills/coc-knowledge/SKILL.md`** before working on this package —
detailed architecture lives in its `references/*.md` files.

## Where to Read Before Editing

| If you are touching… | Read first |
|----------------------|------------|
| CLI commands, source layout, executors, server startup, storage layout | [server-architecture.md](../../.github/skills/coc-knowledge/references/server-architecture.md) |
| Admin REST handler, editable config fields, admin UI | [admin-config.md](../../.github/skills/coc-knowledge/references/admin-config.md) |
| `~/.copilot/mcp-config.json` + `.vscode/mcp.json` merge, allow-list | [mcp-settings.md](../../.github/skills/coc-knowledge/references/mcp-settings.md) |
| `src/server/endev/`, `EnDev-xDpu` skill visibility | [endev.md](../../.github/skills/coc-knowledge/references/endev.md) |
| Ralph sessions, iteration prompt, promote-to-ralph endpoint | [ralph.md](../../.github/skills/coc-knowledge/references/ralph.md) |
| `src/server/loops/`, loop tools, tick lifecycle | [loops.md](../../.github/skills/coc-knowledge/references/loops.md) |
| Process store / SQLite schema / FTS5 / pin / archive | [process-store.md](../../.github/skills/coc-knowledge/references/process-store.md) |
| Dashboard SPA (`src/server/spa/`) | [dashboard-spa.md](../../.github/skills/coc-knowledge/references/dashboard-spa.md) |
| REST endpoints | [rest-api.md](../../.github/skills/coc-knowledge/references/rest-api.md) |
| Notes sync engine (`src/server/sync/`) | [sync.md](../../.github/skills/coc-knowledge/references/sync.md) |
| SDK wrapper, Copilot/Codex providers, `ISDKService`, `SDKServiceRegistry` | [sdk-wrapper.md](../../.github/skills/coc-knowledge/references/sdk-wrapper.md) |

Other domains (memory, workflow engine, prompt autocomplete, wiki serving,
remote servers, task comments, llm-tools, sdk-wrapper, chat-prompt-history)
all have their own `references/*.md`.

## Local Invariants

- **627+ Vitest test files** live under `packages/coc/test/server/`. Any
  server change should add or update tests there.
- **Codex skill mirroring** runs once at server startup (when
  `resolvedConfig.codex?.enabled === true`), not per-install. The
  `syncInstalledSkillsToCodex` function copies all globally installed bundled
  skills from `~/.coc/skills` to `~/.codex/skills` (`$CODEX_HOME/skills`).
- **Claude skill mirroring** runs once at server startup (when
  `resolvedConfig.claude?.enabled === true`). The `syncInstalledSkillsToClaude`
  function copies each skill's `SKILL.md` from `~/.coc/skills/<name>/SKILL.md`
  to `~/.claude/commands/<name>.md` (`$CLAUDE_HOME/commands/<name>.md`) so
  Claude Code discovers them as slash commands. A sidecar marker
  `.coc-<name>.json` tracks CoC-managed commands to distinguish them from
  user-authored ones.
- **Adding an editable config field** is a single registry entry — do not
  modify `admin-handler.ts` (see [admin-config.md](../../.github/skills/coc-knowledge/references/admin-config.md)).
- **Adding a namespaced config field** must update
  `src/config/namespace-registry.ts`; do not expand branch lists in `config.ts`.
- **MCP REST surface** must never expose secrets (`env`, headers, full `args`).
- **Ralph iteration prompts** must not hard-code implementation skill names
  or set `context.skills`; the `<work_intent>` block must stay generic.
- **Ralph final-check tasks** still run with autopilot capability, but
  `RalphExecutor` must use validation-only system instructions whenever
  `context.ralph.finalCheck` is present. Do not route final checks through the
  normal implementation-loop system prompt.
- **Loop ticks** must route completion through
  `ProcessLifecycleRunner → onLoopTickComplete → LoopExecutor.onTickComplete`;
  bookkeeping errors must never mask the follow-up's actual result.
- **Follow-up enqueue sites** must call `resolveFollowUpMode(...)` and set
  `payload.mode`. `FollowUpExecutor.executeFollowUp` fail-loud warns + defaults
  to `'ask'` if missing.
- **Direct package builds** use `scripts/prebuild.mjs` to build
  `@plusplusoneplusplus/coc-workflow` and `@plusplusoneplusplus/coc-memory`
  before `tsc` and to generate
  `src/server/core/build-info.ts`; keep this script cross-platform.
