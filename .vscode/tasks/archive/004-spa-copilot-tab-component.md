---
status: pending
---

# 004: SPA — RepoCopilotTab Component with MCP Server Toggles

## Summary

Create a new `RepoCopilotTab` React component that fetches the workspace's MCP config via `GET /api/workspaces/:id/mcp-config`, renders each available server as a named toggle with its type label, and calls `PUT /api/workspaces/:id/mcp-config` on every toggle change. Wire the tab into `RepoDetail` as a new `'copilot'` sub-tab.

## Motivation

Commits 001–003 added the data model and API endpoints for per-repo MCP server filtering. This commit exposes those endpoints in the SPA so users can enable/disable individual MCP servers per workspace without leaving the dashboard.

## Changes

### Files to Create

#### `packages/coc/src/server/spa/client/react/repos/RepoCopilotTab.tsx`

New component.

**Props interface:**
```ts
interface RepoCopilotTabProps {
  workspaceId: string;
}
```

**State:**
```ts
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [saving, setSaving] = useState(false);
// Shape comes from the GET response defined in commits 001/002
const [availableServers, setAvailableServers] = useState<McpServerEntry[]>([]);
const [enabledMcpServers, setEnabledMcpServers] = useState<string[] | null>(null);
```

Where `McpServerEntry` is a local inline type:
```ts
type McpServerEntry = { name: string; type: 'stdio' | 'sse' };
```

**Data fetch (useEffect on workspaceId):**
```ts
useEffect(() => {
  setLoading(true);
  setError(null);
  fetchApi(`/workspaces/${workspaceId}/mcp-config`)
    .then((data) => {
      setAvailableServers(data.availableServers ?? []);
      setEnabledMcpServers(data.enabledMcpServers ?? null);
    })
    .catch((e) => setError(e.message ?? 'Failed to load MCP config'))
    .finally(() => setLoading(false));
}, [workspaceId]);
```

**Toggle handler:**
```ts
const handleToggle = async (serverName: string, checked: boolean) => {
  // Compute next enabled list; null means "all enabled"
  const allNames = availableServers.map((s) => s.name);
  const currentList = enabledMcpServers ?? allNames;
  const nextList = checked
    ? [...new Set([...currentList, serverName])]
    : currentList.filter((n) => n !== serverName);
  // If all servers would be enabled, normalise to null
  const nextValue = nextList.length === allNames.length ? null : nextList;
  setEnabledMcpServers(nextValue); // optimistic update
  setSaving(true);
  try {
    await fetchApi(`/workspaces/${workspaceId}/mcp-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledMcpServers: nextValue }),
    });
  } catch (e: any) {
    setError(e.message ?? 'Failed to save');
    // revert on error
    setEnabledMcpServers(enabledMcpServers);
  } finally {
    setSaving(false);
  }
};
```

**isEnabled helper:**
```ts
const isEnabled = (name: string) =>
  enabledMcpServers === null || enabledMcpServers.includes(name);
```

**JSX structure:**
```tsx
<div className="p-4 space-y-4">
  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
    MCP Servers
  </h2>
  {loading && <p className="text-sm text-gray-500">Loading…</p>}
  {error && <p className="text-sm text-red-500">{error}</p>}
  {!loading && !error && availableServers.length === 0 && (
    <p className="text-sm text-gray-400">No MCP servers configured.</p>
  )}
  {availableServers.map((server) => (
    <div key={server.name} className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-700">
      <div>
        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{server.name}</p>
        <p className="text-xs text-gray-400 uppercase">{server.type}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={isEnabled(server.name)}
          disabled={saving || loading}
          onChange={(e) => handleToggle(server.name, e.target.checked)}
          data-testid={`mcp-toggle-${server.name}`}
        />
        <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
      </label>
    </div>
  ))}
</div>
```

**Imports:**
```ts
import { useEffect, useState } from 'react';
import { fetchApi } from '../hooks/useApi';
```

---

### Files to Modify

#### `packages/coc/src/server/spa/client/react/types/dashboard.ts`

Add `'copilot'` to the `RepoSubTab` union:

```ts
// Before:
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki';

// After:
export type RepoSubTab = 'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat' | 'git' | 'wiki' | 'copilot';
```

#### `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`

Two changes:

1. **Add to `SUB_TABS` array** (after `'wiki'`):
```ts
{ key: 'copilot', label: 'Copilot' },
```

2. **Add render branch** inside the `<div className="h-full overflow-y-auto min-w-0">` block:
```tsx
{activeSubTab === 'copilot' && <RepoCopilotTab workspaceId={ws.id} />}
```

3. **Add import** at the top alongside other tab imports:
```ts
import { RepoCopilotTab } from './RepoCopilotTab';
```

### Files to Delete

None.

## Implementation Notes

- **`null` semantics for `enabledMcpServers`**: `null` means all servers are enabled (no filter). When the user enables the last disabled server, the value is normalised back to `null` rather than storing a full explicit list. This matches the API contract from commit 001.
- **Optimistic update**: Toggle state is applied immediately; a failed PUT reverts it and shows an error message. `saving` flag disables all toggles during the in-flight request to prevent races.
- **Toggle UI**: Reuse the exact Tailwind peer-checkbox pattern from `PreferencesSection.tsx` (w-9 h-5, peer-checked:bg-[#0078d4]) for visual consistency.
- **No new hooks file needed**: The component is self-contained with `useState`/`useEffect` and calls `fetchApi` directly, following the same pattern as `RepoInfoTab` and `RepoSchedulesTab`.
- **No context dependencies**: `RepoCopilotTab` only receives `workspaceId: string` — the minimal prop pattern used by `RepoQueueTab` and `RepoSchedulesTab`.
- **`fetchApi` base**: `fetchApi` from `hooks/useApi.ts` automatically prepends `getApiBase()`, so the path `/workspaces/${workspaceId}/mcp-config` is correct.
- The `availableServers` field is populated by the `GET` endpoint (commit 002) from the workspace's MCP configuration; if the workspace has no MCP config, the array is empty and the empty-state message renders.

## Tests

Add `packages/coc/src/server/spa/client/react/repos/RepoCopilotTab.test.tsx`:

| # | Scenario | How to test |
|---|----------|-------------|
| 1 | Shows loading state on mount | Mock `fetchApi` to return a promise that never resolves; assert spinner/loading text present |
| 2 | Renders server list with correct names and types | Mock `fetchApi` → `{ availableServers: [{name:'github',type:'stdio'}], enabledMcpServers: null }`; assert row text and toggle checked |
| 3 | `null` enabledMcpServers → all toggles checked | Mock with `enabledMcpServers: null`; each toggle should be `checked` |
| 4 | `enabledMcpServers: ['github']` → only github toggle checked | Second server toggle should be unchecked |
| 5 | Toggling off calls PUT with correct body | Spy on `fetchApi`; uncheck a server; assert PUT called with `{ enabledMcpServers: ['remaining'] }` |
| 6 | Enabling last disabled server sends `null` | Only one server disabled; check it; assert PUT body is `{ enabledMcpServers: null }` |
| 7 | PUT failure reverts toggle and shows error | Mock PUT to reject; assert toggle reverts and error message visible |
| 8 | Empty server list shows empty state message | Mock `{ availableServers: [], enabledMcpServers: null }`; assert "No MCP servers configured." |
| 9 | Shows error message on GET failure | Mock `fetchApi` to reject; assert error text visible |
| 10 | Toggles disabled while saving | Mock PUT with slow promise; assert inputs have `disabled` attribute |

## Acceptance Criteria

- [ ] A **Copilot** tab appears in the `RepoDetail` sub-tab bar for every workspace.
- [ ] Opening the tab fetches `GET /api/workspaces/:id/mcp-config` and renders one row per available server showing the server name and type badge.
- [ ] When `enabledMcpServers` is `null`, every toggle is checked (all enabled).
- [ ] When `enabledMcpServers` is a subset list, only matching servers are checked.
- [ ] Flipping a toggle immediately updates the UI (optimistic) and calls `PUT /api/workspaces/:id/mcp-config` with the updated `enabledMcpServers` array (or `null` when all are enabled).
- [ ] All toggles are disabled during a pending PUT request.
- [ ] A failed PUT reverts the toggle and displays an inline error message.
- [ ] If no servers are configured the empty-state message is shown.
- [ ] TypeScript compiles without errors (`npm run build`).
- [ ] Existing tests remain green.

## Dependencies

- **Commit 001** — `enabledMcpServers` field on workspace type and persistence layer.
- **Commit 002** — `GET /api/workspaces/:id/mcp-config` and `PUT /api/workspaces/:id/mcp-config` endpoints.
- **Commit 003** — No direct dependency for the UI, but the pipeline execution filter should be in place so toggling has a visible effect.

## Assumed Prior State

- `RepoSubTab` in `dashboard.ts` does **not** yet include `'copilot'`.
- `SUB_TABS` in `RepoDetail.tsx` does **not** yet include `{ key: 'copilot', label: 'Copilot' }`.
- No `RepoCopilotTab.tsx` file exists yet.
- `fetchApi` is exported from `packages/coc/src/server/spa/client/react/hooks/useApi.ts` and accepts `(path: string, options?: RequestInit): Promise<any>`.
- The toggle Tailwind pattern (`sr-only peer` + peer-checked visual div) is already used in `PreferencesSection.tsx` and requires no additional CSS or dependencies.
