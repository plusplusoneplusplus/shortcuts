---
feature: agent-provider-models
status: ready-for-ralph
---

# Agent Provider Models

## Goal

[decision] Move model catalog, model enablement, reasoning-effort selection, and model test-query behavior out of the standalone Models page/API and into the Agent Provider page, because each agent provider has its own supported model catalog.

[decision] The standalone `#models` route and old global `/api/models*` REST surface are removed. Model-related UI and API behavior becomes provider-scoped across Copilot, Codex, and Claude.

## Functional Acceptance Criteria

1. [decision] AC-01: Remove the standalone Models page from dashboard navigation and routing.
2. [decision] AC-02: Replace global model REST/config behavior with provider-scoped Agent Provider model APIs and persisted settings.
3. [decision] AC-03: Embed provider-specific model catalog/config/query UX in the non-container Agent Provider page.
4. [decision] AC-04: Update all model consumers to use the relevant provider catalog and provider-scoped defaults.
5. [decision] AC-05: Update tests, typed client contracts, and documentation references so no old `/api/models*` usage remains.

## Out of Scope

- [decision] Adding any new agent provider beyond existing Copilot, Codex, and Claude.
- [decision] Changing SDK session lifecycle, adding SDK keep-alive caches, or adding `sendFollowUp` behavior.
- [decision] Editing or reasoning about `packages/vscode-extension/`.
- [decision] Redesigning non-agent credential providers such as GitHub, Azure DevOps, or Tavily.
- [decision] Changing provider authentication flows except where the Agent Provider page needs to show existing setup/auth/install states.
- [decision] Supporting the old `#models` route or old `/api/models*` endpoints as compatibility aliases.

## Constraints / Tech Context

- [decision] CoC multi-repo behavior must stay intact. Per-repo preferences remain repo-scoped and must use existing per-repo preference storage under `~/.coc/repos/<workspaceId>/`.
- [decision] Model catalog state is provider-scoped. Copilot, Codex, and Claude must not share enabled-model lists, reasoning-effort overrides, or default-model preferences.
- [decision] Existing global `models.enabled` and `models.reasoningEfforts` config values are migrated/read as Copilot provider settings, then future writes persist only the new provider-scoped shape.
- [decision] Provider-scoped model behavior ships as the default replacement. Do not hide it behind a disabled feature flag.
- [decision] Disabled, uninstalled, or unauthenticated optional providers show setup/auth/install UI instead of attempting noisy catalog loads.
- [decision] Query/test prompts run against the selected provider in the Agent Provider page without changing `activeProvider`.
- [assumption] Existing per-repo `defaultModel` / `defaultModels` values are treated as Copilot defaults during migration/read; future writes use provider-scoped default-model preferences.
- [assumption] Provider model metadata caches are metadata-only and may be provider-keyed; they must not cache SDK sessions or provider process handles.

## References to Load

- `AGENTS.md`
- `packages/coc/AGENTS.md`
- `.github/skills/coc-knowledge/references/dashboard-spa.md`
- `.github/skills/coc-knowledge/references/admin-config.md`
- `.github/skills/coc-knowledge/references/rest-api.md`
- `.github/skills/coc-knowledge/references/server-architecture.md`
- `.github/skills/coc-knowledge/references/sdk-wrapper.md`
- `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx`
- `packages/coc/src/server/spa/client/react/features/models/ModelsView.tsx`
- `packages/coc/src/server/spa/client/react/hooks/useModels.ts`
- `packages/coc/src/server/spa/client/react/hooks/useAgentProviders.ts`
- `packages/coc/src/server/spa/client/react/hooks/useDefaultModelForMode.ts`
- `packages/coc/src/server/spa/client/react/features/chat/hooks/useModelCommand.ts`
- `packages/coc/src/server/agent-providers/agent-providers-routes.ts`
- `packages/coc/src/server/models/model-routes.ts`
- `packages/coc/src/server/routes/index.ts`
- `packages/coc/src/server/routes/queue-enqueue.ts`
- `packages/coc-agent-sdk/src/sdk-service-interface.ts`
- `packages/coc-agent-sdk/src/model-metadata-store.ts`
- `packages/coc-client/src/contracts/admin.ts`
- `packages/coc-client/src/contracts/common.ts`
- `packages/coc-client/src/domains/agent-providers.ts`
- `packages/coc-client/src/domains/models.ts`

## Dependency Graph

- AC-02 depends on AC-01 route/API ownership decisions.
- AC-03 depends on AC-02 provider-scoped API contracts.
- AC-04 depends on AC-02 provider-scoped catalog/default resolution.
- AC-05 depends on AC-01 through AC-04.

## AC-01: Remove standalone Models page

### Behavior

1. [decision] The Admin sidebar no longer shows a separate "Models" item under Configure.
2. [decision] The dashboard no longer treats `models` as an embedded Admin tool route.
3. [decision] Navigating directly to `#models` does not preserve or redirect to the old Models page. It falls back through the normal unknown/default dashboard routing behavior.
4. [decision] The Agent Provider page is the only dashboard location for model catalog/config/query UI.

### Surfaces

- [assumption] `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx`
- [assumption] Dashboard tab/router types that currently include `models`
- [assumption] Admin navigation tests under `packages/coc/test/spa/`
- [assumption] Dashboard knowledge docs under `.github/skills/coc-knowledge/references/`

### API Contract

No new API is introduced by this AC. The old route is removed from UI routing only; REST removal is handled by AC-02.

### Data Model

No persistent state change.

### UX States

- [decision] Normal Admin navigation shows Configure entries without a standalone Models row.
- [decision] Non-container Agent Provider page remains visible as the place to manage providers and models.
- [assumption] Container mode keeps its existing Connected Agents page behavior and does not receive provider model management in this slice.

### Edge Cases & Failure Modes

- [decision] Direct `#models` links are not supported for compatibility.
- [assumption] Tests should assert the `models-toggle` nav row and embedded `admin-tool-embed-models` no longer exist.

### Definition of Done

1. Manual demo: start the dashboard, open Admin, confirm Configure has no Models row, confirm Agent Provider is visible in non-container mode, and confirm `#models` no longer opens the old Models grid.
2. Test commands include the relevant Admin navigation/router tests, for example `cd packages/coc && npm run test:run -- test/spa/admin/AdminPanel.nav.test.ts test/spa/react/admin/AdminPanel-responsive.test.ts`.
3. Code-search assertions: no `models-toggle`; no `admin-tool-embed-models`; no `activeToolItem.tab === 'models'`.

## AC-02: Provider-scoped model APIs and settings

### Behavior

1. [decision] Model APIs move from global `/api/models*` routes to provider-scoped Agent Provider routes.
2. [decision] Each provider exposes its own model catalog from its own `ISDKService.listModels()` implementation.
3. [decision] Copilot, Codex, and Claude each have separate enabled-model lists and reasoning-effort overrides.
4. [decision] Old global `models.enabled` and `models.reasoningEfforts` are migrated/read as Copilot settings, then writes use provider-scoped config only.
5. [decision] The old `/api/models`, `/api/models/enabled`, `/api/models/reasoning-efforts`, and `/api/models/query` routes are removed.

### Surfaces

- [assumption] `packages/coc/src/server/agent-providers/agent-providers-routes.ts`
- [assumption] `packages/coc/src/server/models/model-routes.ts` is removed or reduced to dead-code-free deletion.
- [assumption] `packages/coc/src/server/routes/index.ts`
- [assumption] `packages/coc/src/config.ts`
- [assumption] `packages/coc/src/config/schema.ts`
- [assumption] `packages/coc/src/config/namespace-registry.ts`
- [assumption] `packages/coc/src/server/admin/admin-config-fields.ts` only if editable config fields need registry support.
- [assumption] `packages/coc-agent-sdk/src/model-metadata-store.ts`
- [assumption] `packages/coc-client/src/contracts/admin.ts`
- [assumption] `packages/coc-client/src/contracts/common.ts`
- [assumption] `packages/coc-client/src/domains/agent-providers.ts`
- [assumption] Remove or replace `packages/coc-client/src/domains/models.ts`.

### API Contract

[decision] Add provider-scoped Agent Provider model endpoints:

```json
GET /api/agent-providers/:provider/models
{
  "provider": "copilot",
  "models": [
    {
      "id": "gpt-5.5",
      "name": "GPT-5.5",
      "enabled": true,
      "capabilities": {},
      "supportedReasoningEfforts": ["low", "medium", "high"],
      "defaultReasoningEffort": "medium"
    }
  ]
}
```

```json
GET /api/agent-providers/:provider/models/enabled
{ "provider": "copilot", "enabledModels": ["gpt-5.5"] }
```

```json
PUT /api/agent-providers/:provider/models/enabled
{ "enabledModels": ["gpt-5.5"] }
```

```json
GET /api/agent-providers/:provider/models/reasoning-efforts
{
  "provider": "copilot",
  "reasoningEfforts": { "gpt-5.5": "high" }
}
```

```json
PUT /api/agent-providers/:provider/models/reasoning-efforts
{ "modelId": "gpt-5.5", "effort": "high" }
```

```json
POST /api/agent-providers/:provider/models/query
{ "prompt": "Say hello", "model": "gpt-5.5", "timeoutMs": 60000 }
```

```json
{
  "success": true,
  "provider": "copilot",
  "response": "Hello.",
  "model": "gpt-5.5",
  "sessionId": "session-id",
  "durationMs": 1234
}
```

[decision] `:provider` only accepts `copilot`, `codex`, or `claude`; invalid providers return 400 or 404 consistently with existing route patterns.

[decision] Disabled/unavailable optional providers return a structured unavailable response or error that the SPA can render as setup/auth/install state; they do not silently fall back to Copilot.

### Data Model

[decision] Replace the global model config shape with provider-scoped settings:

```json
{
  "models": {
    "providers": {
      "copilot": {
        "enabled": ["gpt-5.5"],
        "reasoningEfforts": { "gpt-5.5": "high" }
      },
      "codex": {
        "enabled": [],
        "reasoningEfforts": {}
      },
      "claude": {
        "enabled": [],
        "reasoningEfforts": {}
      }
    }
  }
}
```

[assumption] If a provider has no enabled-model list, the UI may treat the provider catalog as selectable for query/defaults while the execution layer applies existing "no explicit model" provider default behavior.

### UX States

Handled by AC-03; server must provide enough status/error data for loading, unavailable, success, and failure states.

### Edge Cases & Failure Modes

- [decision] Provider-specific catalog failure is shown for that provider only and does not poison other provider catalogs.
- [decision] A disabled provider cannot be queried through its provider-scoped query endpoint.
- [decision] An unsupported reasoning effort for a provider/model returns a validation error instead of being persisted.
- [assumption] Static fallback models are allowed for Copilot only when its live model metadata is unavailable, matching current behavior.

### Definition of Done

1. Manual demo: use HTTP requests against provider-scoped endpoints for Copilot; verify the old `/api/models*` endpoints are absent; enable/disable a Copilot model and verify the persisted config shape is provider-scoped.
2. Test commands include model and provider route tests, for example `cd packages/coc && npm run test:run -- test/server/agent-providers.test.ts test/server/model-routes.test.ts test/server/model-metadata-store-startup.test.ts`.
3. Code-search assertions: no server route pattern starts with `/api/models`; no SPA or client code calls `transport.request(...'/models`; no global `models.enabled` write path remains except migration/read handling.

## AC-03: Agent Provider model UX

### Behavior

1. [decision] The non-container Agent Provider page uses provider cards/tabs for Copilot, Codex, and Claude.
2. [decision] Selecting a provider shows provider status, install/auth/config controls, quota/status where already available, and a nested Models section.
3. [decision] The nested Models section preserves the useful parts of the old Models page: catalog/search, capability filters, enabled toggles, context window display, reasoning-effort badges, copy model id, refresh, and query/test prompt UI.
4. [decision] Query/test prompt runs against the selected provider without changing `activeProvider`.
5. [decision] Disabled, uninstalled, or unauthenticated providers show setup/auth/install state instead of loading the model catalog.

### Visual Design

[decision] Use a single Agent Provider page with:

1. Provider selector row: compact cards or tabs for Copilot, Codex, and Claude, each showing enabled/available/install/auth status.
2. Provider details card: existing enable/install/auth/active-provider controls remain near the top.
3. Models section inside the selected provider: header with provider label, refresh button, search input, capability filter, model count, enabled count, and setup-state banner when unavailable.
4. Catalog view: responsive card grid based on the old `ModelsView` model card behavior.
5. Query view: prompt input, provider-scoped model selector, run button, and result/error panel.

[assumption] Use existing Admin redesign primitives and CSS classes rather than adding Tailwind-heavy or standalone styling.

### Surfaces

- [assumption] `packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx`
- [assumption] `packages/coc/src/server/spa/client/react/features/models/ModelsView.tsx`, likely refactored into provider-aware reusable components.
- [assumption] `packages/coc/src/server/spa/client/react/hooks/useModels.ts`, likely replaced by provider-aware hooks.
- [assumption] `packages/coc/src/server/spa/client/react/hooks/useAgentProviders.ts`
- [assumption] `packages/coc/src/server/spa/client/react/admin/admin-redesign.css`
- [assumption] SPA tests under `packages/coc/test/spa/`

### API Contract

Consumes AC-02 provider-scoped endpoints only.

### Data Model

Consumes AC-02 provider-scoped settings only.

### UX States

- [decision] Loading: selected provider model section shows a compact loading state.
- [decision] Empty: provider is available but returns no models; show an actionable empty state.
- [decision] Unavailable: provider disabled/not installed/unauthenticated; show existing setup/auth/install controls and do not show a failed catalog grid.
- [decision] Error: provider-specific model load/query/save error appears inside that provider's Models section.
- [decision] Saving: enabled toggles and reasoning-effort writes use optimistic UI only if failures revert visibly.
- [decision] Disabled-by-provider: query and toggles are disabled until the selected provider is available.

### Edge Cases & Failure Modes

- [decision] Changing provider tabs does not lose unsaved active-provider enablement changes without existing dirty-state behavior handling it.
- [decision] Querying a provider model does not modify active provider, per-repo defaults, or enabled-model lists.
- [assumption] Clipboard-copy failure can remain non-fatal, matching current model card behavior.

### Definition of Done

1. Manual demo: open Admin -> Agent Provider, switch between Copilot/Codex/Claude provider tabs/cards, see provider-specific setup or model catalog states, toggle a model for an available provider, select reasoning effort, and run a query against a selected provider model without changing Active Provider.
2. Test commands include provider UI and model hook tests, for example `cd packages/coc && npm run test:run -- test/spa/react/hooks/useModels.test.ts test/spa/hooks/useModels.test.ts test/spa/react/admin/AdminPanel-responsive.test.ts`.
3. Code-search assertions: `ModelsView` is not mounted as `activeToolItem.tab === 'models'`; provider model hooks call `agentProviders` client methods, not the removed `models` client domain.

## AC-04: Provider-aware model consumers and defaults

### Behavior

1. [decision] All model consumers that currently depend on the global model list are updated to use the active or explicitly selected provider catalog.
2. [decision] Chat model picker and `/model` command show models supported by the active provider.
3. [decision] Queue model endpoints return active-provider model ids and do not expose unsupported models for the active provider.
4. [decision] Per-repo default model preferences become provider-scoped by provider and mode.
5. [decision] Model resolution does not select a saved default from another provider.

### Surfaces

- [assumption] `packages/coc/src/server/spa/client/react/hooks/useDefaultModelForMode.ts`
- [assumption] `packages/coc/src/server/spa/client/react/features/chat/hooks/useModelCommand.ts`
- [assumption] Chat composer/model picker components that consume model hooks.
- [assumption] `packages/coc/src/server/routes/queue-enqueue.ts`
- [assumption] Executor model resolution near per-repo preferences.
- [assumption] Per-repo preferences contracts in `packages/coc-client`.

### API Contract

[assumption] Existing non-`/api/models*` endpoints may gain provider awareness rather than being removed:

```json
GET /api/queue/models
{ "provider": "copilot", "models": ["gpt-5.5"] }
```

[assumption] If an endpoint accepts an optional provider parameter, invalid providers must fail explicitly and must not fall back to Copilot.

### Data Model

[decision] Provider-scoped per-repo default model preferences should support at least provider + mode:

```json
{
  "defaultModelsByProvider": {
    "copilot": {
      "ask": "gpt-5.5",
      "plan": "gpt-5.5",
      "autopilot": "gpt-5.5"
    },
    "codex": {
      "ask": "codex-provider-default"
    },
    "claude": {
      "ask": "claude-provider-default"
    }
  }
}
```

[assumption] Existing `defaultModel` / `defaultModels` fields are read as Copilot defaults when provider-scoped values are absent, then future writes use provider-scoped fields.

### Model Resolution

[decision] Update model resolution order to include provider scope:

1. Explicit `task.config.model`.
2. `PerRepoPreferences.defaultModelsByProvider[activeProvider][mode]`.
3. `PerRepoPreferences.defaultModelByProvider[activeProvider]`, if implemented.
4. Legacy `defaultModels[mode]` / `defaultModel` only as Copilot migration fallback.
5. Provider default (`undefined` model).

### UX States

- [decision] If active provider has no available catalog, model pickers show provider setup/unavailable messaging rather than cross-provider models.
- [decision] If a saved default is not in the active provider catalog, it is ignored or surfaced as invalid; it must not be sent blindly.

### Edge Cases & Failure Modes

- [decision] Switching active provider does not reuse another provider's stale model selection.
- [decision] Queue/autopilot/plan execution must not fail because a default from another provider was selected automatically.
- [assumption] Explicit `task.config.model` remains caller responsibility; if unsupported by the selected provider, provider invocation may fail with a clear provider error.

### Definition of Done

1. Manual demo: set different default models for Copilot and another available provider in the same workspace, switch active provider, and confirm chat/default model UI changes to the active provider's catalog without showing unsupported models.
2. Test commands include model command/default hook and queue model tests, for example `cd packages/coc && npm run test:run -- test/server/spa/client/repos/useModelCommand.test.ts test/spa/react/hooks/useDefaultModelForMode.test.ts`.
3. Code-search assertions: no model picker imports the removed global models client; model resolution tests cover provider-specific defaults and legacy Copilot fallback.

## AC-05: Tests, docs, and cleanup

### Behavior

1. [decision] Tests cover provider-scoped APIs, UI navigation removal, Agent Provider model UX, provider-specific model consumers, and migration/read behavior.
2. [decision] Typed client contracts expose Agent Provider model methods and no longer expose the removed global models domain for SPA use.
3. [decision] Documentation and knowledge references reflect that models are now part of Agent Provider, not a standalone Admin tool.

### Surfaces

- [assumption] `packages/coc-client/src/client.ts`
- [assumption] `packages/coc-client/src/domains/agent-providers.ts`
- [assumption] `packages/coc-client/src/domains/models.ts`
- [assumption] `packages/coc-client/src/contracts/admin.ts`
- [assumption] `packages/coc-client/src/contracts/common.ts`
- [assumption] `.github/skills/coc-knowledge/references/dashboard-spa.md`
- [assumption] `.github/skills/coc-knowledge/references/rest-api.md`
- [assumption] `.github/skills/coc-knowledge/references/sdk-wrapper.md`

### API Contract

No additional API beyond AC-02 and AC-04.

### Data Model

No additional data model beyond AC-02 and AC-04.

### UX States

No additional UX states beyond AC-03 and AC-04.

### Edge Cases & Failure Modes

- [decision] Removing global model routes should not leave broken imports, dead lazy imports, or stale Admin breadcrumb/group labels.
- [decision] Docs must not claim `#models` or `GET /api/models` exists.

### Definition of Done

1. Manual demo: complete AC-01 through AC-04 demos in one dashboard session.
2. Test commands: `npm run build`; `cd packages/coc && npm run test:run` or a narrower maintained equivalent that includes all touched server, client, and SPA tests.
3. Code-search assertions: no `/api/models` route docs; no `#models` docs except removal/migration notes if needed; no stale `models-toggle`; no old global models client used by SPA.

## Open Questions

None.

## Ready-for-Ralph Checklist

- [x] every functional AC has a Definition of Done
- [x] no `[open]` items remain, or `open-questions.md` exists
- [x] dependency graph has no cycles
- [x] `## References to Load` lists the cross-cutting docs the implementer needs
