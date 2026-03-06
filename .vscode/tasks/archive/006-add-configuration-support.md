---
status: done
---

# 006: Add Configuration Support for Follow-Up Suggestions

## Summary

Add `chat.followUpSuggestions` config section to `~/.coc/config.yaml` so users can enable/disable follow-up suggestion generation and control the number of suggestions returned. The coc layer checks this config before deciding whether to pass the suggestion tool to the SDK.

## Motivation

Configuration support is a separate commit because the tool and UI already work end-to-end (commits 001–005). This commit adds the user-facing control plane without touching the tool implementation or client rendering. It keeps the config schema change, validation, merge logic, and executor gating in a single reviewable unit.

## Changes

### Files to Create
- None

### Files to Modify

- **`packages/coc/src/config.ts`** — Add `chat` nested object to `CLIConfig` and `ResolvedCLIConfig` interfaces; add defaults to `DEFAULT_CONFIG`; update `mergeConfig()` to merge the nested `chat.followUpSuggestions` fields; add `chat.followUpSuggestions.enabled` and `chat.followUpSuggestions.count` to `CONFIG_SOURCE_KEYS` array and update `getFieldSource()` to handle the `chat.followUpSuggestions.*` prefix.

- **`packages/coc/src/config/schema.ts`** — Add `chat` object with nested `followUpSuggestions` object to `CLIConfigSchema`. The `followUpSuggestions` sub-object has `enabled: z.boolean().optional()` and `count: z.number().int().min(1).max(5).optional()`. Use `.strict()` on both nested objects to reject unknown keys.

- **`packages/coc/src/server/queue-executor-bridge.ts`** — In `CLITaskExecutor`, accept a new `chat` config option (or full `ResolvedCLIConfig`) in the constructor options. In `executeWithAI()` and `executeFollowUp()`, check `config.chat.followUpSuggestions.enabled`; if `false`, add the suggestion tool name to `excludedTools` in `sendMessage`/`sendFollowUp` options. Pass `config.chat.followUpSuggestions.count` as context so the tool knows how many suggestions to generate (e.g., include it in the system prompt suffix or as a tool parameter).

- **`packages/coc/src/server/index.ts`** — Pass the resolved `chat` config from `resolveConfig()` into `MultiRepoQueueExecutorBridge` / `CLITaskExecutor` options so the executor has access to the config at runtime.

- **`packages/coc/src/server/admin-handler.ts`** — Add `chat.followUpSuggestions.enabled` and `chat.followUpSuggestions.count` to the PUT validation logic so the admin API can update these fields (mirror how `showReportIntent` is validated as boolean and `parallel`/`timeout` are validated as numbers with range checks). Add `'chat.followUpSuggestions.enabled'` and `'chat.followUpSuggestions.count'` to the set of editable fields.

- **`packages/coc/src/server/spa/client/react/admin/AdminPanel.tsx`** — Add a new "Chat" section in the admin config panel (after the existing "Serve" read-only section). The section renders:
  1. A toggle checkbox for `chat.followUpSuggestions.enabled` (same pattern as `showReportIntent` toggle at ~lines 429–453) with a `SourceBadge` showing whether the value comes from file or default.
  2. A number input for `chat.followUpSuggestions.count` (same pattern as `parallel`/`timeout` inputs at ~lines 380–410) with min=1, max=5, and a `SourceBadge`.
  3. Both fields should be editable and save via the existing PUT `/api/admin/config` handler when the "Save" button is clicked.
  4. The section header should read "Chat" with a subtitle "Follow-up suggestion settings".

### Files to Delete
- None

## Implementation Notes

### Config Schema

```yaml
# ~/.coc/config.yaml
chat:
  followUpSuggestions:
    enabled: true   # boolean, default: true
    count: 3        # number, default: 3, range: 1–5
```

### Type Definitions

In `CLIConfig` (partial/optional):
```typescript
chat?: {
    followUpSuggestions?: {
        enabled?: boolean;
        count?: number;
    };
};
```

In `ResolvedCLIConfig` (fully resolved with defaults):
```typescript
chat: {
    followUpSuggestions: {
        enabled: boolean;
        count: number;
    };
};
```

### Default Values

Add to `DEFAULT_CONFIG`:
```typescript
chat: {
    followUpSuggestions: {
        enabled: true,
        count: 3,
    },
},
```

### Merge Logic

Follow the existing `serve` pattern in `mergeConfig()`:
```typescript
chat: {
    followUpSuggestions: {
        enabled: override.chat?.followUpSuggestions?.enabled ?? base.chat.followUpSuggestions.enabled,
        count: override.chat?.followUpSuggestions?.count ?? base.chat.followUpSuggestions.count,
    },
},
```

### Config Source Tracking

Add two new keys to `CONFIG_SOURCE_KEYS`:
```typescript
'chat.followUpSuggestions.enabled', 'chat.followUpSuggestions.count'
```

Update `getFieldSource()` to handle the `chat.followUpSuggestions.` prefix:
```typescript
if (key.startsWith('chat.followUpSuggestions.')) {
    const subKey = key.slice('chat.followUpSuggestions.'.length);
    return fileConfig.chat?.followUpSuggestions?.[subKey] !== undefined ? 'file' : 'default';
}
```

### Executor Gating

In `CLITaskExecutor`, the constructor already receives options. Add `followUpSuggestions?: { enabled: boolean; count: number }` to the options interface. Store it as a field.

In `executeWithAI()` where `this.aiService.sendMessage({...})` is called (line ~608), gate the suggestion tool:
```typescript
const msgOptions: SendMessageOptions = {
    prompt,
    model: task.config.model,
    // ... existing options ...
};
if (!this.followUpSuggestions.enabled) {
    msgOptions.excludedTools = [...(msgOptions.excludedTools || []), 'suggest_follow_ups'];
}
```

Similarly in `executeFollowUp()` where `this.aiService.sendFollowUp()` is called (line ~331).

### Passing Count to the Tool

The suggestion count is not a `sendMessage` option — it belongs in the prompt or tool definition. Two approaches:
1. **Prompt injection** (preferred for this commit): Append a line to the system prompt like `"When suggesting follow-ups, provide exactly {count} suggestions."` This is simpler and keeps the tool definition generic.
2. **Tool parameter**: If the tool accepts a `count` parameter, pass it when registering. This requires pipeline-core changes and is out of scope for this commit.

Use approach 1: if suggestions are enabled, append a count instruction to the prompt in `executeWithAI()` and the follow-up message in `executeFollowUp()`.

### Bridge Wiring

In `packages/coc/src/server/index.ts`, the resolved config is already available (line 160). Pass the `chat` section through the bridge options:
```typescript
const bridge = new MultiRepoQueueExecutorBridge(registry, store, {
    // ...existing options...
    followUpSuggestions: resolvedConfig.chat.followUpSuggestions,
});
```

The `MultiRepoQueueExecutorBridge` forwards this to each per-repo `CLITaskExecutor`.

## Tests

### Unit Tests — Config

- **`packages/coc/test/config.test.ts`** (extend existing):
  - `chat.followUpSuggestions defaults to { enabled: true, count: 3 }` when no config file exists
  - `mergeConfig overrides chat.followUpSuggestions.enabled from file`
  - `mergeConfig overrides chat.followUpSuggestions.count from file`
  - `mergeConfig preserves defaults when chat section is absent`
  - `getResolvedConfigWithSource reports 'file' source for chat.followUpSuggestions.enabled when set`
  - `getResolvedConfigWithSource reports 'default' source for chat.followUpSuggestions.count when not set`

### Unit Tests — Schema Validation

- **`packages/coc/test/config/schema.test.ts`** (extend existing):
  - `validates chat.followUpSuggestions.enabled as boolean`
  - `rejects chat.followUpSuggestions.enabled as string`
  - `validates chat.followUpSuggestions.count in range 1-5`
  - `rejects chat.followUpSuggestions.count = 0`
  - `rejects chat.followUpSuggestions.count = 6`
  - `rejects unknown keys inside chat.followUpSuggestions (strict mode)`

### Unit Tests — Executor Gating

- **`packages/coc/test/server/queue-executor-bridge.test.ts`** (extend existing):
  - `excludes suggestion tool from sendMessage when followUpSuggestions.enabled is false`
  - `does not exclude suggestion tool when followUpSuggestions.enabled is true (default)`
  - `appends count instruction to prompt when suggestions are enabled`
  - `does not append count instruction when suggestions are disabled`
  - `excludes suggestion tool from sendFollowUp when disabled`

### Unit Tests — Admin API

- **`packages/coc/test/server/admin-handler.test.ts`** (extend existing):
  - `PUT /api/admin/config with chat.followUpSuggestions.enabled=false saves to config file`
  - `PUT /api/admin/config with chat.followUpSuggestions.count=2 saves to config file`
  - `PUT /api/admin/config rejects chat.followUpSuggestions.count=0 with validation error`
  - `PUT /api/admin/config rejects chat.followUpSuggestions.count=6 with validation error`
  - `GET /api/admin/config returns chat.followUpSuggestions with source indicators`

### Unit Tests — Admin Panel UI

- **`packages/coc/test/server/spa/admin/AdminPanel.test.tsx`** (extend or create):
  - `renders Chat section with enabled toggle and count input`
  - `enabled toggle reflects config value from GET /api/admin/config`
  - `count input reflects config value and has min=1 max=5`
  - `toggling enabled and clicking Save sends PUT with updated chat.followUpSuggestions.enabled`
  - `SourceBadge shows correct source for each chat config field`

## Acceptance Criteria

- [ ] `~/.coc/config.yaml` with `chat.followUpSuggestions.enabled: false` prevents the suggestion tool from being passed to the SDK
- [ ] `~/.coc/config.yaml` with `chat.followUpSuggestions.count: 2` results in the AI being instructed to generate 2 suggestions
- [ ] Omitting the `chat` section entirely defaults to enabled=true, count=3
- [ ] Invalid config values (count=0, count=10, enabled="yes") are rejected by schema validation with clear error messages
- [ ] Admin API (`GET /api/admin/config`) returns the resolved `chat.followUpSuggestions` fields with correct source indicators
- [ ] Admin panel at `http://localhost:4000/#admin` shows a "Chat" section with an enabled toggle and count input, both editable and saveable
- [ ] All existing tests continue to pass (no regressions from new config fields)

## Dependencies

- Depends on: 004 (the suggestion tool must be registered in the SDK tool set), 005 (client UI renders chips from suggestion data)

## Assumed Prior State

Suggestion tool is wired into the chat executor and the SDK invokes it during response generation (commit 004). The client-side UI parses suggestion data from the response and renders clickable chips (commit 005). Config system exists in `packages/coc/src/config.ts` with Zod schema validation, merge logic, source tracking, and admin API exposure. The `CLITaskExecutor` in `queue-executor-bridge.ts` calls `sendMessage()` and `sendFollowUp()` with `SendMessageOptions` which already support `excludedTools` for tool filtering.
