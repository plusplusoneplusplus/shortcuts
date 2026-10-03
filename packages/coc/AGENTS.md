# packages/coc

Follow [root instructions](../../AGENTS.md). Load
[coc-knowledge](../../.github/skills/coc-knowledge/SKILL.md) and the relevant
references before editing. Paths are package-relative.

## Where to Read Before Editing

| Domain | Read first |
|--------|------------|
| CLI, runtime, storage | [Server](../../.github/skills/coc-knowledge/references/server-architecture.md) |
| Settings | [Admin](../../.github/skills/coc-knowledge/references/admin-config.md) |
| Provider/session policy | [SDK wrapper](../../.github/skills/coc-knowledge/references/sdk-wrapper.md) |
| Processes | [Process store](../../.github/skills/coc-knowledge/references/process-store.md) |
| REST contracts | [REST API](../../.github/skills/coc-knowledge/references/rest-api.md) |
| SSE/WebSockets | [Streaming](../../.github/skills/coc-knowledge/references/streaming-architecture.md) |
| Dashboard routing | [Shell](../../.github/skills/coc-knowledge/references/spa/shell.md), [clones](../../.github/skills/coc-knowledge/references/spa/clone-routing.md) |
| Chat | [Conversation](../../.github/skills/coc-knowledge/references/spa/chat-conversation.md) |
| Git, PRs, work items | [Git/PRs](../../.github/skills/coc-knowledge/references/spa/git-and-prs.md), [work items](../../.github/skills/coc-knowledge/references/spa/work-items.md) |
| Notes and Sentinel | [Notes](../../.github/skills/coc-knowledge/references/spa/notes.md), `src/server/sentinel/` |
| Canvas/Kusto | [Canvas](../../.github/skills/coc-knowledge/references/spa/canvas.md) |
| Ralph and worktrees | [Ralph](../../.github/skills/coc-knowledge/references/ralph.md) (launch/lifecycle links) |
| MCP, tools, cron, memory, workflows, LSP, remote hosts, sync | [Knowledge index](../../.github/skills/coc-knowledge/SKILL.md#architecture-index) |
| Messaging | [Connector](../coc-connector/AGENTS.md), `src/server/messaging/` |
| Native search/Notes I/O | [Native](../coc-native/AGENTS.md) |

## Scope and API Boundaries

- Support multiple workspaces/servers. Build paths with
  `getRepoDataPath(dataDir, workspaceId, filename)`; do not add top-level per-repo storage.
- Separate **storage origin** from **execution workspace**. Work items, plans/versions,
  changes, bindings, PR provider state, classification, and review progress use
  `/api/origins/:originId/...` and `*ForOrigin` methods. Concrete `workspaceId` selects
  queue/filesystem/Git/provider execution and validation, not storage identity.
  Do not add repo-scoped PR-provider/origin-state aliases.
- Mutate work items through REST and `src/server/work-items/work-item-commands.ts`,
  not files/duplicated route logic. Invalidate/broadcast both scopes.
- Workspace/process REST, SSE, and WebSockets target their owner:
  use `getCocClientForWorkspace`, `useCocClient(ref)`, or the clone-routed helpers.
  Unresolved remote selections never fall through locally; admin stays page-origin.
  Reject late responses after scope changes.
- `list_workspaces`, `send_to_conversation` remote targets and messaging `list remotes` share one route-layer
  `src/server/servers/workspace-directory.ts` (clone keys, per-server timeouts, last-known
  offline entries). Remote create mode posts to the remote's own queue/Ralph API with no
  local fallback; output never carries paths, URLs, or credentials.
- Remote group selection uses a server-qualified clone key; decode the raw
  group id at the owning API. Groups are page/queue scope; Git uses a member.
  Names are not keys; refresh live membership and preserve search failure states.
- Previews carry resolved workspace/member and clone route through
  operations/caches. Probe group members in order; preview roots never authorize writes.
  Preserve WSL UNC prefixes/root containment.
- Implement on same-origin clones. Local file plans use paths; remote
  source/target plans and canvas plans embed content read from the source client.
  Persist state on the source; execute/own PR gates on the target.

## Runtime, Persistence, and Configuration

- Production `createProcessStore` uses native `SqliteProcessStore` and `processes.db`;
  `store.backend: file` is ignored; file stores are test fixtures only.
  Native failures fail startup, without JavaScript persistence/index fallbacks.
- Whole-repo search/listing requires Rust; directory listing may walk. Notes
  search validates capability at composition and authorizes roots before search.
  Indexes/watchers key by `(workspaceId, rootId)`, not paths; failed refreshes retain
  complete snapshots and shutdown disposes watchers.
- Search fresh working-tree bytes; test Git narrowing/native walks.
  QuickOpen uses server indices; reuse requires the current workspace root
  for each `showIgnored` variant. Payload caps never cap search candidates.
- Restore queues stopped. Activate only after
  wiring and HTTP listening, respecting auto-start policy; never substitute a delay.
- Late-bound capabilities belong only in
  `src/server/executors/executor-runtime-contracts.ts`. The queue bridge extends the
  runtime once, then forwards by identity through registry/chat layers.
  Narrow views exclude static config.
  `test/server/executors/executor-runtime-wiring.test.ts` guards every hop.
- Use `QueueRuntimeConfig`, not `loadConfigFile()`/startup captures.
  CLI/tests inject fixed ports. Add admin settings once in
  `src/config/admin-setting-definitions.ts` plus config types/defaults; generated
  consumers stay derived. Non-admin leaves use `src/config/namespace-registry.ts`.
- New experimental flags default off; gate server/tools and UI
  boundaries; preserve existing defaults and live/restart semantics.
- Use `src/server/cache/`, not new TTL Maps. Cache dashboard static config
  and invalidate on mutation; avoid per-conversation workspace/config refetches.
- Register persisted families in `src/server/storage/snapshot/`; pass
  `test/server/snapshot-domain-contract.test.ts` for export/import/wipe consistency.

## Chat and Provider Safety

- First/follow-up turns share context/system/policy/runner/settlement helpers
  under `src/server/executors/`; lifecycle owns persistence.
  Mode directives/style belong in user turns, not the system prefix.
- Keep tools mode-invariant; gate call-time behavior and unattended `ask_user`.
  Preserve explicit PR-write/final-check/grill exceptions.
  Codex discovery uses filtered tools; Copilot context tier uses billing metadata.
- Fresh session objects per turn; never cache sessions or add `sendFollowUp`.
  Only supported provider client processes may stay warm.
  CoC send/prewarm/status paths share `warmKey: processId`; cwd is execution context.
- Resume the active provider only. Switches/unbound continuations
  use fresh sessions/bounded handoff via `src/server/executors/continuation-mode.ts`.
  Never pass session IDs across providers.
  Model: task/turn > repo mode default > repo default > provider/CLI.
- Stopped chats require `resumeSessionId`/`strictSessionResume: true`; failed resume
  marks `metadata.stoppedChatResume` non-resumable, without replacement/fresh fallback.
- Follow-up delivery/rewind share `src/server/processes/process-operation-admission.ts`.
  Re-read state under admission; contending switches fail `PROVIDER_SWITCH_REQUIRES_IDLE`.
  Rewind holds running/rewind state through mutation; restore terminal status and release
  admission on failure in `finally`.
- Delivery decisions belong in `process-message-delivery-service.ts`. Buffer via atomic
  `appendPendingMessage`, not metadata read-modify-write; draining owns deferred turns.
  Emit intents once; follow-up enqueue sites resolve mode via `resolveFollowUpMode(...)`
  (an omitted mode keeps the chat's mode; terminal Sentinel wins) — never default it to `'ask'`.
  Use `metadataPatch` for field updates.
- Tool-free lookups use `src/server/core/one-shot-ai.ts`: deny permissions/ambient MCP.
  Dreams analyzer/critic work uses persisted lifecycle processes, not direct SDK calls.

## Filesystem, Orchestration, and Tool Contracts

- Canonicalize live group roots; reject writable/read-only overlap.
  Pass both sets every turn; unsupported providers fail before session creation.
  See `src/server/workspaces/repo-group-access-policy.ts`.
- Notes root authority is `src/server/notes/notes-root-resolver.ts`, not client paths.
  Task roots are opaque/protected, never user-root config or counted against its limit.
  Native Notes I/O owns containment/symlinks, atomic writes, sidecars, and order.
  See `src/server/notes/notes-write-handler.ts` and native instructions.
- Protect managed `Plans`/`Sentinel` roots. Retarget Notes chats through the validated
  `/api/processes/:id/note` route and enforce bound-section containment.
  Keep Tiptap dependencies at one exact version and bump the entire set together.
- Canvas mutations use revision-checked `queue.runExclusive`, never direct writes.
  Preserve snapshot/artifact/descriptor order; use the capability runner and sanitize SVG.
  `src/server/canvas/canvas-file-sandbox.ts` checks encoded/decoded shape, resolved
  containment, and realpaths. Data stays canvas-scoped/read-only to consumers; no
  file-write endpoint/repo escape. Diagnostics omit content/absolute paths.
- Native CLI stores are read-only with parameterized filters/path-safe IDs.
  Only explicit import bridges to chats; unavailable stores return typed states.
  Descriptors/factories share one registry; file-backed providers
  read through `src/server/native-copilot-sessions/native-transcript-index.ts`.
- Child tasks use `src/server/task-groups/`/`context.taskGroup` and shared UI;
  best-effort projection must not break execution.
- Ralph uses path journals, `getRalphTaskKind`, and purpose-built check/submit prompts.
  Checks are validation-only; submit completion never queues iterations.
  Persist one repair attempt before requeue. Manual-only work proceeds
  to final-check without another iteration.
- Queue pause/delays/PR gates are repo-scoped; skip releases only the active delay.
  A PR gate admits only its chain and releases only for its matching merge/manual release.
  Schedule writes serialize per repo; runtime keys are `(repoId, scheduleId)`. Await
  writes/reloads; retain
  state on scan failure. Wakeups persist before arming.
- Sentinel ownership is exclusive/workspace-scoped: admission grace/exact-owner
  replacement; cancel the prior cron. Preserve optimistic Board writes, approval/budget/
  backoff, workspace-only classification, and descendant exclusion.
  See `src/server/sentinel/sentinel-ownership.ts` and adjacent `sentinel-nudge.ts`.
- Create PRs via `src/server/git/create-pull-request-service.ts` and injected runners.
  Commit-mode conflicts abort; the active checkout/HEAD never moves. Worktree execution
  uses owning-server committed objects, fails before queueing, performs no implicit
  network/branch switch, and removes without force/branch deletion.
  Git-tab Fetch/Pull uses the exact current-branch upstream; patch metadata is untrusted.

## Messaging and Secrets

- Separate normal messaging from container relays. Config is global; chat receipts
  are workspace-scoped. Admit eligible human/paired-account posts via explicit bindings;
  suppress own/history replay. Dispose polling/reconnect loops/listeners.
  Teams and WhatsApp topic list/select uses `src/server/messaging/chat-target.ts`
  for bounded (10), conversation-free process pages, not unbounded `getAllProcesses`.
  Shared workspace/topic lookup and terminal-task subscriptions belong there;
  both relays resolve request-correlated answers and safe failure notices
  through `src/server/messaging/relay-answer.ts`. Session/usage-limit notices
  include recognized UTC/GMT reset times; other failures use fixed text. Never
  relay raw exceptions or partial output, or borrow another request's error. Receipt files use
  `atomicWriteJsonUnique`; transport, reply wording and formatting stay per connector.
- Teams/WhatsApp command grammar is one spec table in
  `coc-connector/src/shared/commands.ts` (`parseMessagingCommand`, generated
  `MESSAGING_HELP_TEXT`); unknown `/word` or malformed list/select/create replies
  "Unknown command" + help, never the AI. `src/server/messaging/messaging-commands.ts`
  answers selection, help, quota and `compact [instructions]` for both routers via a
  `MessagingSelection` adapter. `compact` targets the quoted/bound-thread answer's
  chat, else the selected topic; it calls `processes/compact-process.ts` (shared with
  the compact route), never enqueues a turn or changes selection, and maps 400/409/422
  to fixed replies. `/autopilot <msg>` / `/ask <msg>` set the turn's mode; plain text keeps
  the chat's mode (new chats run in Ask) via `src/server/messaging/messaging-chat-mode.ts`,
  never a defaulted `'ask'`.
  `list remotes` and `list topics <n.m|name@server>` browse remote servers read-only via
  `src/server/messaging/remote-browse.ts` over the shared `WorkspaceDirectory`
  (`listRemoteChats` → remote `GET /api/processes`, 10 cap). `n.m` numbering is kept in
  memory per WhatsApp group / Teams thread; remote repos are never selectable, and
  replies carry only server/repo names (failures logged server-side). Bare `list topics`
  stays local.
- Ask turns started from WhatsApp/Teams (first and connector follow-ups) relay
  `ask_user` questions one at a time to the originating group/thread through
  `src/server/messaging/ask-user-relay.ts`, wired at emit time via the late-bound
  `getAskUserQuestionRelay` capability. A reply (or a plain message while exactly
  one is pending) answers; unpostable questions resolve `unavailable`; turn end
  clears pending ones; approvals stay dashboard-only.
- Teams IC3 requires explicit `amer`/`emea`/`apac` and identity-pinned connection
  credentials. Missing region fails before credentials/network; automatic discovery
  is not implemented. Never guess, fail over, or replay IC3 writes.
  Region/account changes require reconnect.
- Normal Teams connection settings expose experimental `enableTrouter` (off by default)
  through the messaging config API and Connections card; changing it disconnects and
  requires reconnect. Notifications use separate, identity-pinned Azure CLI IC3 credentials
  without requiring a write region. Authoritative MCP reads, workspace bindings and
  answer-relay admission stay unchanged; fallback is completion-relative 60 seconds.
  Status exposes sanitized `notificationStatus` separately from reader connectivity;
  the Connections card displays notification degradation while fallback remains connected.
  Private Trouter is best-effort, not durable catch-up; container relay settings are separate.
- Teams setup uses scoped admin styles and native disclosures for advanced settings,
  routing help, and connection history. Keep status/errors visible outside disclosures
  and preserve separate endpoint/channel saves and unsaved-change connect gating.
- Teams sends start with `AI:`/safe HTML. Receipts differ from final answers:
  relay captured terminal turns by request ID to the original thread/workspace.
  Selection changes never redirect answers. Persist accepted multipart progress;
  never replay confirmed sends; reconcile unknown outcomes.
  Preserve thread cursors/own IDs on reconnect; WhatsApp shares the receipt rule.
- MCP APIs and connection history expose only allowlisted safe fields, never tokens,
  `env`, headers, full arguments, or provider error bodies. Credentials stay on their host.

## Build and Validation

- Root `npm run build` builds workspaces; `npm run build -w packages/coc` runs package
  prebuild/clean emission. Keep scripts cross-platform; Node.js >=24.
- Target server changes with `npm run test:run -w packages/coc -- test/server/<test>.test.ts`;
  `test:run` is non-watch; `test` is Vitest watch mode.
  Use `test:e2e`/`lint` when relevant; docs need no build/tests.
- Docker/tenant changes keep `test/docker/` contracts green: loopback-only bind,
  no exposed/published CoC port, and `COC_BUILD_COMMIT` support without `.git`.
- Keep current safety rules here; details belong in existing domain references/source.
