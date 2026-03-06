# Handle Invalid Characters in Rename — Plan

## Problem Statement

When a user renames a file or folder to a name containing invalid path characters (e.g. `/` as seen in "Pause/Resume Button Visibility Issue - Plan"), the request reaches the backend where the `/` is interpreted as a path separator. This produces a misleading `404 File or folder not found` error instead of a clear validation failure.

**Root cause:** Neither the frontend dialog nor the backend rename handler validates the new name for characters that are illegal in file/folder names on the target OS.

---

## Affected Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/tasks/FolderActionDialog.tsx` | Rename dialog UI — add inline validation error |
| `packages/coc/src/server/tasks-handler.ts` | PATCH rename handler — add server-side guard |

---

## Invalid Characters

Characters that must be rejected in a new name:

- **All platforms:** `/` (path separator)
- **Windows (also enforced server-side):** `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`
- **Reserved names (Windows):** `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`

Practical approach: reject the union of all platform-invalid chars so names are safe cross-platform.

Regex: `/[/\\:*?"<>|]/`

---

## Proposed Approach

### 1. Frontend — `FolderActionDialog.tsx`

- Add an `errorMessage` state derived from the current input value.
- After each keystroke, check the name against the invalid-char regex.
- If invalid chars are found, display a red helper text listing the offending characters and **disable the Confirm button**.
- Keep the existing "empty name" guard.

```tsx
const INVALID_CHARS = /[/\\:*?"<>|]/g;

function getInvalidChars(name: string): string[] {
  return [...new Set((name.match(INVALID_CHARS) ?? []))];
}

// In render:
const invalid = getInvalidChars(name);
const errorMsg = invalid.length
  ? `Name contains invalid characters: ${invalid.map(c => `"${c}"`).join(', ')}`
  : '';

// Disable confirm when invalid or empty:
disabled={!name.trim() || invalid.length > 0}
```

### 2. Backend — `tasks-handler.ts`

Add a `validateNewName` guard before the rename logic in the PATCH handler (after the existing empty-check):

```typescript
const INVALID_NAME_CHARS = /[/\\:*?"<>|]/;

if (INVALID_NAME_CHARS.test(newName.trim())) {
  return sendError(res, 400, 'New name contains invalid characters: / \\ : * ? " < > |');
}
```

This ensures the API returns a proper `400 Bad Request` even if the frontend check is bypassed.

---

## Out of Scope

- Sanitizing (auto-replacing) invalid chars — explicit rejection with a message is safer UX.
- Enforcing Windows reserved names — low priority; omit for now.
- Renaming via CLI commands — not triggered through this UI path.

---

## Todos

1. **`add-frontend-validation`** — ✅ Add invalid-char detection + inline error message to `FolderActionDialog.tsx`; disable Confirm button when invalid.
2. **`add-backend-validation`** — ✅ Add server-side invalid-char check in the PATCH rename handler in `tasks-handler.ts`; return 400 with clear message.
3. **`add-tests`** — ✅ Add/extend Vitest tests for the backend validation (tasks-handler); add/extend component tests for the dialog validation UI.
4. **`verify-e2e`** — ✅ Manual smoke test: attempt to rename a file/folder with `/`, `\`, `:`, etc.; confirm inline error and that no 4xx/5xx from backend occurs when frontend blocks submission.

---

## Notes

- The dialog is used for both file rename and folder rename — the fix in `FolderActionDialog.tsx` covers both cases with one change.
- The backend fix is a single guard block, independent of document-group vs single-file vs directory logic.
- Test files are likely in `packages/coc/src/server/__tests__/` or alongside `tasks-handler.ts`.
