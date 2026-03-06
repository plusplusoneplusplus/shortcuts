---
status: pending
---

# 009: Add integration and e2e tests

## Summary

Add unit tests for hunk-header parsing, `DiffCommentSelection` mapping, storage key generation, and anchor relocation; add integration tests for the `useDiffComments` hook with mocked API endpoints; add component tests for `UnifiedDiffViewer` with comments enabled; and add an e2e smoke test for the full select→comment→resolve flow.

## Motivation

Commits 001–008 introduce all production logic but ship without dedicated test coverage. This commit consolidates that coverage in one place so each test can be written against the fully integrated system. Placing tests last avoids churn from iterative type/API changes in prior commits, and makes the test suite easy to review alongside the feature as a whole.

## Changes

### Files to Create

```
packages/coc/test/spa/react/repos/diffHunkParsing.test.ts
packages/coc/test/spa/react/repos/diffCommentSelection.test.ts
packages/coc/test/spa/react/repos/diffCommentStorageKey.test.ts
packages/coc/test/spa/react/repos/diffCommentAnchorRelocation.test.ts
packages/coc/test/spa/react/hooks/useDiffComments.test.ts
packages/coc/test/spa/react/repos/UnifiedDiffViewerComments.test.ts
packages/coc/test/spa/react/CommitDetailDiffComments.test.ts
```

### Files to Modify

None — all new test files.

### Files to Delete

None.

## Implementation Notes

### Test runner & environment

- Runner: **Vitest** (`npm run test:run` inside `packages/coc/`).
- DOM environment declared per-file via `// @vitest-environment jsdom` where React rendering is needed (matches the pattern in `packages/coc/test/setup.ts`).
- React component tests use `@testing-library/react` (`render`, `screen`, `fireEvent`, `renderHook`, `act`) — already in `devDependencies`.
- Pure-logic tests import source modules directly (same pattern as `diff-utils.test.ts`).
- Source-analysis tests use `fs.readFileSync` (same pattern as `UnifiedDiffViewer.test.ts`) for surface-level structural assertions where runtime import is impractical (e.g., crypto in a jsdom environment).

### Import style

All test files use the named vitest import pattern:
```typescript
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
```

### Mocking API calls in hook tests

Use `vi.stubGlobal('fetch', ...)` or `vi.fn()` on the `fetchApi` helper. Prefer `vi.spyOn` on the module's exported `fetchApi` rather than stubbing `fetch` globally, since `useDiffComments` calls `fetchApi` internally.

### Crypto in jsdom

`crypto.subtle.digest` is available in Node ≥ 15 / jsdom. If `TextEncoder` is missing, polyfill in the test with:
```typescript
import { TextEncoder } from 'util';
global.TextEncoder = TextEncoder;
```

---

## Tests

### 1. `diffHunkParsing.test.ts` — Unit: hunk-header parsing

**Source under test:** `src/server/spa/client/react/repos/UnifiedDiffViewer.tsx` (the `parseDiffLines` / `parseHunkHeader` function exported or tested via the component's output, or a utility extracted in commit 002).

```typescript
import { describe, it, expect } from 'vitest';
import { parseDiffLines } from '../../../../src/server/spa/client/react/repos/diffLineUtils';
// or wherever the hunk parser lives after commit 002

describe('parseDiffLines – hunk-header line numbering', () => {
  it('assigns correct oldLine/newLine to context lines after @@ -10,6 +12,8 @@', () => {
    const raw = '@@ -10,6 +12,8 @@\n context\n+added\n-removed\n context2';
    const lines = parseDiffLines(raw);
    // hunk header itself
    expect(lines[0].type).toBe('hunk-header');
    expect(lines[0].oldLine).toBeNull();
    expect(lines[0].newLine).toBeNull();
    // first context line: old=10, new=12
    expect(lines[1].type).toBe('context');
    expect(lines[1].oldLine).toBe(10);
    expect(lines[1].newLine).toBe(12);
    // added line: old=null, new=13
    expect(lines[2].type).toBe('added');
    expect(lines[2].oldLine).toBeNull();
    expect(lines[2].newLine).toBe(13);
    // removed line: old=11, new=null
    expect(lines[3].type).toBe('removed');
    expect(lines[3].oldLine).toBe(11);
    expect(lines[3].newLine).toBeNull();
  });

  it('increments counters across multiple hunks', () => {
    const raw = '@@ -1,2 +1,2 @@\n ctx\n-rem\n@@ -5,1 +5,1 @@\n ctx2';
    const lines = parseDiffLines(raw);
    const secondHunk = lines.find((l, i) => i > 0 && l.type === 'hunk-header');
    expect(secondHunk).toBeDefined();
    const afterSecondHunk = lines[lines.indexOf(secondHunk!) + 1];
    expect(afterSecondHunk.oldLine).toBe(5);
    expect(afterSecondHunk.newLine).toBe(5);
  });
});
```

---

### 2. `diffCommentSelection.test.ts` — Unit: DiffCommentSelection mapping

**Source under test:** The selection-to-`DiffCommentSelection` mapper introduced in commit 003.

```typescript
import { describe, it, expect } from 'vitest';
import { buildDiffCommentSelection } from '../../../../src/server/spa/client/react/repos/diffCommentSelectionUtils';
import type { DiffLine } from '../../../../src/server/spa/client/react/repos/types';

const makeLine = (idx: number, type: DiffLine['type'] = 'context'): DiffLine => ({
  index: idx, type, content: `line ${idx}`, oldLine: idx, newLine: idx,
});

describe('buildDiffCommentSelection', () => {
  it('maps a single-line selection to diffLineStart === diffLineEnd', () => {
    const lines = [makeLine(0), makeLine(1), makeLine(2)];
    const sel = buildDiffCommentSelection(lines, 1, 1);
    expect(sel.diffLineStart).toBe(1);
    expect(sel.diffLineEnd).toBe(1);
  });

  it('maps a multi-line selection spanning lines 3..5', () => {
    const lines = Array.from({ length: 6 }, (_, i) => makeLine(i));
    const sel = buildDiffCommentSelection(lines, 3, 5);
    expect(sel.diffLineStart).toBe(3);
    expect(sel.diffLineEnd).toBe(5);
    expect(sel.selectedText).toContain('line 3');
    expect(sel.selectedText).toContain('line 5');
  });

  it('captures oldLine/newLine of the start line', () => {
    const lines = [makeLine(0), { index: 1, type: 'added' as const, content: '+x', oldLine: null, newLine: 42 }];
    const sel = buildDiffCommentSelection(lines, 1, 1);
    expect(sel.oldLine).toBeNull();
    expect(sel.newLine).toBe(42);
  });
});
```

---

### 3. `diffCommentStorageKey.test.ts` — Unit: storage key generation

**Source under test:** The `generateStorageKey` function from commit 005 (`DiffCommentsManager`).

```typescript
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { TextEncoder } from 'util';
// polyfill if needed
if (!global.TextEncoder) (global as any).TextEncoder = TextEncoder;

import { generateStorageKey } from '../../../../src/server/spa/client/react/repos/diffCommentStorageKey';
import type { DiffCommentContext } from '../../../../src/server/spa/client/react/repos/types';

const ctx: DiffCommentContext = {
  repoId: 'repo-abc',
  oldRef: 'main',
  newRef: 'feature/x',
  filePath: 'src/foo.ts',
};

describe('generateStorageKey', () => {
  it('returns a 64-char hex string (SHA-256)', async () => {
    const key = await generateStorageKey(ctx);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across repeated calls with the same context', async () => {
    const k1 = await generateStorageKey(ctx);
    const k2 = await generateStorageKey(ctx);
    expect(k1).toBe(k2);
  });

  it('differs when filePath changes', async () => {
    const other = await generateStorageKey({ ...ctx, filePath: 'src/bar.ts' });
    const key = await generateStorageKey(ctx);
    expect(key).not.toBe(other);
  });

  it('differs when oldRef changes', async () => {
    const other = await generateStorageKey({ ...ctx, oldRef: 'develop' });
    const key = await generateStorageKey(ctx);
    expect(key).not.toBe(other);
  });
});
```

---

### 4. `diffCommentAnchorRelocation.test.ts` — Unit: anchor relocation

**Source under test:** `relocateAnchor` (or equivalent) from commit 008.

```typescript
import { describe, it, expect } from 'vitest';
import { relocateAnchor } from '../../../../src/server/spa/client/react/repos/diffCommentAnchorUtils';
import type { DiffLine, DiffComment } from '../../../../src/server/spa/client/react/repos/types';

const makeComment = (diffLineStart: number): DiffComment => ({
  id: 'c1', body: 'test', resolved: false,
  anchor: { diffLineStart, diffLineEnd: diffLineStart, oldLine: diffLineStart, newLine: diffLineStart },
  createdAt: new Date().toISOString(),
});

const makeLines = (count: number): DiffLine[] =>
  Array.from({ length: count }, (_, i) => ({
    index: i, type: 'context' as const, content: `line ${i}`, oldLine: i + 1, newLine: i + 1,
  }));

describe('relocateAnchor', () => {
  it('returns the same diffLineStart when anchor line still exists', () => {
    const lines = makeLines(10);
    const result = relocateAnchor(makeComment(3), lines);
    expect(result).not.toBeNull();
    expect(result!.diffLineStart).toBe(3);
  });

  it('returns null (orphaned) when the anchor line is beyond the diff', () => {
    const lines = makeLines(5); // indices 0-4
    const result = relocateAnchor(makeComment(10), lines);
    expect(result).toBeNull();
  });

  it('relocates to nearest matching line when hunk offsets shift', () => {
    // Build lines where oldLine 5 now maps to index 7 after a rebase shift
    const lines: DiffLine[] = [
      ...makeLines(5),
      { index: 5, type: 'added', content: '+inserted', oldLine: null, newLine: 6 },
      { index: 6, type: 'added', content: '+inserted2', oldLine: null, newLine: 7 },
      { index: 7, type: 'context', content: 'line 5', oldLine: 5, newLine: 8 },
    ];
    const comment = makeComment(5); // originally at diffLine 5 which had oldLine 5
    const result = relocateAnchor(comment, lines);
    expect(result).not.toBeNull();
    expect(result!.diffLineStart).toBe(7);
  });
});
```

---

### 5. `useDiffComments.test.ts` — Integration: hook with mocked API

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiffComments } from '../../../../src/server/spa/client/react/hooks/useDiffComments';
import * as apiModule from '../../../../src/server/spa/client/react/hooks/useApi';

const WS_ID = 'ws-1';
const STORAGE_KEY = 'abc123';

describe('useDiffComments', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(apiModule, 'fetchApi');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads comments on mount', async () => {
    fetchSpy.mockResolvedValueOnce([
      { id: 'c1', body: 'hello', resolved: false, anchor: { diffLineStart: 2 } },
    ]);
    const { result } = renderHook(() => useDiffComments(WS_ID, STORAGE_KEY));
    await act(async () => {});
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(`/api/diff-comments/${WS_ID}`),
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0].body).toBe('hello');
  });

  it('addComment posts and updates state', async () => {
    fetchSpy
      .mockResolvedValueOnce([]) // initial load
      .mockResolvedValueOnce({ id: 'c2', body: 'new', resolved: false, anchor: { diffLineStart: 3 } });
    const { result } = renderHook(() => useDiffComments(WS_ID, STORAGE_KEY));
    await act(async () => {});
    await act(async () => {
      await result.current.addComment({ body: 'new', anchor: { diffLineStart: 3 } } as any);
    });
    expect(result.current.comments).toHaveLength(1);
    expect(result.current.comments[0].id).toBe('c2');
  });

  it('deleteComment removes comment from state', async () => {
    fetchSpy
      .mockResolvedValueOnce([{ id: 'c3', body: 'del', resolved: false, anchor: { diffLineStart: 1 } }])
      .mockResolvedValueOnce(undefined); // DELETE returns 204
    const { result } = renderHook(() => useDiffComments(WS_ID, STORAGE_KEY));
    await act(async () => {});
    await act(async () => {
      await result.current.deleteComment('c3');
    });
    expect(result.current.comments).toHaveLength(0);
  });

  it('askAI calls the correct endpoint and returns AI response', async () => {
    fetchSpy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ reply: 'AI says: looks good' });
    const { result } = renderHook(() => useDiffComments(WS_ID, STORAGE_KEY));
    await act(async () => {});
    let reply: string | undefined;
    await act(async () => {
      reply = await result.current.askAI('c1', 'explain this');
    });
    expect(reply).toBe('AI says: looks good');
  });
});
```

---

### 6. `UnifiedDiffViewerComments.test.ts` — Component: with comments enabled

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnifiedDiffViewer } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

const DIFF = `@@ -1,3 +1,4 @@\n context\n+added line\n-removed line\n context2`;

const COMMENT = {
  id: 'c1',
  body: 'This is suspicious',
  resolved: false,
  anchor: { diffLineStart: 2, diffLineEnd: 2 },
  createdAt: new Date().toISOString(),
};

describe('UnifiedDiffViewer – comments integration', () => {
  it('renders highlight class on the commented line', () => {
    render(
      <UnifiedDiffViewer
        diff={DIFF}
        comments={[COMMENT]}
        workspaceId="ws-1"
        storageKey="key-1"
      />
    );
    // Line index 2 (the added line) should carry the highlight class
    const highlightedRow = document.querySelector('[data-line-index="2"].diff-comment-highlight');
    expect(highlightedRow).not.toBeNull();
  });

  it('renders a gutter badge on the commented line', () => {
    render(
      <UnifiedDiffViewer
        diff={DIFF}
        comments={[COMMENT]}
        workspaceId="ws-1"
        storageKey="key-1"
      />
    );
    const badge = document.querySelector('[data-line-index="2"] .diff-gutter-badge');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('1'); // 1 comment
  });

  it('does not render highlights when comments prop is empty', () => {
    render(
      <UnifiedDiffViewer diff={DIFF} comments={[]} workspaceId="ws-1" storageKey="key-1" />
    );
    const highlighted = document.querySelectorAll('.diff-comment-highlight');
    expect(highlighted).toHaveLength(0);
  });

  it('renders a resolved comment with resolved highlight class', () => {
    const resolved = { ...COMMENT, resolved: true };
    render(
      <UnifiedDiffViewer diff={DIFF} comments={[resolved]} workspaceId="ws-1" storageKey="key-1" />
    );
    const resolvedRow = document.querySelector('[data-line-index="2"].diff-comment-resolved');
    expect(resolvedRow).not.toBeNull();
  });
});
```

---

### 7. `CommitDetailDiffComments.test.ts` — E2e smoke test

```typescript
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as apiModule from '../../../../src/server/spa/client/react/hooks/useApi';
import { CommitDetail } from '../../../../src/server/spa/client/react/repos/CommitDetail';

// Minimal mock commit
const MOCK_COMMIT = {
  sha: 'abc123',
  message: 'test commit',
  author: 'Dev',
  date: new Date().toISOString(),
  diff: '@@ -1,3 +1,4 @@\n ctx\n+added\n-removed\n ctx2',
};

describe('CommitDetail – diff commenting e2e smoke', () => {
  beforeEach(() => {
    vi.spyOn(apiModule, 'fetchApi').mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it('shows SelectionToolbar after text selection on a diff line', async () => {
    render(<CommitDetail workspaceId="ws-1" commit={MOCK_COMMIT} />);
    await waitFor(() => screen.getByTestId('unified-diff-viewer'));

    const diffLine = document.querySelector('[data-line-index="1"]')!;
    fireEvent.mouseUp(diffLine);           // trigger selection detection

    await waitFor(() => {
      expect(screen.getByTestId('selection-toolbar')).toBeInTheDocument();
    });
  });

  it('shows InlineCommentPopup after clicking "Add comment"', async () => {
    render(<CommitDetail workspaceId="ws-1" commit={MOCK_COMMIT} />);
    await waitFor(() => screen.getByTestId('unified-diff-viewer'));

    fireEvent.mouseUp(document.querySelector('[data-line-index="1"]')!);
    await waitFor(() => screen.getByTestId('selection-toolbar'));

    fireEvent.click(screen.getByRole('button', { name: /add comment/i }));
    await waitFor(() => {
      expect(screen.getByTestId('inline-comment-popup')).toBeInTheDocument();
    });
  });

  it('submitting a comment adds it to the sidebar', async () => {
    vi.spyOn(apiModule, 'fetchApi')
      .mockResolvedValueOnce([])                                               // initial load
      .mockResolvedValueOnce({ id: 'new-c', body: 'my comment', resolved: false, anchor: { diffLineStart: 1 } });

    render(<CommitDetail workspaceId="ws-1" commit={MOCK_COMMIT} />);
    await waitFor(() => screen.getByTestId('unified-diff-viewer'));

    fireEvent.mouseUp(document.querySelector('[data-line-index="1"]')!);
    await waitFor(() => screen.getByTestId('selection-toolbar'));
    fireEvent.click(screen.getByRole('button', { name: /add comment/i }));
    await waitFor(() => screen.getByTestId('inline-comment-popup'));

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'my comment');
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByTestId('diff-comments-sidebar')).toBeInTheDocument();
      expect(screen.getByText('my comment')).toBeInTheDocument();
    });
  });

  it('resolving a comment turns the line highlight green', async () => {
    vi.spyOn(apiModule, 'fetchApi')
      .mockResolvedValueOnce([{ id: 'c1', body: 'fix this', resolved: false, anchor: { diffLineStart: 1 } }])
      .mockResolvedValueOnce({ id: 'c1', body: 'fix this', resolved: true, anchor: { diffLineStart: 1 } });

    render(<CommitDetail workspaceId="ws-1" commit={MOCK_COMMIT} />);
    await waitFor(() => screen.getByTestId('unified-diff-viewer'));

    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));

    await waitFor(() => {
      const line = document.querySelector('[data-line-index="1"]');
      expect(line?.classList.contains('diff-comment-resolved')).toBe(true);
    });
  });
});
```

---

## Acceptance Criteria

- [ ] All 7 test files are created under `packages/coc/test/`.
- [ ] `npm run test:run` in `packages/coc/` exits 0 with all new tests passing.
- [ ] Hunk-header tests assert correct `oldLine`/`newLine` for context, added, and removed lines after `@@ -10,6 +12,8 @@`.
- [ ] Selection mapping tests assert correct `diffLineStart`, `diffLineEnd`, `selectedText`, `oldLine`, `newLine`.
- [ ] Storage key tests confirm the key is a stable 64-char hex SHA-256 and changes when any context field changes.
- [ ] Anchor relocation tests cover: anchor still valid, anchor orphaned (out of range), anchor shifted by hunk offset.
- [ ] `useDiffComments` integration tests cover: initial load, `addComment`, `deleteComment`, `askAI`.
- [ ] `UnifiedDiffViewerComments` component tests cover: highlight class on commented line, gutter badge, no highlights when empty, resolved class.
- [ ] E2e smoke covers: selection → toolbar, toolbar → popup, submit → sidebar, resolve → green highlight.
- [ ] No new production source files are added; only test files.

## Dependencies

- **008** (anchor relocation) must be merged first — `relocateAnchor` must exist.
- **005** (DiffCommentsManager + routes) must be merged — `generateStorageKey` must exist.
- **006** (`useDiffComments` hook) must be merged — hook must be importable.
- **003** (selection detection) must be merged — `buildDiffCommentSelection` must exist.
- **002** (`DiffLine` export + hunk parsing) must be merged — `parseDiffLines` must be importable.

## Assumed Prior State

- `UnifiedDiffViewer` accepts `comments`, `workspaceId`, and `storageKey` props (commit 004/006).
- `CommitDetail` renders `UnifiedDiffViewer` with diff-commenting wired in (commit 007).
- `SelectionToolbar` and `InlineCommentPopup` are rendered by `UnifiedDiffViewer` or `CommitDetail` with `data-testid` attributes (commit 003/004).
- `DiffCommentsManager` exposes `generateStorageKey` as a named export (commit 005).
- `parseDiffLines` (or equivalent) is exported from a utility module introduced in commit 002.
- `buildDiffCommentSelection` is exported from a utility module introduced in commit 003.
- `relocateAnchor` is exported from a utility module introduced in commit 008.
- `useDiffComments` is exported from `src/server/spa/client/react/hooks/useDiffComments.ts` (commit 006).
