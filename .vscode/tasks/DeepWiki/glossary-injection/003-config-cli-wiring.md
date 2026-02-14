---
status: pending
---

# 003: Config, CLI & Generate Wiring for Glossary Injection

## Summary

Wire the glossary through the full CLI → config → generate → analysis pipeline so that users can provide a glossary via `--glossary <path>`, a config file field, or zero-config auto-discovery of `glossary.yaml` in the repo root.

## Motivation

Commits 001 (types + loader) and 002 (prompt injection) established the data model (`GlossaryEntry[]`, `loadGlossary()`, `formatGlossaryForPrompt()`) and the analysis prompt integration. This commit connects those pieces to the user-facing CLI and the generate command's orchestration, making the feature end-to-end functional.

## Changes

### 1. `packages/deep-wiki/src/cli.ts` — Add `--glossary` option

Add a new option to the `generate` command (around line 170, alongside existing options):

```typescript
.option('--glossary <path>', 'Path to a glossary YAML file for analysis prompts')
```

Include it in the `cliOptions` object (around line 177):

```typescript
glossary: opts.glossary as string | undefined,
```

### 2. `packages/deep-wiki/src/types.ts` — No changes needed

All type additions (`GlossaryEntry`, fields on `DeepWikiConfigFile`, `GenerateCommandOptions`, `AnalysisOptions`) were already done in commit 001. This commit only wires them.

### 3. `packages/deep-wiki/src/config-loader.ts` — Merge glossary fields

**`mergeConfigWithCLI()`** (line ~102): Add resolution for the new fields after the existing `resolve()` calls (around line 151):

```typescript
glossary: resolve('glossary', cliOptions.glossary, config.glossaryFile),
```

The CLI `--glossary` flag maps to the same field as config's `glossaryFile` — both are paths. The inline `config.glossary` array is handled separately in `executeGenerate()`.

**`validateConfig()`** (line ~275): Add validation for the new fields:

```typescript
assignString(raw, 'glossaryFile', config);
```

For inline `glossary` array: validate it's an array of objects with `term` (string) and `definition` (string), optional `aliases` (string array).

### 4. `packages/deep-wiki/src/commands/generate.ts` — Resolve and pass glossary

In `executeGenerate()`, after config loading and before Phase 3 (between lines ~134 and ~166), add glossary resolution:

```typescript
// Resolve glossary
// Priority: CLI --glossary > config glossaryFile > config inline glossary > auto-discover
let glossaryEntries: GlossaryEntry[] | undefined;

if (cliOptions.glossary) {
    // CLI flag: load from explicit path
    glossaryEntries = loadGlossary(path.resolve(cliOptions.glossary));
} else if (cliOptions.glossaryFile) {
    // Config file: glossaryFile path (resolve relative to config dir or repo root)
    const glossaryPath = path.resolve(absoluteRepoPath, cliOptions.glossaryFile);
    glossaryEntries = loadGlossary(glossaryPath);
} else if (cliOptions.glossaryInline) {
    // Config file: inline glossary entries
    glossaryEntries = cliOptions.glossaryInline;
} else {
    // Auto-discover: look for glossary.yaml / glossary.yml in repo root
    const discovered = discoverGlossaryFile(absoluteRepoPath);
    if (discovered) {
        glossaryEntries = loadGlossary(discovered);
        if (cliOptions.verbose) {
            printInfo(`Auto-discovered glossary: ${discovered}`);
        }
    }
}

if (glossaryEntries && glossaryEntries.length > 0) {
    cliOptions.glossaryEntries = glossaryEntries;
    printKeyValue('Glossary', `${glossaryEntries.length} terms`);
}
```

Import `loadGlossary` and `discoverGlossaryFile` from the glossary module, and `GlossaryEntry` from glossary types (established in commit 001).

### 5. `packages/deep-wiki/src/commands/phases/analysis-phase.ts` — Pass glossary to analyzeModules

In `runPhase3Analysis()`, pass the glossary entries through to `analyzeModules()` (around line 191):

```typescript
const result = await analyzeModules(
    {
        graph: subGraph,
        model: analysisModel,
        timeout: analysisTimeout ? analysisTimeout * 1000 : undefined,
        concurrency,
        depth: analysisDepth,
        repoPath,
        glossaryEntries: options.glossaryEntries,  // <-- add this
    },
    analysisInvoker,
    // ... rest unchanged
);
```

Add a log line near the top of the function (after the header, around line 62):

```typescript
if (options.glossaryEntries?.length) {
    printInfo(`Using glossary with ${options.glossaryEntries.length} terms`);
}
```

### 6. `packages/deep-wiki/src/glossary/loader.ts` — Add `discoverGlossaryFile()`

Add a discovery function (similar to `discoverConfigFile()` in `config-loader.ts`):

```typescript
export function discoverGlossaryFile(dir: string): string | undefined {
    const candidates = ['glossary.yaml', 'glossary.yml'];
    for (const filename of candidates) {
        const candidate = path.join(dir, filename);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}
```

### 7. `packages/deep-wiki/src/analysis/index.ts` — Thread glossary through

In `analyzeModules()`, pass `glossaryEntries` from `AnalysisOptions` to `runAnalysisExecutor()` options, which will forward it to the prompt builder (established in commit 002).

## Resolution Priority

The glossary source is resolved in this order (first match wins):

1. **CLI `--glossary <path>`** — Explicit path from command line
2. **Config `glossaryFile`** — Path in `deep-wiki.config.yaml` (relative to config dir or repo root)
3. **Config inline `glossary`** — Array of `{term, definition, aliases?}` in config file
4. **Auto-discovery** — `glossary.yaml` or `glossary.yml` in the repo root

## Config File Example

```yaml
# deep-wiki.config.yaml

# Option A: Reference external file
glossaryFile: docs/glossary.yaml

# Option B: Inline definitions
glossary:
  - term: DAG
    definition: Directed Acyclic Graph — the core scheduling data structure
    aliases: [directed acyclic graph]
  - term: Operator
    definition: A single task unit in the pipeline
```

If both `glossaryFile` and `glossary` are present, `glossaryFile` takes precedence.

## Tests

- Test `mergeConfigWithCLI()` with glossary/glossaryFile fields
- Test `validateConfig()` accepts valid glossary configs and rejects invalid ones
- Test `discoverGlossaryFile()` finds `glossary.yaml` and `glossary.yml`
- Test resolution priority in `executeGenerate()` (mock loadGlossary)
- Test that `runPhase3Analysis()` passes glossary entries through to `analyzeModules()`
- Run `npm run test:run` in `packages/deep-wiki/` to confirm all existing tests pass

## Acceptance Criteria

- [ ] `deep-wiki generate --glossary ./glossary.yaml .` loads and uses the glossary
- [ ] `glossaryFile` in config file is resolved and loaded
- [ ] Inline `glossary` array in config file is used when no file path is given
- [ ] Auto-discovery finds `glossary.yaml` in repo root when no explicit source is set
- [ ] CLI `--glossary` overrides config file settings
- [ ] Glossary terms are logged during Phase 3 (e.g., "Using glossary with 15 terms")
- [ ] `--glossary` with a non-existent file produces a clear error
- [ ] All existing tests pass unchanged

## Dependencies

- Depends on: 001 (types + loader), 002 (prompt injection)
- Depended on by: 004 (tests + documentation)
