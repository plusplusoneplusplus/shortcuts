---
status: pending
---

# 008: Topic File Writer and Wiki Integration

## Summary
Create a module that writes generated topic articles to the wiki directory and updates existing wiki files (index.md, module-graph.json) to integrate the new topic area.

## Motivation
This commit bridges the gap between article generation (in memory) and the wiki filesystem. It handles the physical layout (single file vs area directory), updates the wiki's navigation structure, and optionally cross-links existing module articles to the new topic. This is the "glue" that makes topics first-class citizens in the wiki.

## Changes

### Files to Create
- `packages/deep-wiki/src/topic/file-writer.ts` — Write topic articles to disk
- `packages/deep-wiki/src/topic/wiki-integrator.ts` — Update index.md, module-graph.json, cross-links
- `packages/deep-wiki/test/topic/file-writer.test.ts` — Tests
- `packages/deep-wiki/test/topic/wiki-integrator.test.ts` — Tests

### Files to Modify
- `packages/deep-wiki/src/topic/index.ts` — Add exports

## Implementation Notes

### `file-writer.ts` Structure

```typescript
import { TopicOutline, TopicArticle } from '../types';

export interface TopicWriteOptions {
    wikiDir: string;
    topicId: string;
    outline: TopicOutline;
    articles: TopicArticle[];
}

export interface TopicWriteResult {
    writtenFiles: string[];       // Absolute paths of written files
    topicDir: string;             // Path to topic directory (or single file)
}

/**
 * Write topic articles to the wiki directory.
 * 
 * Layout logic:
 * - layout: 'single' → write to wiki/topics/{topicId}.md
 * - layout: 'area'   → write to wiki/topics/{topicId}/
 *                         ├── index.md
 *                         ├── {slug1}.md
 *                         └── {slug2}.md
 * 
 * Creates topics/ directory if it doesn't exist.
 * Overwrites existing files if --force was used.
 */
export function writeTopicArticles(options: TopicWriteOptions): TopicWriteResult;
```

### `wiki-integrator.ts` Structure

```typescript
import { ModuleGraph, TopicOutline, TopicAreaMeta, TopicArticle } from '../types';

export interface WikiIntegrationOptions {
    wikiDir: string;
    topicId: string;
    outline: TopicOutline;
    articles: TopicArticle[];
    noCrossLink: boolean;
}

/**
 * Update module-graph.json to include the new topic area metadata.
 * - Reads existing module-graph.json
 * - Adds/updates entry in topics[] array
 * - Writes back with proper formatting
 */
export function updateModuleGraph(
    wikiDir: string,
    topicMeta: TopicAreaMeta
): void;

/**
 * Update wiki index.md to include a "Topics" section.
 * - If "## Topics" section exists, append new topic link
 * - If not, add "## Topics" section before the footer
 * - Links format: - [Compaction](./topics/compaction/index.md) — overview
 */
export function updateWikiIndex(
    wikiDir: string,
    topicId: string,
    topicTitle: string,
    layout: 'single' | 'area'
): void;

/**
 * Add "Related Topics" cross-links to existing module articles.
 * For each module article that relates to this topic:
 * - Append a "## Related Topics" section (if not present)
 * - Add link to topic area: - [Compaction](../topics/compaction/index.md)
 */
export function addCrossLinks(
    wikiDir: string,
    topicId: string,
    topicTitle: string,
    involvedModuleIds: string[],
    layout: 'single' | 'area'
): { updatedFiles: string[] };

/**
 * Full integration: write files + update graph + update index + cross-links.
 */
export function integrateTopicIntoWiki(
    options: WikiIntegrationOptions
): { writtenFiles: string[]; updatedFiles: string[] };
```

### Cross-Link Strategy
- Only modify module articles that have an `involvedModuleId` match
- Add section at the end of the file (after existing content)
- Use relative paths that work in both markdown viewers and the static website
- Skip if `--no-cross-link` flag is set
- Idempotent: don't add duplicate links if topic already referenced

### module-graph.json Update
- Read existing JSON, parse, add/replace topic entry, write back
- Preserve existing `topics[]` entries for other topics
- Match by `id` for replacement (supports `--force` re-generation)

## Tests
- **Single article layout**: Write single .md file to topics/, verify path
- **Area layout**: Write directory with index + sub-articles, verify structure
- **Directory creation**: topics/ doesn't exist → created automatically
- **Module graph update**: Add topic to existing graph, verify JSON structure
- **Module graph update (existing topic)**: Replace existing topic entry
- **Wiki index update (new section)**: No "Topics" section → add it
- **Wiki index update (append)**: Existing "Topics" section → append link
- **Cross-links**: Module article gets "Related Topics" section added
- **Cross-links (idempotent)**: Run twice, no duplicate links
- **No cross-link flag**: Skip cross-linking when noCrossLink=true
- **Missing module articles**: involvedModuleId has no article → skip gracefully

## Acceptance Criteria
- [ ] Single and area layouts produce correct file structures
- [ ] module-graph.json correctly updated with TopicAreaMeta
- [ ] index.md gets "Topics" section with links
- [ ] Module articles get "Related Topics" cross-links
- [ ] Cross-linking is idempotent
- [ ] All file operations handle edge cases (missing dirs, existing files)
- [ ] All tests pass

## Dependencies
- Depends on: 001 (types), 004 (outline), 006 (articles)
