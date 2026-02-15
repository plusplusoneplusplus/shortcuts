---
status: pending
priority: high
commit: 1 of 4
feature: Glossary Injection into Phase 3 Analysis
package: deep-wiki
---

# Commit 1: Glossary Types, Loader, and Config Validation

Add the `GlossaryEntry` type, wire glossary fields into `DeepWikiConfigFile`/`GenerateCommandOptions`/`AnalysisOptions`, create a standalone glossary file loader, update config validation, and add a prompt-formatting helper.

## Glossary YAML Format

```yaml
# glossary.yaml — standalone file
glossary:
  - term: WAL
    expansion: Write-Ahead Log
    definition: Append-only file for crash recovery and durability
  - term: LSM
    expansion: Log-Structured Merge Tree
  - term: ShortcutGroup
    definition: A logical grouping of files/folders in the workspace sidebar
```

Only `term` is required. `expansion` covers acronyms; `definition` covers jargon/domain terms.

The glossary can be specified:
- **Inline** in `deep-wiki.config.yaml` under a `glossary` key
- **Via file reference** using `glossaryFile` pointing to a separate YAML file
- **Both** — inline entries take precedence for duplicate terms

---

## Files to Change

### 1. `packages/deep-wiki/src/types.ts`

**1a. New `GlossaryEntry` interface** — add after the `PhasesConfig` type (around line 459), before the "Generate Command Options" section:

```typescript
// ============================================================================
// Glossary Types
// ============================================================================

/**
 * A single glossary entry providing terminology context for AI analysis.
 * Only `term` is required; `expansion` covers acronyms, `definition` covers jargon.
 */
export interface GlossaryEntry {
    /** The term or acronym (required) */
    term: string;
    /** Full expansion of an acronym (e.g., "Write-Ahead Log" for WAL) */
    expansion?: string;
    /** Longer definition for domain jargon */
    definition?: string;
}
```

**1b. Add to `DeepWikiConfigFile`** (around line 180–219) — add two optional fields alongside the existing config fields:

```typescript
/** Inline glossary entries (term definitions for AI context) */
glossary?: GlossaryEntry[];
/** Path to a standalone glossary YAML file */
glossaryFile?: string;
```

**1c. Add to `GenerateCommandOptions`** (around line 468–511) — add resolved glossary:

```typescript
/** Resolved glossary entries (loaded from glossaryFile, inline, or both) */
glossary?: GlossaryEntry[];
```

**1d. Add to `AnalysisOptions`** (around line 323–336) — add glossary passthrough:

```typescript
/** Glossary entries for terminology context in analysis prompts */
glossary?: GlossaryEntry[];
```

### 2. `packages/deep-wiki/src/config-loader.ts`

**2a. Update `validateConfig()`** — add validation for `glossary` array and `glossaryFile` string after the existing boolean/enum field validations (around line 316–318):

```typescript
// Glossary file path
assignString(raw, 'glossaryFile', config);

// Inline glossary array
if (raw.glossary !== undefined) {
    if (!Array.isArray(raw.glossary)) {
        throw new Error('Config error: "glossary" must be an array');
    }
    for (let i = 0; i < raw.glossary.length; i++) {
        const entry = raw.glossary[i];
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            throw new Error(`Config error: glossary[${i}] must be an object`);
        }
        if (typeof (entry as Record<string, unknown>).term !== 'string' || (entry as Record<string, unknown>).term === '') {
            throw new Error(`Config error: glossary[${i}].term must be a non-empty string`);
        }
        const exp = (entry as Record<string, unknown>).expansion;
        if (exp !== undefined && typeof exp !== 'string') {
            throw new Error(`Config error: glossary[${i}].expansion must be a string`);
        }
        const def = (entry as Record<string, unknown>).definition;
        if (def !== undefined && typeof def !== 'string') {
            throw new Error(`Config error: glossary[${i}].definition must be a string`);
        }
    }
    config.glossary = raw.glossary;
}
```

**2b. New function `loadGlossaryFile(filePath: string): GlossaryEntry[]`** — add in `config-loader.ts` after `loadConfig()`. Loads a standalone `glossary.yaml` file, validates it has a `glossary` array at the root, and validates each entry:

```typescript
/**
 * Load and validate a standalone glossary YAML file.
 *
 * Expected format:
 *   glossary:
 *     - term: WAL
 *       expansion: Write-Ahead Log
 *       definition: ...
 */
export function loadGlossaryFile(filePath: string): GlossaryEntry[] {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Glossary file not found: ${absolutePath}`);
    }
    const content = fs.readFileSync(absolutePath, 'utf-8');
    let parsed: unknown;
    try {
        parsed = yaml.load(content);
    } catch (e) {
        throw new Error(`Invalid YAML in glossary file: ${getErrorMessage(e)}`);
    }
    if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
        throw new Error('Glossary file is empty or not a valid YAML object');
    }
    const raw = parsed as Record<string, unknown>;
    if (!Array.isArray(raw.glossary)) {
        throw new Error('Glossary file must contain a "glossary" array at the root');
    }
    // Reuse validation from validateConfig's glossary block
    for (let i = 0; i < raw.glossary.length; i++) {
        const entry = raw.glossary[i];
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
            throw new Error(`Glossary error: glossary[${i}] must be an object`);
        }
        if (typeof entry.term !== 'string' || entry.term === '') {
            throw new Error(`Glossary error: glossary[${i}].term must be a non-empty string`);
        }
    }
    return raw.glossary as GlossaryEntry[];
}
```

> **Note:** Factor out a shared `validateGlossaryEntries()` helper to avoid duplicating the per-entry validation between `validateConfig()` and `loadGlossaryFile()`.

**2c. New function `resolveGlossary()`** — resolves the final glossary from file + inline config:

```typescript
/**
 * Resolve glossary entries from a config file path and/or inline entries.
 * - If glossaryFile is set, loads entries from the file
 * - If glossary is set inline, uses those entries
 * - If both, merges (inline wins for duplicate terms)
 *
 * @param glossaryFile - Path to standalone glossary YAML (optional)
 * @param inlineGlossary - Inline glossary entries from config (optional)
 * @param basePath - Base directory for resolving relative glossaryFile paths
 * @returns Merged GlossaryEntry[] or undefined if neither source is set
 */
export function resolveGlossary(
    glossaryFile?: string,
    inlineGlossary?: GlossaryEntry[],
    basePath?: string
): GlossaryEntry[] | undefined {
    let fileEntries: GlossaryEntry[] = [];
    if (glossaryFile) {
        const resolved = basePath ? path.resolve(basePath, glossaryFile) : path.resolve(glossaryFile);
        fileEntries = loadGlossaryFile(resolved);
    }
    if (!fileEntries.length && !inlineGlossary?.length) {
        return undefined;
    }
    if (!inlineGlossary?.length) return fileEntries;
    if (!fileEntries.length) return inlineGlossary;

    // Merge: build map keyed by lowercase term, inline overrides file entries
    const map = new Map<string, GlossaryEntry>();
    for (const entry of fileEntries) {
        map.set(entry.term.toLowerCase(), entry);
    }
    for (const entry of inlineGlossary) {
        map.set(entry.term.toLowerCase(), entry);
    }
    return Array.from(map.values());
}
```

**2d. New function `formatGlossaryForPrompt()`** — formats entries for AI prompt injection:

```typescript
/**
 * Format glossary entries into a readable block for AI prompt injection.
 *
 * Output example:
 *   - **WAL** (Write-Ahead Log): Append-only file for crash recovery
 *   - **ShortcutGroup**: A logical grouping of files/folders
 */
export function formatGlossaryForPrompt(glossary: GlossaryEntry[]): string {
    if (!glossary.length) return '';
    const lines = glossary.map(entry => {
        let line = `- **${entry.term}**`;
        if (entry.expansion) line += ` (${entry.expansion})`;
        if (entry.definition) line += `: ${entry.definition}`;
        return line;
    });
    return lines.join('\n');
}
```

**2e. Update `mergeConfigWithCLI()`** — add glossary resolution after the existing merge logic (before the `return` statement):

```typescript
// Resolve glossary: load from file and/or inline, merge
const configDir = cliOptions.config ? path.dirname(path.resolve(cliOptions.config)) : undefined;
const resolvedGlossary = resolveGlossary(config.glossaryFile, config.glossary, configDir);
```

Then add to the returned object:

```typescript
glossary: resolvedGlossary,
```

**2f. Update imports** at the top of `config-loader.ts` — add `GlossaryEntry` to the type import:

```typescript
import type {
    DeepWikiConfigFile,
    GenerateCommandOptions,
    GlossaryEntry,  // ← add
    PhaseName,
    PhasesConfig,
    WebsiteTheme,
} from './types';
```

### 3. `packages/deep-wiki/test/config-loader.test.ts`

Add a new `describe('glossary')` block with the following test cases, following the existing patterns (temp files, `writeConfigFile` helper, `makeDefaultCLI`):

**Validation tests:**
- `glossary with valid entries passes validation`
- `glossary entry missing term throws`
- `glossary entry with non-string term throws`
- `glossary as non-array throws`
- `glossary entry with non-string expansion throws`
- `glossary entry with non-string definition throws`
- `glossaryFile as non-string throws`
- `glossary with only term (no expansion/definition) is valid`

**loadGlossaryFile tests:**
- `loads a valid standalone glossary file`
- `throws for missing glossary file`
- `throws for invalid YAML in glossary file`
- `throws when glossary key missing from file`
- `throws when glossary file entry has no term`

**resolveGlossary tests:**
- `returns undefined when no sources`
- `returns file entries when only glossaryFile set`
- `returns inline entries when only inline set`
- `merges file and inline, inline wins for duplicate terms`

**formatGlossaryForPrompt tests:**
- `formats entry with term + expansion + definition`
- `formats entry with term only`
- `formats entry with term + expansion (no definition)`
- `returns empty string for empty array`

**mergeConfigWithCLI tests:**
- `glossary from config is resolved in merged output`

---

## Acceptance Criteria

- [ ] `GlossaryEntry` type exported from `types.ts`
- [ ] `DeepWikiConfigFile` has `glossary?` and `glossaryFile?` fields
- [ ] `GenerateCommandOptions` has `glossary?` field
- [ ] `AnalysisOptions` has `glossary?` field
- [ ] `validateConfig()` validates glossary array entries and `glossaryFile` string
- [ ] `loadGlossaryFile()` loads and validates standalone YAML files
- [ ] `resolveGlossary()` merges file + inline entries (inline wins on duplicates)
- [ ] `formatGlossaryForPrompt()` produces readable markdown-style output
- [ ] `mergeConfigWithCLI()` resolves glossary into the merged options
- [ ] All new tests pass (`npm run test:run` in `packages/deep-wiki/`)
- [ ] Existing tests still pass (no regressions)
- [ ] No changes to Phase 3 analysis prompts yet (that's commit 2)
