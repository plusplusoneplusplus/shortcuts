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

- **Server Vitest tests** live under `packages/coc/test/server/`. Any
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
- **Adding an admin-exposed config setting** is ONE definition entry in
  `src/config/admin-setting-definitions.ts` (value spec, default, runtime,
  optional `runtimeFlag` + Features-card `ui` metadata) plus the
  `CLIConfig`/`ResolvedCLIConfig`/`DEFAULT_CONFIG` declarations in
  `src/config.ts`. Admin validation, file schema, namespace merge/source
  tracking, runtime feature flags, the embedded SPA bootstrap, the Features
  card UI, and the generic contract tests
  (`test/config/admin-setting-definitions.test.ts`) all derive from the
  registry — do not hand-edit `admin-config-fields.ts`, `schema.ts` leaves,
  or `namespace-registry.ts` for admin settings. Reserve `admin-handler.ts`
  changes for cross-field validation shared with config-file loading (see
  [admin-config.md](../../.github/skills/coc-knowledge/references/admin-config.md)).
- **Non-admin namespaced config fields** (queue, models, logging, monitoring,
  skills, memoryPromotion, …) keep hand-written descriptors in
  `src/config/namespace-registry.ts`; do not expand branch lists in `config.ts`.
- **MCP REST surface** must never expose secrets (`env`, headers, full `args`).
- **Ralph iteration prompts** must not hard-code implementation skill names
  or set `context.skills`; the `<work_intent>` block must stay generic.
- **Ralph final-check tasks** still run with autopilot capability, but
  `RalphExecutor` must use validation-only system instructions whenever
  `context.ralph.finalCheck` is present. Do not route final checks through the
  normal implementation-loop system prompt.
- **Ralph manual-only completion** treats explicit manual-verification-only
  `Remaining:` progress as complete autonomous work: do not queue another
  implementation iteration; enqueue final-check and preserve the manual
  verification-needed terminal status.
- **Loop ticks** must route completion through
  `ProcessLifecycleRunner → onLoopTickComplete → LoopExecutor.onTickComplete`;
  bookkeeping errors must never mask the follow-up's actual result.
- **Follow-up enqueue sites** must call `resolveFollowUpMode(...)` and set
  `payload.mode`. `FollowUpExecutor.executeFollowUp` fail-loud warns + defaults
  to `'ask'` if missing.
- **Pull Requests Team auto-classification** must stay gated by
  `pullRequests.enabled`, `pullRequests.autoClassifyTeam`, and
  `features.focusedDiff`; use the generic classify-diff enqueue helper with the
  per-trigger cap and low priority instead of adding client-side POST loops.
  The Team toolbar status UI should read batch status and route manual
  "Classify now" actions through the same bounded server helper.
- **Work-item create/update side effects** (hierarchy `parentId` validation,
  GitHub/Azure Boards provider sync, response-cache invalidation, dashboard
  broadcasts, auto-execute) live in the shared command service
  `src/server/work-items/work-item-commands.ts`. Both the REST routes
  (`src/server/routes/work-item-routes.ts`) and the `create_update_work_item`
  LLM tool call it — do not re-implement hierarchy or provider logic in either
  caller.
- **Direct package builds** use `scripts/prebuild.mjs` to build
  `@plusplusoneplusplus/coc-client`, `@plusplusoneplusplus/coc-workflow`, and `@plusplusoneplusplus/coc-memory`
  before `tsc`, clean `dist` before emitting, and generate
  `src/server/core/build-info.ts`; keep this script cross-platform.
