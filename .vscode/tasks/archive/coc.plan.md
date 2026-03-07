# CoC Project Plans

## Per-Repo Preferences

### Problem
Currently all repositories share the same `lastModel`, `lastDepth`, `lastEffort`, and `lastSkill` preferences. We need each repo to have its own preferences in a **single** `~/.coc/preferences.json` file organized by repo ID.

### Solution Design

**File structure:** `~/.coc/preferences.json`
```json
{
  "global": {
    "theme": "light",
    "reposSidebarCollapsed": false
  },
  "repos": {
    "repo-id-1": {
      "lastModel": "gpt-4",
      "lastDepth": "deep",
      "lastEffort": "medium",
      "lastSkill": null,
      "pinnedChats": { "workspace-a": ["chat-id-1"] },
      "archivedChats": { "workspace-b": ["chat-id-3"] }
    },
    "repo-id-2": {
      "lastModel": "claude-3-sonnet"
    }
  }
}
```

**Per-repo fields:** `lastModel`, `lastDepth`, `lastEffort`, `lastSkill`, `pinnedChats`, `archivedChats`
**Global fields:** `theme`, `reposSidebarCollapsed`
**Repo ID:** Derived from workspaceId/repo path passed via API

### API Routes
- `GET /api/workspaces/:id/preferences` — Read per-repo prefs
- `PUT /api/workspaces/:id/preferences` — Replace per-repo prefs
- `PATCH /api/workspaces/:id/preferences` — Merge per-repo prefs
- `GET /api/preferences` — Read global prefs (theme, sidebar)
- `PATCH /api/preferences` — Merge global prefs

### Implementation Todos

**Backend**
1. Update `UserPreferences` type: split into `GlobalPreferences` and `PerRepoPreferences`
2. Update `readPreferences(dataDir)` to return `{ global, repos }`
3. Update `writePreferences(dataDir, data)` to handle nested structure
4. Register new routes: `/api/workspaces/:id/preferences` (GET, PUT, PATCH)
5. Route handler: extract `:id`, read/write `repos.<id>` section

**Frontend**
6. Update `usePreferences()` hook to accept `repoId` param, call `/api/workspaces/:id/preferences`
7. Update all components to pass `repoId` to usePreferences:
   - `NewChatDialog.tsx`
   - `GenerateTaskDialog.tsx`
   - `EnqueueDialog.tsx`
   - `FollowPromptDialog.tsx`
   - `RepoChatTab.tsx`
   - Others using usePreferences

**Testing**
8. Update preferences handler tests: verify nested JSON read/write, test per-repo isolation
9. Update component tests: pass repoId prop, verify correct API endpoint
10. Add E2E test: two repos set different models, verify isolation

### Notes
- No migration needed (no backward compatibility)
- Missing repo in `repos` section = empty prefs (defaults apply)
- Global prefs can be read/written independently

