# [AGENTS.md](http://AGENTS.md)

Guidance for AI agents working in this repository. NEVER create document files unless explicitly asked.

## Key Design Choice (Maintained manually, AI should NEVER update this section)

-   CoC:
    
    -   multi-repo support is required. Never design or implement a feature that would break multi-repo scenario.
    -   copilot-sdk wrapper should NEVER add a sendFollowUp method or something similar. copilot-sdk-wrapper layer or above should NEVER try to add keep-alive/session-object cache.
    -   Prefer use file path in the prompt instead of expanding the prompt with file's content.

## Required reading

For any CoC, architecture, convention, or build/test/release work, load [coc-knowledge](.github/skills/coc-knowledge/SKILL.md) and its relevant references before responding or editing. Follow their detailed contracts; this file keeps only the core rules.

Node.js ≥ 24; npm workspaces for workflow, server, Forge, clients/SDK, memory, container, and Teams/WhatsApp connectors. Docker ships `ghcr.io/plusplusoneplusplus/coc`, bound to loopback.

## Core rules

-   **Implementation:** make the smallest code change that fully achieves the goal. Prefer simple solutions and existing patterns; avoid unrelated edits and unnecessary abstractions.
-   **Git:** never switch branches or detach HEAD. Preserve unrelated edits; destructive actions require explicit approval.

-   **Writes and links:** mutate work items through the workspace REST API, never JSON files. Saved-plan links use exact absolute paths, forward slashes, and angle-bracket destinations; preserve access checks.
-   **Shared infrastructure:** use `createPatchDiffProvider`, Forge SSE, and `createProcessEventBus()`. Preserve transport/rendering contracts. Diff authentication stays in TypeScript; refresh/disposal revoke pending Rust results. Cancellation affects one request, never shared stores; clean up resources and preserve errors.
-   **Runtime:** never cache sessions or add `sendFollowUp`. Only client processes may stay warm, scoped by provider/workdir with bounded idle lifetime and cleanup on failure/disposal. Codex compaction has no wall-clock deadline; unrelated deadlines stay bounded.
-   **Models:** task model > per-repo mode model > default model > CLI default.
-   **Dependencies:** pin Copilot SDK/CLI and disable child CLI auto-update. Production audits stay strict; reviewed development-only exceptions expire when fixes exist.
-   **Credentials:** preserve selected-account identity, credential precedence, and OAuth storage policy; never silently fall back to ambient credentials or another account. Host Teams tokens stay ephemeral. Generic MCP OAuth requires opt-in; native Teams sign-in remains available. CoC child Entra defaults permit unbound scopes; explicit overrides win. Test real credential storage without touching unrelated keys.

## Desktop and browser rules

-   **Ownership:** settings/profiles/history are installation-wide; control is scoped to the exact owner/workspace/view/session. Electron is default; WebView2 is Windows x64 opt-in. Engine changes affect new views; confirmed cleanup preserves other engines and previews.
-   **Isolation:** sandbox webviews with exact-source, owner-bound, single-use attachments and main-validated file paths. Keep debugger transport in main. HTML previews and extension guests use isolated sessions and stay outside URL history/control; retain guests across workspace remounts.
-   **History:** main records committed URL navigation, including popups; titles and replay cannot create entries. Serialize atomic saves, expose failures, drain on shutdown, and restrict IPC to registered SPA main frames.
-   **Input:** serialize complete sequences per view with cancellation and bounded execution; finish dispatched releases. Background work must not steal focus or selection. Screen-required actions wait for the user with deadlines paused. Frame refs expire with document changes; unsupported runtimes fail without weakening security.
-   **Consent:** clipboard replacement requires consent. Site approval gates agent main-frame navigation and redirects; server owns temporary/persistent decisions. Approval waits pause deadlines; cancellation denies pending loads. Human takeover pauses one turn in memory; return validates fresh context. Never replay unknown input outcomes or persist handoff sessions.
-   **Upgrades:** keep manual downloads independent of auto-update, matched to release/platform/architecture and opened through validated system-browser URLs. Windows installer helpers must survive shutdown and have real-process regression coverage.

<p>&nbsp;</p>
