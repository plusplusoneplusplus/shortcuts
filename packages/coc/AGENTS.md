# packages/coc

CoC CLI and integrated server. Consumes `@plusplusoneplusplus/forge`. See the
root `AGENTS.md` for the cross-package overview, build/test commands, and the
"repo-scoped data" convention. Deeper architecture references live under
`.github/skills/coc-knowledge/`.

## Admin Config

Editable admin config fields are defined in a single registry:
`src/server/admin/admin-config-fields.ts` (`ADMIN_CONFIG_FIELDS`).

Each entry provides a flat key (e.g. `'loops.enabled'`), a `validate()` function, and an `apply()` function. The PUT `/api/admin/config` handler derives `editableKeys`, validation, and merge logic entirely from this registry — **no changes to `admin-handler.ts` are needed when adding a new editable field**.

To expose a new config field via the admin API, add ONE entry to `ADMIN_CONFIG_FIELDS`. Also update:
1. `CLIConfig` / `ResolvedCLIConfig` / `DEFAULT_CONFIG` in `src/config.ts`
2. `CLIConfigSchema` in `src/config/schema.ts`
3. Namespace registry in `src/config/namespace-registry.ts` (nested fields)
4. `AdminResolvedConfig` / `AdminConfigUpdate` in `packages/coc-client/src/contracts/admin.ts`
5. `AdminPanel.tsx` for the UI control

The `spaHtml` function in `src/server/index.ts` re-reads the config file on every page request, so feature-flag changes (e.g. `terminal.enabled`) take effect on the next browser reload — no server restart required.

## Ralph

Ralph sessions live under
`~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/`. Keep the durable
architecture details in `.github/skills/coc-knowledge/references/ralph.md`;
this local file should only carry package-specific pointers and invariants.
Execution iteration prompts include a generic `<work_intent>` block before
`<goal>` and must not hard-code implementation skill names or set
`context.skills`.

A completed ask-mode chat can be promoted to a Ralph session in place via
`POST /api/processes/:id/promote-to-ralph`
(`src/server/routes/ralph-promote-routes.ts`). The endpoint attaches a
`grilling`-phase ralph context to the existing process and enqueues a
synthesis follow-up turn (mode=ask, `context.skills=['grill-me']`,
`context.ralph.phase='grilling'`) carrying the prompt produced by
`buildRalphSynthesisPrompt` (`src/server/ralph/synthesis-prompt.ts`). The SPA
shows a "Promote to Ralph" pill in the follow-up area for eligible chats and
calls this endpoint via `coc-client`'s `processes.promoteToRalph` helper.

## MCP Settings

`GET /api/workspaces/:id/mcp-config` returns both the effective
`availableServers` list and source-separated `sources.global` /
`sources.workspace` sections. Global servers come from
`~/.copilot/mcp-config.json`; workspace servers come from
`<repo>/.vscode/mcp.json` via Forge MCP loader helpers. Workspace entries
override global entries with the same name. The endpoint only exposes safe row
metadata (`name`, `type`, optional `url`/`command`, source/effective flags) and
must not return secrets such as `env`, headers, or full argument arrays.
`?forceReload=true` bypasses the path-keyed MCP config cache for manual dashboard
refreshes; no file watcher is used.

`PUT /api/workspaces/:id/mcp-config` stores only the name-based
`enabledMcpServers` allow-list. Workflow run filtering must resolve that list
against the same effective global-plus-workspace MCP merge used at runtime.

## Loops

Recurring follow-up subsystem in `src/server/loops/`. Separate from schedules.

- **Types/Store/Executor:** `loop-types.ts`, `loop-store.ts`, `loop-executor.ts`
- **REST routes:** `loop-handler.ts` → `/api/workspaces/:id/loops` + `/api/loops`
- **Infrastructure:** `infrastructure/loop-infrastructure.ts` wires store + executor + timer registry
- **LLM tools:** `llm-tools/loop-tools.ts` — `createLoop`/`cancelLoop`/`listLoops` (skill-gated), `scheduleWakeup` (always available)
- **Dashboard:** `LoopBadge`, `LoopManagementPanel`, turn source badges in `ConversationTurnBubble`
- **Restart behavior:** active loops stay persisted as `active` on shutdown and are re-armed from `nextTickAt` on startup; manually paused/cancelled/expired loops stay inactive.
- **Tick completion wiring:** `ProcessLifecycleRunner` invokes the `onLoopTickComplete(loopId, success)` lifecycle option after a loop-originated follow-up (`context.source === 'loop'` with string `context.loopId`) finishes. The queue-executor-bridge routes this to `LoopExecutor.onTickComplete()`, which advances `tickCount`/`lastTickAt`, clears the in-flight guard, and re-arms the next timer. Bookkeeping errors are logged but never mask the follow-up's actual success/failure result.

## EnDev xDPU

Workspace settings can persist an optional `WorkspaceInfo.endevXDpu` object for
the disabled-by-default `EnDev-xDpu` integration. The dashboard shows this
control near the end of the repo Preferences tab only for WSL-compatible
workspaces, and stores only the enablement flag, WSL distro, and xStore WSL repo
root.
`POST /api/workspaces/:id/endev-xdpu/discover` runs `endev doctor` in WSL,
discovers EnDev plugin skills, installs the generated global `EnDev-xDpu`
wrapper skill under `~/.coc/skills`, and appends the discovered plugin skills
folder to the workspace `extraSkillFolders`. The dashboard EnDev-xDpu
Preferences section can save dirty WSL fields, call discovery, surface setup
errors, and refresh workspace skills after success. Discovery searches standard
xStore and EnDev source/generated layouts, including
`~/.endev/source/.../plugin/skills` and `.mcp.json` or `.vscode/mcp.json` files,
and records EnDev's WSL MCP config path. When CoC runs on Windows, enabled WSL
workspaces bridge only EnDev's `funbird-mcp` server into CoC chat sessions by
spawning `wsl.exe` per SDK request, defaulting to all funbird tools when EnDev's
generated config omits a tool filter. When CoC runs natively inside WSL/Linux,
EnDev discovery runs directly from the Linux workspace root, `extraSkillFolders`
store Linux paths, and `funbird-mcp` is passed as a native local stdio MCP
server. `coc run
--workspace-root <root>` also resolves the matching workspace's
`extraSkillFolders` for workflow `skill`/`skills` prompt injection and bridges
the workspace EnDev MCP server for workflow AI nodes. MCP bridging and EnDev
discovery must remain workspace-scoped and must not mutate Windows
`~/.copilot/mcp-config.json`.

Terminal sessions for WSL workspaces spawn `wsl.exe` with `--cd <linux-root>`
and keep the PTY `cwd` on the Windows host so the process can start before WSL
switches into the xStore repo root.

The generated `EnDev-xDpu` wrapper skill documents a manual-only HBM smoke path
using sanity job `48037` and sample
`0_FUN-S21F1E-E001_1778203452409685840_hbm1.bin.tgz`; automated tests and CI
must not download internal artifacts or require credentials.
