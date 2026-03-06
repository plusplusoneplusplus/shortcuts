# Configure Tests to Use Tmp Folder for explore-cache

## Problem

Running tests leaves residual files in `~/.coc/memory/explore-cache/raw/` because
`FileToolCallCacheStore` defaults to `path.join(os.homedir(), '.coc', 'memory')`.
Most test files already pass a custom `tmpDir`, but:

1. `packages/pipeline-core/test/memory/tool-call-cache-store.test.ts` contains a test
   that instantiates `new FileToolCallCacheStore()` **without** a `dataDir` to verify
   the default path — this writes real files to the home directory.
2. There is no global safety net; any future test that forgets to pass `dataDir` will
   silently pollute `~/.coc/`.

## Proposed Approach

Introduce an **environment-variable override** (`COC_DATA_DIR`) in
`FileToolCallCacheStore` (and ideally `FileMemoryStore` / any other store that
defaults to `~/.coc`), then set that variable in the vitest global setup files so that
all tests automatically use a temp directory without touching production data.

---

## Acceptance Criteria

- [ ] Running the full test suite (`npm run test:run` in any package) leaves **zero**
      files under `~/.coc/memory/explore-cache/`.
- [ ] A new `COC_DATA_DIR` (or similar) environment variable, when set, overrides the
      default `~/.coc` base for `FileToolCallCacheStore`.
- [ ] The vitest setup file(s) create a per-run temp directory, export it via the env
      var, and delete it in a global teardown.
- [ ] The existing test that verifies default paths (`new FileToolCallCacheStore()`)
      still passes — it should either use the env var or assert the path formula without
      writing files.
- [ ] No other test behaviour changes.

---

## Subtasks

### 1. Add `COC_DATA_DIR` env-var support to `FileToolCallCacheStore`
- **File:** `packages/pipeline-core/src/memory/tool-call-cache-store.ts`
- In the constructor, resolve the default `dataDir` as:
  ```ts
  const dataDir = options?.dataDir
      ?? process.env.COC_DATA_DIR
      ?? path.join(os.homedir(), '.coc', 'memory');
  ```
- Keep the existing `options.dataDir` as the highest-priority override.

### 2. Apply the same pattern to other default-path stores
- `FileMemoryStore` (`packages/coc-server/src/memory/...`) — already receives `dataDir`
  as a constructor arg; check if callers ever omit it.
- `FileProcessStore` — same check.
- Add `COC_DATA_DIR` fallback to any store that defaults to `~/.coc`.

### 3. Add/update vitest global setup in pipeline-core
- **File:** `packages/pipeline-core/vitest.config.ts` (currently has no `setupFiles`)
- Create `packages/pipeline-core/test/setup.ts`:
  ```ts
  import os from 'os';
  import fs from 'fs';
  import path from 'path';

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-test-'));
  process.env.COC_DATA_DIR = tmpBase;

  // Vitest global teardown
  export async function teardown() {
      await fs.promises.rm(tmpBase, { recursive: true, force: true });
  }
  ```
- Wire it up in `vitest.config.ts`:
  ```ts
  globalSetup: ['test/setup.ts']
  ```

### 4. Update coc and coc-server vitest configs similarly
- `packages/coc/test/setup.ts` already exists — append `COC_DATA_DIR` assignment
  to it (or a new `globalSetup` file if it is a per-test setup file).
- `packages/coc-server/vitest.config.ts` — add the same pattern.

### 5. Fix the "default path" test in pipeline-core
- **File:** `packages/pipeline-core/test/memory/tool-call-cache-store.test.ts` (line ~307)
- The test `new FileToolCallCacheStore()` will now resolve to `process.env.COC_DATA_DIR`
  (set by the global setup). Update the assertion to match:
  ```ts
  expect(defaultStore.cacheDir).toBe(
      path.join(process.env.COC_DATA_DIR!, 'explore-cache')
  );
  ```
  Or restructure the test to only verify path formula logic without writing files.

### 6. Verify & clean up
- Run `npm run test:run` in each affected package and confirm all tests pass.
- Manually confirm `~/.coc/memory/explore-cache/raw/` receives no new files.

---

## Notes

- `COC_DATA_DIR` naming mirrors `COC_*` conventions already in the codebase.
- The global setup approach is preferred over per-test manual `mkdtemp` because it
  provides a backstop for any test that accidentally omits `dataDir`.
- Do **not** set `COC_DATA_DIR` in production; the env var should only appear in test
  setup files and CI environment configuration.
- Consider also checking `packages/coc/test/server/queue-executor-bridge.test.ts` —
  it uses mocks today but that could change.
