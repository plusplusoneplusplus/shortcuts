# Publish deep-wiki CLI to npm

Publish the `@plusplusoneplusplus/deep-wiki` package to npm with proper versioning, changelog, and testing.

## Steps to Execute

### 1. Analyze Changes Since Last Published Version
- Run `git log --oneline -- packages/deep-wiki/` to see recent deep-wiki commits since the last version tag
- Run `git diff $(git describe --tags --match "deep-wiki-v*" --abbrev=0 2>/dev/null || echo HEAD~20) HEAD --stat -- packages/deep-wiki/` to understand the scope of changes
- Categorize changes as: **major** (breaking changes), **minor** (new features), or **patch** (bug fixes/improvements)

### 2. Determine Version Bump
Based on the diff analysis:
- **Major** (X.0.0): Breaking changes, incompatible API changes, removed commands
- **Minor** (X.Y.0): New features, new phases, new commands, significant improvements
- **Patch** (X.Y.Z): Bug fixes, small improvements, dependency updates

### 3. Run Tests
```bash
cd packages/deep-wiki
npm run test:run
```
All tests must pass before publishing.

### 4. Update Version in package.json
- Bump the `"version"` field in `packages/deep-wiki/package.json` according to the analysis
- Use `npm version patch|minor|major --no-git-tag-version` (inside `packages/deep-wiki/`) or edit directly

### 5. Update CHANGELOG.md
- If `packages/deep-wiki/CHANGELOG.md` doesn't exist, create it
- Add a new section with the new version and today's date
- Format: `## [X.Y.Z] - YYYY-MM-DD`
- Keep changelog entries SHORT and highlight-focused:
  - Only include significant user-facing changes
  - Use categories: Added, Changed, Fixed, Removed (only as needed)
  - Each entry should be one concise line
  - Skip internal refactoring, test changes, or minor tweaks

### 6. Build
```bash
cd packages/deep-wiki
npm run build
```

### 7. Publish to npm
```bash
cd packages/deep-wiki
npm publish --access public
```
Note: This requires npm authentication (`npm login`) and permissions on the `@plusplusoneplusplus` scope.

### 8. Commit and Tag
```bash
git add packages/deep-wiki/package.json packages/deep-wiki/CHANGELOG.md
git commit -m "chore: release @plusplusoneplusplus/deep-wiki vX.Y.Z"
git tag deep-wiki-vX.Y.Z
```

### 9. Push to Remote
```bash
git push origin main
git push origin deep-wiki-vX.Y.Z
```

## Requirements
- npm authentication configured (`npm login` or `NPM_TOKEN` env var)
- Publish rights on the `@plusplusoneplusplus` scope
- All 304+ tests passing
- Clean working directory (no uncommitted changes beyond version files)

## Verifying the Publish
```bash
npm info @plusplusoneplusplus/deep-wiki
```
