# Add repo-path to deep-wiki config file

## Description

Currently, `repo-path` is always passed as a **positional CLI argument** to `discover`, `generate`, and `seeds` commands. The config file (`deep-wiki.config.yaml`) already serves as the central configuration source but lacks `repoPath` as a usable field — even though the `DeepWikiConfigFile` type defines an optional `repoPath?: string`, it is never read from the config or used as a fallback.

This task adds full support for `repoPath` in the config file so it becomes the **single source of meta info** about the wiki's target repository. With this change, the CLI commands no longer require `repo-path` as a mandatory positional argument when a config file is present.

## Acceptance Criteria

- [x] `repoPath` in `deep-wiki.config.yaml` is loaded and used as the default repo path for `discover`, `generate`, and `seeds` commands
- [x] CLI positional `<repo-path>` argument becomes **optional** (not required) for `discover`, `generate`, and `seeds` when `repoPath` is set in config
- [x] CLI positional argument **overrides** config file `repoPath` when both are provided (consistent with existing CLI-over-config precedence)
- [x] `serve --generate` option also respects config `repoPath` as fallback
- [x] Clear error message when neither CLI argument nor config `repoPath` is provided
- [x] Config template in `init.ts` includes a commented `repoPath` example
- [x] Path resolution works the same way (resolved to absolute path) regardless of source (CLI or config)
- [x] All existing CLI usage with positional `<repo-path>` continues to work unchanged (backward compatible)
- [x] Existing tests pass; new tests added for config-based repo-path resolution

## Subtasks

### 1. Update config loader to surface `repoPath`
- In `config-loader.ts`, ensure `repoPath` from the YAML config is included in the resolved options
- Apply the same absolute-path resolution logic used for CLI args

### 2. Make CLI positional argument optional
- In `cli.ts`, change `<repo-path>` (required) to `[repo-path]` (optional) for `discover`, `generate`, and `seeds` commands
- Add fallback logic: if positional arg is absent, read from loaded config's `repoPath`
- Emit a clear error if neither source provides a repo path

### 3. Update command handlers
- In `commands/discover.ts`, `commands/generate.ts`, and `commands/seeds.ts`, accept `repoPath` as potentially coming from config
- Ensure validation (path exists, is a directory) still runs regardless of source

### 4. Update `serve --generate` flow
- When `--generate` is used without a value, fall back to config `repoPath`
- Adjust option definition if needed (e.g., `--generate [repo-path]`)

### 5. Update config template
- In `commands/init.ts`, add a commented `# repoPath: /path/to/your/repo` line to the template with a brief explanation

### 6. Add / update tests
- Test: config provides `repoPath`, no CLI arg → uses config value
- Test: both config and CLI provide `repoPath` → CLI wins
- Test: neither provides `repoPath` → clear error
- Test: relative path in config is resolved to absolute

## Notes

- The `DeepWikiConfigFile` type already has `repoPath?: string` defined in `types.ts` — no type changes needed
- Resolution order stays: **CLI flags → Phase-specific config → Global config → Built-in defaults**
- The config file is auto-discovered from CWD (`deep-wiki.config.yaml` / `.yml`), so users working inside the repo directory get zero-arg usage naturally
- Consider logging which source the repo-path came from (CLI vs config) at verbose level for debuggability
