# packages/coc

Follow [root instructions](../../AGENTS.md). Load [coc-knowledge](../../.github/skills/coc-knowledge/SKILL.md) and the matching reference before editing. Paths are package-relative. This file is the rule list. Module detail lives in those references.

## Where to read

| Domain | Read first |
|--------|------------|
| CLI, runtime, storage | [Server](../../.github/skills/coc-knowledge/references/server-architecture.md) |
| Settings | [Admin](../../.github/skills/coc-knowledge/references/admin-config.md) |
| Provider/session policy | [SDK wrapper](../../.github/skills/coc-knowledge/references/sdk-wrapper.md) |
| Processes | [Process store](../../.github/skills/coc-knowledge/references/process-store.md) |
| REST | [REST API](../../.github/skills/coc-knowledge/references/rest-api.md) |
| SSE/WebSockets | [Streaming](../../.github/skills/coc-knowledge/references/streaming-architecture.md) |
| Dashboard routing | [Shell](../../.github/skills/coc-knowledge/references/spa/shell.md), [clones](../../.github/skills/coc-knowledge/references/spa/clone-routing.md) |
| Chat | [Conversation](../../.github/skills/coc-knowledge/references/spa/chat-conversation.md), [composer](../../.github/skills/coc-knowledge/references/spa/chat-composer.md) |
| Git, PRs, work items | [Git/PRs](../../.github/skills/coc-knowledge/references/spa/git-and-prs.md), [work items](../../.github/skills/coc-knowledge/references/spa/work-items.md) |
| Notes, canvas | [Notes](../../.github/skills/coc-knowledge/references/spa/notes.md), [canvas](../../.github/skills/coc-knowledge/references/spa/canvas.md) |
| Ralph | [Ralph](../../.github/skills/coc-knowledge/references/ralph.md) |
| Messaging | [Connector](../coc-connector/AGENTS.md), `src/server/messaging/` |
| Native I/O | [Native](../coc-native/AGENTS.md) |

## Scope

- Multiple workspaces and servers are required. Per-repo files use `getRepoDataPath(dataDir, workspaceId, filename)`. Do not add top-level per-repo storage.
- **Storage origin** and **execution workspace** are different. Work items, plans, PR-provider state, and review progress use `/api/origins/:originId/...`. `workspaceId` selects queue, filesystem, Git, and provider execution. Do not add repo-scoped origin aliases.
- Mutate work items through REST and `work-item-commands.ts`. Invalidate and broadcast both scopes.
- Workspace REST, SSE, and WebSockets use `getCocClientForWorkspace`, `useCocClient(ref)`, or the clone-routed helpers. Unresolved remote selections never fall through locally. Admin uses `useAdminServer()`, never `getSpaCocClient()`.
- Discard superseded reads, including ignored aborts. A read error is not a message retry. Sidebar queue snapshots do not replace history reads.
- Page-origin repo rows use identity observed through that client's health read. A registry alias or URL is not an owner.
- Remote create and post go to the destination's own API. Output never carries paths, URLs, or credentials. Admission errors expose `dispatchState`: `not-started`, `rejected`, or `uncertain`. Timeouts, HTTP 408/5xx, and lost replies stay uncertain and forbid blind resubmit.
- Remote delegation is sender-only. The destination never calls the origin. `originServerIdentity` is a label, not authority. The first claim binds a SHA-256 of the origin's per-request secret. Secrets travel only in POST bodies. The destination hashes the execution envelope before any await.
- `search_conversations` and `send_to_conversation` keep durable server identity, connection alias, and raw workspace id apart. Dashboard source requires an exact `target`. Relay failure never falls back to the local store.
- Implement plans on the source. Execute and own PR gates on the target.

## Runtime

- One `server-identity.json` UUID per data dir. Unreadable identity fails startup. Do not replace it with an alias or URL.
- Production processes use native `SqliteProcessStore`. `store.backend: file` is a test fixture. Native failure fails startup. No JavaScript persistence fallback.
- Fresh session objects per turn. Never cache sessions or add `sendFollowUp`. Only supported provider client processes may stay warm, keyed by `processId`. Resume the active provider only. Never pass session ids across providers. Stopped chats require `resumeSessionId` and `strictSessionResume`. Failed resume is non-resumable.
- Model order: task, then repo mode default, then repo default, then provider. Explicit `reasoningEffort: false` wins.
- Delivery buffers with `appendPendingMessage`. Draining owns deferred turns. `resolveFollowUpMode` keeps the chat mode when mode is omitted. Terminal Sentinel wins. Never default a follow-up to `'ask'`.
- Queue restore stays stopped until wiring and listen finish. Do not substitute a delay.
- Add an admin setting once in `admin-setting-definitions.ts`. Generated consumers stay derived. Browser controls use `ui.tab: 'browser'`. Other UI-only controls use `appearance`. Sentinel controls use `sentinel`.
- New experimental flags default off and gate server, tools, and UI together.
- Late-bound capabilities belong only in `executor-runtime-contracts.ts`. The queue bridge extends the runtime once.
- Use `src/server/cache/`. Do not add TTL maps. SPA Git and queue readers share `api/workspaceReads.ts`. Repo preferences share `api/repoPreferences.ts` (30s, invalidated on mutation).
- Admitted chat images stay at their per-turn paths after success, error, or cancellation. Rejected and non-image cleanup still runs. WSL image-capable SDKs consume host-readable uploads with distro ownership checks; do not stage copies in repo roots. Remote image forwarding is unsupported.
- Auto-compact is opt-in per chat, server-side, absolute token threshold, default off at 700k. It never rescales from the model limit and adds no deadline to a running compaction. Refrain job chats follow the job threshold (`422 AUTO_COMPACT_JOB_MANAGED`).
- `copilot.transformTransport` is installation-wide and restart-required. Direct requests use the Copilot CLI account. Never persist that token in admin config. System One, the shared decision backend, and titles use `gpt-6-luna`.

## Sentinel

Product names: **Refrains** (wire `jobs`), **Coda** (wire `scrubber`), **Overtures** (wire `trigger`). REST, SQL, tools, and flags keep the wire words.

- Sentinel chats are dispatchers. Coding tasks stay pending until implementation meets the completion condition. Design-only and interview-only requests finish at an artifact. Ask mode does not redefine that.
- `send_to_conversation` create from a Sentinel defaults to `autopilot` and prefers `provider: "auto"` unless the user names a provider. Disabled Auto uses the parent's concrete provider after target validation. No silent substitution.
- The ledger is bookkeeping. Every read and write proves the parent Sentinel owner. Emits happen after the SQLite commit. Tools and REST share `SentinelTodoService`. Ledger edits never start, retry, or cancel jobs.
- Item type is immutable (`normal` or `manual`). No hard delete. Manual items never authorize execution, delegation, or job links. Completion never marks Done. Only an explicit verdict does.
- Creates that omit `categoryId` may auto-pick. Explicit `categoryId` or `null` never re-picks. A user move wins the CAS.
- Dependencies are conjunctive, cycle-free, and same-ledger. Readiness never launches work. Re-check under the writer before dispatch. Artifact acceptance and dependency authoring grant no execution permission.
- Remote links need verified destination and request identity. Untracked remote links stay `unavailable`.
- Coda children request `effortTier: 'medium'`, stay unattended, and auto-deny shell approval. Findings must cover the snapshot. Empty eligible snapshots still queue one child.
- Overtures reserve the writer, recheck revision, and persist the wake before queue work. Trigger code never writes item status.
- Refrains need both live flags, an expected revision, and at most ten jobs per owner. A nonempty gate result claims its run synchronously. Five consecutive failures pause the gate. Test gate never saves or starts a run.
- Delegated jobs belong to the parent workspace. The first terminal result wins. Child output cannot change routing. Record the relationship before queue execution.
- Result reviews use `ProcessMessageDeliveryService.deliverOnce` with a stable receipt. Never steer. Stopped parents are rejected. Cancellation notices are display-only and do not resume a stopped parent.

## Chat and tools

- Accepted steering messages split visible sections, not logical assistant turns. The owning executor persists correlated dispatch-time timeline boundaries; retain provider attribution and tool lifecycle ownership. Failed or queued sends do not create boundaries.
- Tools stay mode-invariant. Gate behavior at call time. Unattended scripts omit questions and deny approval-gated tools before prompts or stored approvals. Approval defaults off, including nested `mcp_call`.
- Tool-free lookups use `one-shot-ai.ts` and deny permissions and ambient MCP.
- Copilot decisions have a two-minute deadline. Repair malformed decision text only when `allowOutputRepair` is not false. Transport and usage failures do not trigger another inference. Direct transforms never fall back to the SDK.
- Group writable and read-only roots are canonicalized and passed every turn. Overlap is rejected. `features.repoGroupExclusiveWriter` defaults off. Omitted new defaults do not reassign an explicit writer.
- Notes root authority is `notes-root-resolver.ts`. Task roots are opaque and do not count against the user-root limit. Protect the managed `Plans` root. Keep every Tiptap package on one exact version, hoisted once at the root. Generic editor code belongs in `packages/tiptap-kit` (framework-free extensions, Markdown codec), `packages/tiptap-react` (React editor shell, toolbar, TOC panel, node views) or `packages/tiptap-embeds` (YouTube, map, PDF and paper-link embeds), with no CoC imports; CoC-specific editor code stays in `features/notes/editor/`.
- Canvas mutations use revision-checked `queue.runExclusive`. The file sandbox checks encoded and decoded shape, containment, and realpath. No file-write endpoint can escape the canvas.
- `canvasExtensions.enabled` is live and default off. One conversation shares one session workspace. Idle TTL defaults to 600000 ms. `session.send` queues and never steers. `session.mcp.list` reports configured servers (`pending`/`disabled`), never config or live status. `session.tools.getCurrentMetadata` reads the latest captured tool inventory (`null` before one) and never starts a provider. Disable and shutdown clear the declaration cache. Installed-canvas Reload (tool or desktop) retires only its workspace/conversation/extension runtime regardless of hash, then reopens saved open instances/input. Reload-only markers replace affected guests or show errors; normal opens preserve markers. Both channels carry `refreshOnly` to retain tab selection. Cancellation and owner revocation block late writes.
- Memory V2 tools default off. Honor `disabledLlmTools`. Keep memory scope gates independent of prompt context.
- PR creation goes through `create-pull-request-service.ts`. `gh` and `az` are the only CLIs that runner starts. Fetch and push use 600s and `GIT_TERMINAL_PROMPT=0`. Commit-mode conflicts abort. The active checkout never moves. Worktree execution does not force-delete branches.
- Patch reads share `withPatchRequest`. Abort or an unfinished response close cancels that read. A normal GET-body close does not. Abandoned reads cannot publish caches or start fallback work.
- Browser control is live and default off. Screenshots stay machine-local under `getRepoDataPath(..., 'browser-screenshots')` and are wiped, not exported. Frame refs are transient. `backgroundEnabled` pauses the 60s timer only while its Switch-back notice waits.
- Rich paste needs owning-server `browserControl.richPasteEnabled` (default on) and desktop `richPasteSupported`. Results acknowledge delivery, not editor persistence, and never echo the payload.
- Reviewed browser demos carry `browserDemo: { inputAllowed: false }` through admission. The relay rejects input, navigation, evaluation, and takeover before desktop dispatch. Keep the marker out of conversation metadata.
- Annotation chips, pin identity, and PNG bounds are owner-scoped. Page metadata stays out of command parsing. Over-limit sends retain the composer. Uncertain sends are not replayed. See [browser-demos.md](../../.github/skills/coc-knowledge/references/browser-demos.md) and [coc-desktop](../coc-desktop/AGENTS.md).
- Kusto auth is native Microsoft, Azure CLI, demand renewal. Empty `kusto.azureCli` selects active-account mode. Partial identity settings fail. Do not fall back or replay a query after `AuthError`.
- ADO uses the shared Forge native provider. Resolve identity from the current token and organization, not from Microsoft account ids. No bearer-token disk cache.

## Filesystem and search

- Whole-repo listing and content search require Rust `RepoFiles`. One handle per workspace. Dispose it on root change, removal, or shutdown. Health reports `nativeFileIndex` and `nativeContentSearch` from that same capability.
- Explorer deletion uses native `deleteEntry`, a physical workspace, and live default-on `features.explorerDelete`. Refresh indexes after any mutation. Never report success on failure. See `spa/client/react/features/repo-detail/AGENTS.md`.
- Workspace watches share `NativeWatchService`: one OS watch per real root. Workflow watchers share the workspace `.vscode` root and do not watch the repository root recursively.
- Quick Open uses the server index for the current root and `showIgnored` variant. Payload caps do not cap candidates. The fuzzy reference is `test/support/fuzzy-file-score.ts`.
- Register persisted families in `src/server/storage/snapshot/` and pass `test/server/snapshot-domain-contract.test.ts`.

## Messaging and secrets

- Separate normal messaging from container relays. Config is global. Receipts are workspace-scoped. Suppress own messages and history replay.
- Teams channel roots and replies bind the one Sentinel for that account, team, and channel. Missing owners fail closed. The fixed Teams grammar rejects repo, topic, and chat-id selection.
- Command grammar is `coc-connector/src/shared/commands.ts`. Unknown commands return help, never the AI. `git status` and `list todos` are read-only, do not change selection, and do not invoke AI.
- Plain WhatsApp text with no selected repo uses the Global workspace. `select repo` clears the topic. New chats run as `sentinel`. Do not hard-code a mode at enqueue. When the target is a Sentinel, `/ask`, `/autopilot`, and `/ralph` hand off a separate job and leave selection unchanged.
- Image batches: five images, 10 MB decoded, 30s, all-or-nothing. Captionless retention: five images, 30 minutes, 256 contexts. Restart requires resend. Failed queue admission deletes prepared files.
- `ask_user` from a messaging origin relays one question at a time. Approvals stay on the dashboard. Drafts cap at 32 KiB. Only exact `skip` skips.
- Teams MCP production auth is the connector's `TeamsOAuthCredential`. No Copilot-cache import. Generic MCP OAuth stays opt-in and does not cover native Teams resources. Only typed terminal rejections below HTTP 500 invalidate cache entries.
- IC3 needs an explicit `amer`, `emea`, or `apac`. Missing region fails before credentials or network. Never guess, fail over, or replay a write. Capture chat kind and thread root before enqueue. Do not infer kind from ids.
- Outbound compliance is server-wide, default off, and fail-closed. One decision, no output repair, no recheck on transport retry. Blocked text is not marked delivered and has no fallback send.
- Desktop Sentinel mirror is default off. Stage dashboard submits before canonical admission. The ledger is machine-local in `processes.db`, excluded from export, and cleared by wipe. At most four destinations run. Disabled workers do no reads. Never read SDK paths, paste references, or another server's files. See [server architecture](../../.github/skills/coc-knowledge/references/server-architecture.md#desktop-sentinel-mirror).
- MCP status and history expose allowlisted fields only. Never tokens, `env`, headers, full arguments, or provider bodies.

## Build

- Root `npm run build` builds workspaces. `npm run build -w packages/coc` runs this package. Node.js ≥ 24. Keep scripts cross-platform.
- `npm run test:run -w packages/coc -- test/server/<test>.test.ts`. `test:run` is non-watch. `test` is watch mode.
- Playwright workers default to `min(4, cores)` via `test/e2e/playwright-workers.ts`. Check memory before raising `--workers`.
- Docker changes keep `test/docker/` green: loopback bind, no published CoC port, `COC_BUILD_COMMIT` without `.git`.
