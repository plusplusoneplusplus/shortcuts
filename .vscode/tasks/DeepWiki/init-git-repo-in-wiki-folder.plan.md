# Initialize Wiki Folder as Git Repository

## Description

The `deep-wiki init` command (and the generate pipeline that creates the wiki output folder) should also initialize the wiki output directory as a Git repository and add a `.gitignore` file. This enables users to track wiki changes over time, commit snapshots, and push to remote repositories for hosting or collaboration — independent of the source repo's history.

## Acceptance Criteria

- [x] When the wiki output folder is created (during `init`, `generate`, or `discover`), it is initialized as a Git repository (`git init`) if it is not already one
- [x] A `.gitignore` file is created in the wiki output folder with sensible defaults (e.g., ignoring OS files, editor temp files, and any cache/build artifacts)
- [x] If the wiki folder is already a Git repository, the command does **not** re-initialize it
- [x] If a `.gitignore` already exists, it is **not** overwritten
- [x] The behavior works cross-platform (macOS, Linux, Windows)
- [x] Existing tests continue to pass; new tests cover the git init and gitignore logic

## Subtasks

### 1. Add Git init utility function
- Create a helper (e.g., `initGitRepo(dir: string)`) that:
  - Checks if `dir/.git` already exists; if so, skips
  - Runs `git init` in the directory
  - Logs the result via the existing logger

### 2. Add `.gitignore` writer
- Create a helper (e.g., `writeGitignore(dir: string)`) that:
  - Checks if `dir/.gitignore` already exists; if so, skips
  - Writes a default `.gitignore` with entries such as:
    ```
    # OS files
    .DS_Store
    Thumbs.db

    # Editor files
    *.swp
    *.swo
    *~

    # Node/build artifacts
    node_modules/
    ```

### 3. Integrate into wiki output creation flow
- Call the git init and gitignore helpers after the wiki output directory is created
- Candidate integration points:
  - `writeWikiOutput()` in `src/writing/file-writer.ts`
  - Or the generate/discover command orchestrators in `src/commands/`
- Ensure it runs only once per pipeline execution, not per-module

### 4. Add tests
- Unit tests for `initGitRepo` (skips if already init'd, creates `.git/` otherwise)
- Unit tests for `writeGitignore` (skips if file exists, creates with expected content)
- Integration test verifying end-to-end: output dir → git repo + `.gitignore`

## Notes

- Use `child_process.execSync` or `execa` (if available) for running `git init`; handle the case where `git` is not installed gracefully (log a warning, don't fail the pipeline)
- The `.gitignore` content can be kept minimal initially and expanded later
- Consider making this opt-out via a CLI flag (e.g., `--no-git`) or config option if users don't want git initialization
- Related files: `packages/deep-wiki/src/writing/file-writer.ts`, `packages/deep-wiki/src/commands/generate.ts`
