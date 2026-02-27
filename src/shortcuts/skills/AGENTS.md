# Skills - Developer Reference

This module discovers, scans, and installs reusable skills (code modules identified by a `SKILL.md` marker file) from three source types: GitHub repositories, local filesystem paths, and skills bundled with the extension. It provides VS Code commands for interactive skill installation with progress UI, conflict resolution, and multi-select.

## Architecture / Structure

```
skills/
├── index.ts                    # Re-exports all public modules
├── types.ts                    # Core interfaces and defaults
├── commands.ts                 # SkillsCommands class (VS Code command handlers)
├── source-detector.ts          # Parses user input into ParsedSource (GitHub URL or local path)
├── skill-scanner.ts            # Discovers skills from a parsed source
├── skill-installer.ts          # Copies/downloads skills to the workspace
└── bundled-skills-provider.ts  # Manages skills shipped with the extension
```

**Data flow:** User input → `detectSource()` → `scanForSkills()` → user selects skills → `installSkills()` or `installBundledSkills()`

## Public API

| Export | Type | Description |
|--------|------|-------------|
| `SkillsCommands` | class | Registers `skills.install` and `skills.installBuiltIn` commands |
| `detectSource(input, workspaceRoot)` | function | Parses input string into a `ParsedSource` (discriminated union result) |
| `scanForSkills(source, installPath)` | function | Scans a parsed source for directories containing `SKILL.md` |
| `installSkills(skills, source, installPath, handleConflict)` | function | Installs skills from GitHub or local sources |
| `getBundledSkillsPath(context)` | function | Returns path to `dist/resources/bundled-skills/` |
| `getBundledSkills(context, installPath)` | function | Returns `DiscoveredSkill[]` for bundled skills |
| `installBundledSkills(skills, installPath, handleConflict)` | function | Copies bundled skills to workspace |
| `SourceDetectionErrors` | const | Error message constants for source detection |

**Key types:** `SkillSourceType`, `DiscoveredSkill`, `ParsedSource`, `ScanResult`, `InstallResult`, `InstallDetail`, `SkillsSettings`, `BundledSkill`

## Dependencies

**External:**
- `vscode` — commands, QuickPick, progress notifications, workspace config

**Internal (`../shared`):**
- File I/O: `safeExists`, `safeReadDir`, `safeReadFile`, `safeStats`, `safeCopyFile`, `safeWriteFile`, `ensureDirectoryExists`
- Network: `httpGetJson`, `httpDownload`
- Process: `execAsync` (for `gh` CLI)
- Logging: `getExtensionLogger`, `LogCategory`
- Workspace: `getWorkspaceRoot`

## Build & Test

No standalone build or test config — compiled and tested at the workspace root level:
```bash
npm run compile    # Build
npm run test       # Run all tests
```

## Key Patterns

- **Skill identification:** A directory is a valid skill if it contains a `SKILL.md` file. Descriptions are extracted from the first non-heading paragraph.
- **Source types:** `'github'` (URL parsed into owner/repo/branch/path), `'local'` (absolute or relative path, `~` expanded), `'bundled'` (shipped in `dist/resources/bundled-skills/`).
- **GitHub dual strategy:** Uses `gh` CLI for authenticated API calls when available; falls back to unauthenticated GitHub REST API via native HTTP. The `gh` CLI path avoids `--jq` and shell piping for cross-platform compatibility.
- **Conflict handling:** Callers provide an async `handleConflict(skillName)` callback that returns `true` to replace or `false` to skip.
- **Bundled skills registry:** Hardcoded in `bundled-skills-provider.ts` (`BUNDLED_SKILLS_REGISTRY` array). Adding a new bundled skill requires updating this registry and placing files under `resources/bundled-skills/<name>/`.
- **Default install path:** `.github/skills` relative to workspace root. Configurable via `workspaceShortcuts.skills.installPath` setting.

## Notes

- The `gh` CLI availability check is cached per module load (separate caches in `skill-scanner.ts` and `skill-installer.ts`).
- GitHub URL parsing supports `/tree/branch/path`, `/blob/branch/path`, and bare `owner/repo` formats. Default branch is `main`.
- Local path detection supports Unix absolute, `~` home, `./`/`../` relative, Windows drive letters, and UNC paths.
- The `removeDirectory` function in both `skill-installer.ts` and `bundled-skills-provider.ts` uses synchronous `fs.unlinkSync`/`fs.rmdirSync` (duplicated implementation).
