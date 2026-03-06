# Fix: "Generate Wiki" Button Does Nothing on Repo Wiki Tab

## Problem

On the repo's **Wiki** tab, when no wiki exists, clicking the **"Generate Wiki"** button appears to do nothing. No error is shown and no navigation occurs.

### Root Cause

**File:** `packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx`

The `handleGenerateWiki` callback calls `POST /api/wikis` but only sends `{ repoPath }`:

```ts
body: JSON.stringify({ repoPath: workspacePath }),
```

The server (`wiki-routes.ts` line 209) **requires** an `id` field:

```ts
if (!body.id) {
    sendJson(res, { error: 'Missing required field: id' }, 400);
    return;
}
```

So the POST always returns `400`. Since the handler has no `else` branch after `if (res.ok)`, the error is silently swallowed — the user sees nothing happen.

Compare with **`AddWikiDialog.tsx`** (the working "Add Wiki" dialog), which correctly generates an `id` via `slugify(name)` before posting.

---

## Acceptance Criteria

- [ ] Clicking "Generate Wiki" on the repo Wiki tab successfully creates a wiki and navigates to its admin/generate page.
- [ ] If the POST fails (e.g. server error), a visible error message is shown to the user.
- [ ] The generated wiki `id` is derived from the repo directory name (slugified), consistent with `AddWikiDialog`.
- [ ] The fix does not break the `AddWikiDialog` or any other wiki creation flow.

---

## Subtasks

### 1. Fix `handleGenerateWiki` in `RepoWikiTab.tsx`

**File:** `packages/coc/src/server/spa/client/react/repos/RepoWikiTab.tsx`

- Import or inline the `slugify` helper (same logic as `AddWikiDialog.tsx`).
- Derive `id` from the last path segment of `workspacePath` via `slugify`.
- Add `id` (and optionally `name`) to the POST body.
- Add an `else` branch to display an error when `res.ok` is false.

**Before:**
```ts
const handleGenerateWiki = useCallback(async () => {
    if (!workspacePath) return;
    const res = await fetchApi('/api/wikis', {
        method: 'POST',
        body: JSON.stringify({ repoPath: workspacePath }),
    });
    if (res.ok) {
        const wiki = await res.json();
        location.hash = '#wiki/' + encodeURIComponent(wiki.id) + '/admin';
    }
}, [workspacePath]);
```

**After (sketch):**
```ts
const handleGenerateWiki = useCallback(async () => {
    if (!workspacePath) return;
    const repoName = workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'wiki';
    const id = repoName.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') || 'wiki-' + Date.now();
    const res = await fetchApi('/api/wikis', {
        method: 'POST',
        body: JSON.stringify({ id, name: repoName, repoPath: workspacePath }),
    });
    if (res.ok) {
        const wiki = await res.json();
        location.hash = '#wiki/' + encodeURIComponent(wiki.id) + '/admin';
    } else {
        // surface error — use existing toast/notification mechanism if available
        const body = await res.json().catch(() => ({ error: 'Failed to create wiki' }));
        console.error('Failed to create wiki:', body.error);
        // TODO: show user-visible error (toast or inline message)
    }
}, [workspacePath]);
```

### 2. (Optional) Extract `slugify` to shared util

If the function is used in 2+ places, move it to a shared utility file (e.g. `utils/slugify.ts`) and import from both `AddWikiDialog` and `RepoWikiTab`.

### 3. Add user-visible error feedback

Check if there is an existing toast/notification component in the SPA. If so, wire it up in the `else` branch. If not, add an inline error state below the button (similar to the `error` state in `AddWikiDialog`).

---

## Notes

- The `slugify` implementation in `AddWikiDialog.tsx` (line 11–13) is the canonical reference:
  ```ts
  function slugify(name: string): string {
      const s = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      return s || 'wiki-' + Date.now();
  }
  ```
- The server endpoint is `POST /api/wikis` in `packages/coc-server/src/wiki/wiki-routes.ts` (line 193). No server-side change needed.
- The navigation hash `#wiki/<id>/admin` is correct — `Router.tsx` (line 221) handles this format.
- After the fix, if a wiki for this repo already exists, the server will still register it (it creates the dir and persists to the store). The button should ideally be hidden once `repoWikis.length > 0`, which is already handled by the existing conditional rendering.
