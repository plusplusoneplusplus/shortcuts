# Plan: Add "Git" Tab with Commit History & Commit Detail

## Problem Statement

The CoC SPA dashboard needs a new **"Git"** sub-tab on the repo detail view. The screenshot shows a partially-working "History" tab that:
1. Should be **renamed to "Git"** (currently labeled "History" in the mockup)
2. Displays commits in two sections: **UNPUSHED** (ahead of remote) and **HISTORY** (already pushed)
3. **Clicking a commit should expand to show commit detail** (files changed, diff) — currently this results in an empty page

## Current State

- `RepoSubTab` type: `'info' | 'pipelines' | 'tasks' | 'queue' | 'schedules' | 'chat'` — **no git/history tab**
- `SUB_TABS` array in `RepoDetail.tsx` has 6 entries — **no git entry**
- Backend only has `GET /api/workspaces/:id/git-info` (branch, dirty, ahead/behind) — **no commit list or detail endpoints**
- No `RepoGitTab`, `CommitList`, or `CommitDetail` components exist
- `execGitSync` helper already exists in `coc-server/src/api-handler.ts`

## Approach

### Phase 1: Backend — Git Commit API Endpoints (coc-server)

Add three new API routes in `packages/coc-server/src/api-handler.ts`:

1. **`GET /api/workspaces/:id/git/commits`** — List commits with pagination
   - Query params: `limit` (default 50), `skip` (default 0)
   - Uses `git log --format=...` to get hash, shortHash, subject, author, date, parentHashes
   - Uses `git rev-list --left-right --count HEAD...@{u}` to determine which commits are ahead of remote
   - Returns `{ commits: GitCommitItem[], unpushedCount: number }`

2. **`GET /api/workspaces/:id/git/commits/:hash/files`** — List files changed in a commit
   - Uses `git diff-tree --no-commit-id -r --name-status <hash>` 
   - Returns `{ files: { status: string, path: string }[] }`

3. **`GET /api/workspaces/:id/git/commits/:hash/diff`** — Full diff for a commit
   - Uses `git show --format="" --patch <hash>`
   - Returns `{ diff: string }`

### Phase 2: Frontend — Type & Tab Registration

1. **Update `RepoSubTab`** in `packages/coc/src/server/spa/client/react/types/dashboard.ts`:
   - Add `'git'` to the union type (after `'chat'`)

2. **Update `SUB_TABS`** in `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx`:
   - Add `{ key: 'git', label: 'Git' }` entry
   - Add `{activeSubTab === 'git' && <RepoGitTab workspaceId={ws.id} />}` to the sub-tab content block
   - Import `RepoGitTab`

### Phase 3: Frontend — RepoGitTab Component

Create `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx`:

- Fetches commits from `/workspaces/:id/git/commits?limit=50`
- Splits commits into **unpushed** (using `isAheadOfRemote` flag from API or `ahead` count from git-info) and **pushed**
- Renders two `<CommitList>` sections:
  - **UNPUSHED (N)** — commits ahead of remote
  - **HISTORY** — pushed commits
- Handles loading, error, and empty states

### Phase 4: Frontend — CommitList Component

Create `packages/coc/src/server/spa/client/react/repos/CommitList.tsx`:

- Receives `commits[]`, `workspaceId`, `loading`, `title`
- Each commit row shows: play icon, short hash, subject, relative time, author
- Click toggles accordion expand → renders `<CommitDetail>`
- Empty state: "No commits yet"

### Phase 5: Frontend — CommitDetail Component

Create `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx`:

- On mount, fetches `/workspaces/:id/git/commits/:hash/files`
- Shows: author, date, parent hashes, files changed count
- `<FileChangeList>` showing changed files with status icons (A/M/D)
- "View Full Diff" button that lazily fetches `/workspaces/:id/git/commits/:hash/diff`
- Renders diff with `<DiffViewer>` or pre-formatted code block
- **Proper error handling**: shows error message on API failure (not silent catch)
- "Copy Hash" button

### Phase 6: Testing

- **Backend tests** (`packages/coc-server/test/`): Test the 3 new git API routes with mocked `execGitSync`
- **Frontend tests** (`packages/coc/test/spa/react/`): Test RepoGitTab, CommitList, CommitDetail rendering, expand/collapse, error states

## Key Design Decisions

- **Tab named "Git"** (not "History") — per user request
- **Two-section layout**: UNPUSHED vs HISTORY — mirrors the screenshot mockup  
- **Error handling in CommitDetail**: Must show visible error state, not silent `catch(() => setFiles([]))`
- **Reuse `execGitSync`**: Existing helper in api-handler.ts handles timeouts (5s)
- **Hash validation**: API should validate commit hash format (`/^[a-f0-9]{4,40}$/`) to prevent injection

## Files to Create/Modify

| Action | File |
|--------|------|
| Modify | `packages/coc/src/server/spa/client/react/types/dashboard.ts` |
| Modify | `packages/coc/src/server/spa/client/react/repos/RepoDetail.tsx` |
| Create | `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` |
| Create | `packages/coc/src/server/spa/client/react/repos/CommitList.tsx` |
| Create | `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx` |
| Modify | `packages/coc-server/src/api-handler.ts` |
| Create | `packages/coc-server/test/git-api.test.ts` (or similar) |
| Create | `packages/coc/test/spa/react/RepoGitTab.test.ts` |
| Create | `packages/coc/test/spa/react/CommitList.test.ts` |
| Create | `packages/coc/test/spa/react/CommitDetail.test.ts` |
