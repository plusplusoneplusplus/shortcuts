# Publish to VS Code Marketplace

Publish the current code to the VS Code Marketplace with proper versioning and changelog updates.

## Steps to Execute

### 1. Analyze Changes Since Last Published Version
- Run `git log --oneline` to see recent commits since the last version tag
- Run `git diff $(git describe --tags --abbrev=0) HEAD --stat` to understand the scope of changes
- Categorize changes as: **major** (breaking changes), **minor** (new features), or **patch** (bug fixes/improvements)

### 2. Determine Version Bump
Based on the diff analysis:
- **Major** (X.0.0): Breaking changes, major rewrites, incompatible API changes
- **Minor** (X.Y.0): New features, significant improvements, new commands
- **Patch** (X.Y.Z): Bug fixes, small improvements, documentation updates

### 3. Update Version in package.json
- Bump the `"version"` field according to the analysis
- Use `npm version patch|minor|major --no-git-tag-version` or edit directly

### 4. Update CHANGELOG.md
- Add a new section under `## [Unreleased]` with the new version and today's date
- Format: `## [X.Y.Z] - YYYY-MM-DD`
- Keep changelog entries SHORT and highlight-focused:
  - Only include significant user-facing changes
  - Use categories: Added, Changed, Fixed, Removed (only as needed)
  - Each entry should be one concise line
  - Skip internal refactoring, test changes, or minor tweaks

### 5. Build and Package
```bash
npm run compile
npm run package
```

### 6. Publish to Marketplace
```bash
npm run vsce:publish
```
Note: This requires VSCE_PAT environment variable or prior `vsce login`

### 7. Commit and Tag
```bash
git add package.json CHANGELOG.md
git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
```

### 8. Push to Remote
```bash
git push origin main
git push origin vX.Y.Z
```

## Requirements
- `vsce` CLI installed (`npm install -g @vscode/vsce`)
- Valid Personal Access Token (PAT) for VS Code Marketplace
- Clean working directory (no uncommitted changes beyond version files)

