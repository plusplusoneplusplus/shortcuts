---
status: pending
---

# 009: CLI Topic Command and Orchestrator

## Summary
Register the `deep-wiki topic` command in the CLI and create the orchestration function that wires together all topic modules (coverage check → probe → outline → analysis → writing → file output → wiki integration).

## Motivation
This is the user-facing entry point that ties everything together. It follows the established command patterns (Commander.js registration, exit codes, spinner progress, option parsing) and orchestrates the full topic generation pipeline. The `--check` and `--list` sub-flows are handled here too.

## Changes

### Files to Create
- `packages/deep-wiki/src/commands/topic.ts` — Command orchestrator
- `packages/deep-wiki/test/commands/topic.test.ts` — Tests

### Files to Modify
- `packages/deep-wiki/src/cli.ts` — Register `topic` command with Commander.js

## Implementation Notes

### CLI Registration in `cli.ts`

```typescript
program
    .command('topic')
    .description('Generate focused wiki articles about a specific topic/feature')
    .argument('<repo-path>', 'Path to the repository to analyze')
    .argument('[topic-name]', 'Topic to generate (e.g., "compaction", "authentication")')
    .option('-d, --description <text>', 'Description to guide topic discovery')
    .option('-w, --wiki <path>', 'Path to existing wiki directory', './wiki')
    .option('--force', 'Regenerate even if topic already exists', false)
    .option('--check', 'Only check if topic exists, do not generate', false)
    .option('--list', 'List existing topic articles', false)
    .option('-m, --model <model>', 'AI model to use')
    .option('--depth <level>', 'Article detail level: shallow, normal, deep', 'normal')
    .option('-t, --timeout <seconds>', 'Timeout per AI call in seconds', (v) => parseInt(v, 10), 120)
    .option('-c, --concurrency <number>', 'Parallel AI sessions', (v) => parseInt(v, 10), 3)
    .option('--no-cross-link', 'Skip cross-linking module articles')
    .option('--no-website', 'Skip website regeneration')
    .option('--interactive', 'Review outline before generating', false)
    .option('-v, --verbose', 'Verbose output', false)
    .option('--no-color', 'Disable colored output')
    .action(async (repoPath: string, topicName: string | undefined, opts) => {
        applyGlobalOptions(opts);
        const { executeTopic } = await import('./commands/topic');
        const exitCode = await executeTopic(repoPath, topicName, opts);
        process.exit(exitCode);
    });
```

### `commands/topic.ts` Structure

```typescript
export async function executeTopic(
    repoPath: string,
    topicName: string | undefined,
    options: TopicCommandOptions
): Promise<number> {
    // 1. Validate inputs
    //    - repoPath exists
    //    - topicName provided (unless --list)
    //    - wiki directory exists (unless generating standalone)

    // 2. Handle --list sub-flow
    //    if (options.list) {
    //        const topics = listTopicAreas(options.wiki);
    //        printTopicList(topics);
    //        return EXIT_CODES.SUCCESS;
    //    }

    // 3. Load existing wiki (if available)
    //    const graph = loadWikiGraph(options.wiki);

    // 4. Handle --check sub-flow
    //    const coverage = checkTopicCoverage(topicRequest, graph, options.wiki);
    //    if (options.check) {
    //        printCoverageResult(coverage);
    //        return EXIT_CODES.SUCCESS;
    //    }

    // 5. Check coverage (with --force override)
    //    if (coverage.status === 'exists' && !options.force) {
    //        printInfo('Topic already covered. Use --force to regenerate.');
    //        return EXIT_CODES.SUCCESS;
    //    }

    // 6. Get git hash for caching
    //    const gitHash = await getFolderHeadHash(repoPath);

    // 7. Phase A: Topic Probe
    //    spinner.start('Probing codebase for topic...');
    //    - Check topic cache first
    //    - Run probe if not cached
    //    - Save to cache

    // 8. Phase B: Topic Outline
    //    spinner.start('Decomposing topic into articles...');
    //    - Check outline cache
    //    - Generate outline if not cached
    //    - If --interactive, display outline and ask for confirmation
    //    - Save to cache

    // 9. Phase C: Topic Analysis
    //    spinner.start('Analyzing topic code...');
    //    - Check analysis cache
    //    - Run analysis if not cached
    //    - Save to cache

    // 10. Phase D: Article Generation
    //     spinner.start('Generating articles...');
    //     - Generate articles with onArticleComplete cache callback
    //     - Save to cache

    // 11. Phase E: File Writing & Wiki Integration
    //     spinner.start('Writing to wiki...');
    //     - Write articles to disk
    //     - Update module-graph.json
    //     - Update index.md
    //     - Add cross-links (unless --no-cross-link)

    // 12. Phase F: Website Regeneration (optional)
    //     if (!options.noWebsite) {
    //         spinner.start('Regenerating website...');
    //         // Reuse existing Phase 5 website generator
    //     }

    // 13. Print summary
    //     printTopicSummary(result);
    //     return EXIT_CODES.SUCCESS;
}
```

### Progress Output
Follow the established pattern from the generate command:
```
🔍 Deep Wiki — Topic Generation
─────────────────────────────────
Repository:  /path/to/rocksdb
Topic:       compaction
Description: LSM-tree compaction strategies
Wiki:        ./wiki
Depth:       normal

🔍 Checking existing coverage...   ✓ Topic is new
🔬 Probing codebase...             ✓ Found 7 modules, 23 files (12s)
📋 Planning article structure...    ✓ Area: index + 5 sub-articles (8s)
🔬 Analyzing topic code...          ✓ 6/6 analyses complete (45s)
✍️  Generating articles...           ✓ 6/6 articles generated (38s)
📁 Writing to wiki...               ✓ 6 files written
🔗 Cross-linking modules...         ✓ 3 module articles updated
🌐 Regenerating website...          ✓ Website updated

✅ Topic area generated: wiki/topics/compaction/
   📄 6 articles (index + 5 sub-articles)
   📊 7 modules, 23 key files
   ⏱  1m 43s
```

### Error Handling
- AI service unavailable → EXIT_CODES.AI_UNAVAILABLE
- Probe finds nothing → helpful message with suggestions
- Outline generation fails → use fallback outline
- Individual article fails → continue with others, report failures
- File write errors → EXIT_CODES.EXECUTION_ERROR

## Tests
- **Validation**: Non-existent repo path → CONFIG_ERROR
- **--list flow**: List topics from wiki → prints table, returns SUCCESS
- **--check flow**: Check coverage → prints result, returns SUCCESS  
- **Topic exists (no --force)**: Returns SUCCESS with info message
- **Topic exists (--force)**: Proceeds with generation
- **Full pipeline (mocked)**: Mock all phases, verify orchestration order
- **Cache hit**: Each phase checks cache before AI call
- **AI unavailable**: Returns AI_UNAVAILABLE exit code
- **Empty probe result**: Helpful error message
- **Partial article failure**: Completes with warnings
- **--interactive outline**: (mock stdin) Verify outline displayed and confirmation requested

## Acceptance Criteria
- [ ] `deep-wiki topic <repo> "compaction"` runs the full pipeline
- [ ] `--list` and `--check` sub-flows work correctly
- [ ] `--force` overrides existing topic detection
- [ ] Cache is checked at each phase
- [ ] Progress output matches established patterns
- [ ] All error paths return correct exit codes
- [ ] All tests pass
- [ ] `deep-wiki --help` shows the topic command

## Dependencies
- Depends on: 001, 002, 003, 004, 005, 006, 007, 008
