---
status: pending
---

# 001: Consolidate config from `~/.coc.yaml` to `~/.coc/config.yaml`

## Summary

Move the CoC CLI config file location from `~/.coc.yaml` (home root) to `~/.coc/config.yaml` so that `~/.coc/` becomes the single dedicated folder for all CoC data — config, state, and conversations. Add backward compatibility fallback and auto-migration from the old location.

## Motivation

Currently config lives at `~/.coc.yaml` in the home directory root while runtime data already lives under `~/.coc/`. This split is inconsistent and clutters the home directory. Consolidating into `~/.coc/config.yaml` gives users a single folder to manage, back up, or delete.

## Changes

### Files to Create

_None._

### Files to Modify

1. **`packages/coc/src/config.ts`**
   - Change `CONFIG_FILE_NAME` from `'.coc.yaml'` to `'config.yaml'` (or introduce a `CONFIG_DIR` constant).
   - Add a `COC_DIR` constant: `'.coc'` (the `~/.coc` directory name).
   - Update `getConfigFilePath()` to return `path.join(os.homedir(), '.coc', 'config.yaml')`.
   - Add a `getLegacyConfigFilePath()` helper returning `path.join(os.homedir(), '.coc.yaml')`.
   - Update `loadConfigFile()` (when no explicit `configPath` is provided) to:
     1. Try `~/.coc/config.yaml` first.
     2. If not found, fall back to `~/.coc.yaml`.
   - Add `migrateConfigIfNeeded()`: if `~/.coc.yaml` exists and `~/.coc/config.yaml` does not, copy the old file to the new location (create `~/.coc/` dir if needed). Call this at the start of `loadConfigFile()` (only on the default path, not when an explicit `configPath` is passed).
   - Update the module-level JSDoc comment to reference `~/.coc/config.yaml`.

2. **`packages/coc/test/config.test.ts`**
   - Add new test cases (see Tests section below).
   - Update any existing assertions that hard-code the old path `~/.coc.yaml`.

3. **`packages/coc/README.md`** (or any docs referencing `~/.coc.yaml`)
   - Update config file path references to `~/.coc/config.yaml`.
   - Note backward compatibility with `~/.coc.yaml`.

## Implementation Notes

- `loadConfigFile(configPath?)` already accepts an explicit path override. Migration and fallback logic should **only** apply when `configPath` is `undefined` (i.e., the default resolution path). When an explicit path is supplied, use it as-is.
- The migration copies (not moves) the old file to preserve it as a safety net. A future version may warn and eventually remove the fallback.
- `resolveDataDir()` in `serve.ts` already resolves `~/.coc` for the data directory — no changes needed there; the config will simply land inside the same directory.
- Ensure `~/.coc/` is created with `fs.mkdirSync(dir, { recursive: true })` before writing the migrated config file, matching the pattern already used in `serve.ts` line 41.
- The `resolveConfig()` function delegates to `loadConfigFile()`, so it inherits the new behaviour with no changes.
- `cli.ts` calls `resolveConfig()` with no arguments in every command action — no changes needed there.

## Tests

Add/update in `packages/coc/test/config.test.ts`:

1. **Loads from new location** — Place config at `~/.coc/config.yaml` (mocked), verify `loadConfigFile()` returns it.
2. **Backward compat fallback** — Only place config at `~/.coc.yaml` (mocked), verify `loadConfigFile()` still returns it.
3. **New location takes precedence** — Place config at both locations with different values, verify the new-location values win.
4. **Auto-migration** — Place config at `~/.coc.yaml` only, call `loadConfigFile()`, verify `~/.coc/config.yaml` is created with identical content.
5. **No migration when new file exists** — Place config at both locations, call `loadConfigFile()`, verify the new-location file is not overwritten.
6. **Explicit configPath bypasses fallback** — Pass an explicit path to `loadConfigFile('/custom/path.yaml')`, verify neither default location is checked.
7. **getConfigFilePath returns new path** — Assert `getConfigFilePath()` returns `<homedir>/.coc/config.yaml`.
8. **getLegacyConfigFilePath returns old path** — Assert it returns `<homedir>/.coc.yaml`.

## Acceptance Criteria

- [ ] `getConfigFilePath()` returns `~/.coc/config.yaml`.
- [ ] Config loads from `~/.coc/config.yaml` by default.
- [ ] Old `~/.coc.yaml` still works when `~/.coc/config.yaml` is absent (backward compat).
- [ ] When only `~/.coc.yaml` exists, it is auto-copied to `~/.coc/config.yaml` on first load.
- [ ] When both files exist, `~/.coc/config.yaml` takes precedence.
- [ ] Explicit `configPath` argument bypasses all fallback/migration logic.
- [ ] All existing config tests still pass.
- [ ] Documentation references updated to `~/.coc/config.yaml`.

## Dependencies

_None — this is a self-contained change within the `packages/coc` package._
