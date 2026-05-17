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

## Loops

Recurring follow-up subsystem in `src/server/loops/`. Separate from schedules.

- **Types/Store/Executor:** `loop-types.ts`, `loop-store.ts`, `loop-executor.ts`
- **REST routes:** `loop-handler.ts` → `/api/workspaces/:id/loops` + `/api/loops`
- **Infrastructure:** `infrastructure/loop-infrastructure.ts` wires store + executor + timer registry
- **LLM tools:** `llm-tools/loop-tools.ts` — `createLoop`/`cancelLoop`/`listLoops` (skill-gated), `scheduleWakeup` (always available)
- **Dashboard:** `LoopBadge`, `LoopManagementPanel`, turn source badges in `ConversationTurnBubble`
- **Restart behavior:** active loops stay persisted as `active` on shutdown and are re-armed from `nextTickAt` on startup; manually paused/cancelled/expired loops stay inactive.
- **Tick completion wiring:** `ProcessLifecycleRunner` invokes the `onLoopTickComplete(loopId, success)` lifecycle option after a loop-originated follow-up (`context.source === 'loop'` with string `context.loopId`) finishes. The queue-executor-bridge routes this to `LoopExecutor.onTickComplete()`, which advances `tickCount`/`lastTickAt`, clears the in-flight guard, and re-arms the next timer. Bookkeeping errors are logged but never mask the follow-up's actual success/failure result.
