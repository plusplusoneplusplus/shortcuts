---
status: pending
---

# 007: Rename Topic to Theme

## Summary

Rename all "Topic" terminology to "Theme" across the `packages/deep-wiki` codebase — types, functions, variables, file names, directory names, API routes, CSS classes, CLI commands, cache directories, and output paths. This is the largest single rename in the hierarchy refactor series, affecting ~200 source occurrences and ~300 test occurrences plus 20+ file/directory renames.

## Motivation

Consistent hierarchy terminology: **Domain → Component → Theme** (formerly Area → Module → Topic). The "Topic" layer represents cross-cutting, feature-focused wiki articles that span multiple components. "Theme" better conveys this cross-cutting nature — a theme is a recurring concern that weaves through the architecture, not a standalone subject.

Previous commits already renamed Area → Domain (001) and Module → Component (002–006). This commit completes the trilogy.

## Changes

### Phase 0: Directory & File Renames

Perform all renames **first** (before editing content) so that subsequent find-and-replace operates on final paths.

#### Source directory rename
| From | To |
|---|---|
| `src/topic/` | `src/theme/` |

#### Source file renames (inside `src/theme/` after directory rename)
| From | To |
|---|---|
| `src/theme/topic-analysis.ts` | `src/theme/theme-analysis.ts` |
| `src/theme/topic-probe.ts` | `src/theme/theme-probe.ts` |
| *(all other files keep their names — they don't have "topic" prefix)* | |

Full file list in `src/theme/` after renames:
- `analysis-prompts.ts` (unchanged)
- `article-generator.ts` (unchanged)
- `article-prompts.ts` (unchanged)
- `coverage-checker.ts` (unchanged)
- `file-writer.ts` (unchanged)
- `index.ts` (unchanged)
- `outline-generator.ts` (unchanged)
- `outline-prompts.ts` (unchanged)
- `theme-analysis.ts` ← was `topic-analysis.ts`
- `theme-probe.ts` ← was `topic-probe.ts`
- `wiki-integrator.ts` (unchanged)

#### Cache file rename
| From | To |
|---|---|
| `src/cache/topic-cache.ts` | `src/cache/theme-cache.ts` |

#### Command file rename
| From | To |
|---|---|
| `src/commands/topic.ts` | `src/commands/theme.ts` |

#### Test directory rename
| From | To |
|---|---|
| `test/topic/` | `test/theme/` |

#### Test file renames (inside `test/theme/` after directory rename)
| From | To |
|---|---|
| `test/theme/topic-analysis.test.ts` | `test/theme/theme-analysis.test.ts` |
| `test/theme/topic-probe.test.ts` | `test/theme/theme-probe.test.ts` |
| *(other test files keep names — no "topic" prefix)* | |

#### Other test file renames
| From | To |
|---|---|
| `test/cache/topic-cache.test.ts` | `test/cache/theme-cache.test.ts` |
| `test/commands/topic.test.ts` | `test/commands/theme.test.ts` |
| `test/server/topic-support.test.ts` | `test/server/theme-support.test.ts` |

---

### Phase 1: Type Renames in `src/types.ts`

These are the authoritative type definitions. All downstream references depend on these names.

| Old Name | New Name | Notes |
|---|---|---|
| `TopicSeed` | `ThemeSeed` | |
| `TopicSeed.topic` (property) | `ThemeSeed.theme` | Property rename |
| `SeedsOutput.topics` (property) | `SeedsOutput.themes` | Property rename |
| `SeedsCommandOptions.maxTopics` | `SeedsCommandOptions.maxThemes` | |
| `TopicRequest` | `ThemeRequest` | |
| `TopicRequest.topic` (property) | `ThemeRequest.theme` | Property rename |
| `TopicCoverageCheck` | `ThemeCoverageCheck` | |
| `TopicRelatedModule` | `ThemeRelatedComponent` | Module→Component already done in 002 |
| `TopicOutline` | `ThemeOutline` | |
| `TopicOutline.topicId` (property) | `ThemeOutline.themeId` | Property rename |
| `TopicArticlePlan` | `ThemeArticlePlan` | |
| `TopicInvolvedModule` | `ThemeInvolvedComponent` | Module→Component already done in 002 |
| `TopicAnalysis` | `ThemeAnalysis` | |
| `TopicAnalysis.topicId` (property) | `ThemeAnalysis.themeId` | Property rename |
| `TopicArticleAnalysis` | `ThemeArticleAnalysis` | |
| `TopicCrossCuttingAnalysis` | `ThemeCrossCuttingAnalysis` | |
| `TopicCrossCuttingAnalysis.relatedTopics` | `ThemeCrossCuttingAnalysis.relatedThemes` | Property rename |
| `TopicArticle` | `ThemeArticle` | |
| `TopicArticle.type` values | `'theme-index' \| 'theme-article'` | Was `'topic-index' \| 'topic-article'` |
| `TopicArticle.topicId` (property) | `ThemeArticle.themeId` | Property rename |
| `TopicAreaMeta` | `ThemeMeta` | Simplified — "Area" already renamed to Domain in 001 |
| `TopicCommandOptions` | `ThemeCommandOptions` | |
| `TopicCommandOptions.topic` (property) | `ThemeCommandOptions.theme` | Property rename |
| `ModuleGraph.topics` (property) | `ModuleGraph.themes` | Property rename |

#### ArticleType union — add theme types
Add `'theme-index' | 'theme-article'` to the `ArticleType` union (removing `'topic-index' | 'topic-article'` if they existed, but they were only on `TopicArticle.type` not `ArticleType`).

### Phase 2: Cache Type Renames in `src/cache/types.ts`

| Old Name | New Name |
|---|---|
| `CachedTopicProbe` | `CachedThemeProbe` |
| `CachedTopicOutline` | `CachedThemeOutline` |
| `CachedTopicAnalysis` | `CachedThemeAnalysis` |
| `CachedTopicArticle` | `CachedThemeArticle` |
| `DiscoveryProgressMetadata.completedTopics` | `DiscoveryProgressMetadata.completedThemes` |
| `DiscoveryProgressMetadata.pendingTopics` | `DiscoveryProgressMetadata.pendingThemes` |

Update import from `../topic/topic-probe` → `../theme/theme-probe` (for `EnrichedProbeResult`).

### Phase 3: Discovery Iterative Type Renames in `src/discovery/iterative/types.ts`

| Old Name | New Name |
|---|---|
| `TopicProbeResult` | `ThemeProbeResult` |
| `TopicProbeResult.topic` (property) | `ThemeProbeResult.theme` | 
| `TopicProbeResult.discoveredTopics` (property) | `ThemeProbeResult.discoveredThemes` |
| `DiscoveredTopic` | `DiscoveredTheme` |
| `DiscoveredTopic.topic` (property) | `DiscoveredTheme.theme` |
| `MergeResult.newTopics` (property) | `MergeResult.newThemes` |

### Phase 4: Cache Constants in `src/cache/cache-constants.ts`

| Old | New |
|---|---|
| `TOPICS_DIR = 'topics'` | `THEMES_DIR = 'themes'` |

### Phase 5: Cache Functions in `src/cache/theme-cache.ts` (was `topic-cache.ts`)

All function renames (24 functions):

| Old Function | New Function |
|---|---|
| `getTopicsCacheDir()` | `getThemesCacheDir()` |
| `getTopicCacheDir()` | `getThemeCacheDir()` |
| `getTopicProbePath()` | `getThemeProbePath()` |
| `getTopicOutlinePath()` | `getThemeOutlinePath()` |
| `getTopicAnalysisPath()` | `getThemeAnalysisPath()` |
| `getTopicArticlesDir()` | `getThemeArticlesDir()` |
| `getTopicArticlePath()` | `getThemeArticlePath()` |
| `getCachedTopicProbe()` | `getCachedThemeProbe()` |
| `saveTopicProbe()` | `saveThemeProbe()` |
| `getCachedTopicOutline()` | `getCachedThemeOutline()` |
| `saveTopicOutline()` | `saveThemeOutline()` |
| `getCachedTopicAnalysis()` | `getCachedThemeAnalysis()` |
| `saveTopicAnalysis()` | `saveThemeAnalysis()` |
| `getCachedTopicArticle()` | `getCachedThemeArticle()` |
| `saveTopicArticle()` | `saveThemeArticle()` |
| `getCachedTopicArticles()` | `getCachedThemeArticles()` |
| `clearTopicCache()` | `clearThemeCache()` |
| `clearAllTopicsCache()` | `clearAllThemesCache()` |
| `isTopicCacheValid()` | `isThemeCacheValid()` |

Update all internal references: `TOPICS_DIR` → `THEMES_DIR`, type imports.

### Phase 6: Cache Barrel in `src/cache/index.ts`

- `export * from './topic-cache'` → `export * from './theme-cache'`

### Phase 7: Theme Module Barrel in `src/theme/index.ts` (was `src/topic/index.ts`)

Update all internal export paths:
- `'./topic-probe'` → `'./theme-probe'`
- `'./topic-analysis'` → `'./theme-analysis'`

Rename all exported types and functions:
- `listTopicAreas` → `listThemeAreas`
- `checkTopicCoverage` → `checkThemeCoverage`
- `buildTopicSeed` → `buildThemeSeed`
- `runSingleTopicProbe` → `runSingleThemeProbe`
- `TopicProbeOptions` → `ThemeProbeOptions`
- `EnrichedProbeResult` (no rename — not topic-prefixed)
- `generateTopicOutline` → `generateThemeOutline`
- `OutlineGeneratorOptions` (no rename)
- `runTopicAnalysis` → `runThemeAnalysis`
- `TopicAnalysisOptions` → `ThemeAnalysisOptions`
- `generateTopicArticles` → `generateThemeArticles`
- `TopicArticleGenOptions` → `ThemeArticleGenOptions`
- `TopicArticleGenResult` → `ThemeArticleGenResult`
- `writeTopicArticles` → `writeThemeArticles`
- `TopicWriteOptions` → `ThemeWriteOptions`
- `TopicWriteResult` → `ThemeWriteResult`
- `integrateTopicIntoWiki` → `integrateThemeIntoWiki`
- `WikiIntegrationOptions` (no rename)

### Phase 8: Theme Source Files (~200 occurrences)

Each file in `src/theme/` needs internal renames of all `topic`/`Topic` identifiers:

#### `src/theme/theme-probe.ts` (was `topic-probe.ts`)
- `buildTopicSeed()` → `buildThemeSeed()`
- `runSingleTopicProbe()` → `runSingleThemeProbe()`
- `TopicProbeOptions` → `ThemeProbeOptions`
- All `topicId` variables → `themeId`
- Import updates: `TopicSeed`, `TopicRequest`, `TopicProbeResult` etc.

#### `src/theme/theme-analysis.ts` (was `topic-analysis.ts`)
- `runTopicAnalysis()` → `runThemeAnalysis()`
- `TopicAnalysisOptions` → `ThemeAnalysisOptions`
- All `topicId` variables → `themeId`
- Import updates

#### `src/theme/coverage-checker.ts`
- `listTopicAreas()` → `listThemeAreas()`
- `checkTopicCoverage()` → `checkThemeCoverage()`
- `TopicCoverageCheck` → `ThemeCoverageCheck`
- `TopicRelatedModule` → `ThemeRelatedComponent`
- Internal `topicsDir` → `themesDir`, `topicDir` → `themeDir`

#### `src/theme/outline-generator.ts`
- `generateTopicOutline()` → `generateThemeOutline()`
- `OutlineGeneratorOptions` property: `topic` → `theme`
- All `topicId` → `themeId`
- Import updates

#### `src/theme/outline-prompts.ts`
- Prompt text: "topic" → "theme" in AI instructions
- Variable names

#### `src/theme/analysis-prompts.ts`
- Prompt text: "topic" → "theme" in AI instructions
- Variable names

#### `src/theme/article-generator.ts`
- `generateTopicArticles()` → `generateThemeArticles()`
- `TopicArticleGenOptions` → `ThemeArticleGenOptions`
- `TopicArticleGenResult` → `ThemeArticleGenResult`
- `topicId` → `themeId`
- `'topic-index'` → `'theme-index'`, `'topic-article'` → `'theme-article'`

#### `src/theme/article-prompts.ts`
- Prompt text: "topic" → "theme"
- Variable names

#### `src/theme/file-writer.ts`
- `writeTopicArticles()` → `writeThemeArticles()`
- `TopicWriteOptions` → `ThemeWriteOptions`
- `TopicWriteResult` → `ThemeWriteResult`
- `topics/` output directory → `themes/`
- `topicDir` → `themeDir`

#### `src/theme/wiki-integrator.ts`
- `integrateTopicIntoWiki()` → `integrateThemeIntoWiki()`
- `updateModuleGraph()` — update `graph.topics` → `graph.themes`
- `TopicAreaMeta` → `ThemeMeta`
- All `topicId` → `themeId`
- Output directory `topics/` → `themes/`

### Phase 9: Discovery Iterative Files

#### `src/discovery/iterative/index.ts`
- `runTopicProbe` → `runThemeProbe`

#### `src/discovery/iterative/probe-session.ts`
- `runTopicProbe()` → `runThemeProbe()`
- `TopicProbeResult` → `ThemeProbeResult`
- `TopicSeed` → `ThemeSeed`
- `topic.topic` → `theme.theme` (property access)
- Log messages: "topic" → "theme"

#### `src/discovery/iterative/probe-prompts.ts`
- `TopicSeed` → `ThemeSeed`
- Prompt text: "topic" → "theme" throughout
- `topic.topic` → `theme.theme`, `topic.hints` → `theme.hints`, `topic.description` → `theme.description`
- JSON schema keys: `"topic"` → `"theme"`, `"discoveredTopics"` → `"discoveredThemes"`

#### `src/discovery/iterative/probe-response-parser.ts`
- `TopicProbeResult` → `ThemeProbeResult`
- `DiscoveredTopic` → `DiscoveredTheme`
- `obj.topic` → `obj.theme`
- `obj.discoveredTopics` → `obj.discoveredThemes`
- `dt.topic` → `dt.theme`

#### `src/discovery/iterative/merge-prompts.ts`
- `TopicProbeResult` → `ThemeProbeResult`
- `"newTopics"` JSON key → `"newThemes"`
- `"topic"` JSON key → `"theme"`
- Prompt text: "topic" → "theme"

#### `src/discovery/iterative/merge-session.ts`
- `TopicProbeResult` → `ThemeProbeResult`
- `probe.topic` → `probe.theme`
- `probe.discoveredTopics` → `probe.discoveredThemes`
- `dt.topic` → `dt.theme`
- `seenTopics` → `seenThemes`
- `newTopics` → `newThemes`
- `MergeResult.newTopics` → `MergeResult.newThemes`

#### `src/discovery/iterative/merge-response-parser.ts`
- `TopicSeed` → `ThemeSeed`
- `newTopics` → `newThemes`
- `obj.newTopics` → `obj.newThemes`
- `topic.topic` → `theme.theme`

#### `src/discovery/iterative/iterative-discovery.ts`
- `TopicSeed` → `ThemeSeed`
- `TopicProbeResult` → `ThemeProbeResult`
- `runTopicProbe` → `runThemeProbe`
- `currentTopics` → `currentThemes`
- `topicsToProbe` → `themesToProbe`
- `t.topic` → `t.theme`
- `completedTopics` → `completedThemes`
- `pendingTopics` → `pendingThemes`
- Log messages: "topics" → "themes"

### Phase 10: Discovery Cache in `src/cache/discovery-cache.ts`

- `TopicSeed` → `ThemeSeed`
- `TopicProbeResult` → `ThemeProbeResult`
- `topic` parameter names → `theme`
- Comment text: "per-topic" → "per-theme"
- `completedTopics` → `completedThemes`
- `pendingTopics` → `pendingThemes`

### Phase 11: Seeds Layer

#### `src/seeds/index.ts`
- `generateTopicSeeds` export alias → `generateThemeSeeds`
- `TopicSeed` → `ThemeSeed`
- `SeedsOutput` — already renamed in types.ts (`.topics` → `.themes`)

#### `src/seeds/seeds-session.ts`
- `TopicSeed` → `ThemeSeed`
- `maxTopics` → `maxThemes`
- Log messages: "topic seeds" → "theme seeds", "topics" → "themes"

#### `src/seeds/response-parser.ts`
- `TopicSeed` → `ThemeSeed`
- `parseSeedsResponse()`: `obj.topics` → `obj.themes`
- `parseTopicsArray()` → `parseThemesArray()`
- `topics` variable → `themes`
- Log/error text: "topic" → "theme"

#### `src/seeds/prompts.ts`
- `maxTopics` → `maxThemes`
- Prompt text: replace all "topic" / "topics" → "theme" / "themes"
- JSON schema: `"topics"` → `"themes"`, `"topic"` → `"theme"`

#### `src/seeds/heuristic-fallback.ts`
- `TopicSeed` → `ThemeSeed`
- `generateHeuristicSeeds()` — internal variable `topicId` → `themeId`
- Comment text: "topic" → "theme"
- `topic:` property in seed objects → `theme:`

#### `src/seeds/seed-file-parser.ts`
- `TopicSeed` → `ThemeSeed`
- `SeedsOutput` — `.topics` → `.themes` (property access)
- `parseTopicsArray()` → `parseThemesArray()`
- Error messages: "topic" → "theme"
- `obj.topic` → `obj.theme`

### Phase 12: Commands

#### `src/commands/theme.ts` (was `topic.ts`)
- `TopicCommandOptions` → `ThemeCommandOptions`
- `TopicRequest` → `ThemeRequest`
- `TopicOutline` → `ThemeOutline`
- `TopicAnalysis` → `ThemeAnalysis`
- `TopicArticle` → `ThemeArticle`
- `TopicAreaMeta` → `ThemeMeta`
- `executeTopic()` → `executeTheme()`
- All cache function imports: `getCachedTopicProbe` → `getCachedThemeProbe` etc.
- All topic module imports: `from '../topic'` → `from '../theme'`
- `listTopicAreas` → `listThemeAreas`
- `checkTopicCoverage` → `checkThemeCoverage`
- `runSingleTopicProbe` → `runSingleThemeProbe`
- `generateTopicOutline` → `generateThemeOutline`
- `runTopicAnalysis` → `runThemeAnalysis`
- `generateTopicArticles` → `generateThemeArticles`
- `integrateTopicIntoWiki` → `integrateThemeIntoWiki`
- `topicId` → `themeId`
- `topicRequest` → `themeRequest`
- `printTopicList()` → `printThemeList()`
- Output path: `wikiDir/topics/` → `wikiDir/themes/`
- Log text: "Topic" → "Theme", "topic" → "theme"
- `cache/topic-cache` import → `cache/theme-cache`

#### `src/commands/seeds.ts`
- `generateTopicSeeds` → `generateThemeSeeds`
- `maxTopics` → `maxThemes`
- Log text: "topic" → "theme"
- `seed.topic` → `seed.theme`
- `topics:` property in output JSON → `themes:`

#### `src/commands/discover.ts`
- `generateTopicSeeds` → `generateThemeSeeds`
- `maxTopics` → `maxThemes`
- Log text: "topic seeds" → "theme seeds"

#### `src/commands/phases/discovery-phase.ts`
- `generateTopicSeeds` → `generateThemeSeeds`
- `maxTopics` → `maxThemes`
- Log text: "topic seeds" → "theme seeds"

### Phase 13: CLI in `src/cli.ts`

- `deep-wiki topic` command → `deep-wiki theme`
- `--max-topics` option → `--max-themes`
- `maxTopics` option key → `maxThemes`
- `executeTopic` import → `executeTheme`
- `'./commands/topic'` → `'./commands/theme'`
- `TopicCommandOptions` → `ThemeCommandOptions`
- `.topic` property → `.theme`
- Help text and description: "topic" → "theme"

### Phase 14: Server — API Handlers in `src/server/api-handlers.ts`

- Route: `GET /api/topics` → `GET /api/themes`
- Route: `GET /api/topics/:topicId` → `GET /api/themes/:themeId`
- Route: `GET /api/topics/:topicId/:slug` → `GET /api/themes/:themeId/:slug`
- `handleGetTopics()` → `handleGetThemes()`
- `handleGetTopicById()` → `handleGetThemeById()`
- `handleGetTopicArticle()` → `handleGetThemeArticle()`
- `topicId` → `themeId`
- `topicArticleMatch` → `themeArticleMatch`
- `topicMatch` → `themeMatch`
- `wikiData.getTopicList()` → `wikiData.getThemeList()`
- `wikiData.getTopicArticles()` → `wikiData.getThemeArticles()`
- `wikiData.getTopicArticle()` → `wikiData.getThemeArticle()`
- Error messages: "Topic" → "Theme"

### Phase 15: Server — Wiki Data in `src/server/wiki-data.ts`

- `TopicAreaMeta` → `ThemeMeta`
- `TopicArticleContent` → `ThemeArticleContent`
- `TopicArticleDetail` → `ThemeArticleDetail`
- `_topicMarkdown` → `_themeMarkdown`
- `readTopicFiles()` → `readThemeFiles()`
- `getTopicMarkdownData()` → `getThemeMarkdownData()`
- `getTopicList()` → `getThemeList()`
- `getTopicArticle()` → `getThemeArticle()`
- `getTopicArticles()` → `getThemeArticles()`
- `graph.topics` → `graph.themes`
- `topicsDir` → `themesDir`
- `topics/` directory path → `themes/`
- Key prefix `topic:` → `theme:` in markdown data map

### Phase 16: Server — Context Builder in `src/server/context-builder.ts`

- `TopicAreaMeta` → `ThemeMeta`
- `TopicContextEntry` → `ThemeContextEntry`
- `topicContexts` → `themeContexts`
- `topicMarkdownData` → `themeMarkdownData`
- `topicScores` → `themeScores`
- `maxTopics` → `maxThemes`
- `selectedTopics` → `selectedThemes`
- `source: 'topic'` → `source: 'theme'`
- `topic:` prefix in docId → `theme:`
- `topicId` → `themeId`
- `topics/` path → `themes/`
- `graph.topics` → `graph.themes`

### Phase 17: Server — Ask Handler in `src/server/ask-handler.ts`

- `topicContexts` → `themeContexts`
- `topicIds` → `themeIds`
- `t.topicId` → `t.themeId`

### Phase 18: Server — Admin Handlers in `src/server/admin-handlers.ts`

- Check for any topic references in seed handling (seeds still reference `TopicSeed` → `ThemeSeed`)

### Phase 19: Server — SPA Client Files

#### `src/server/spa/client/sidebar.ts`
- `moduleGraph.topics` → `moduleGraph.themes`
- `data-section='topics'` → `data-section='themes'`
- CSS classes: `nav-topic-group` → `nav-theme-group`, `nav-topic-article` → `nav-theme-article`
- `data-topic-id` → `data-theme-id`
- `loadTopicArticle()` → `loadThemeArticle()`
- `topic:` prefix in data-id → `theme:`

#### `src/server/spa/client/content.ts`
- `loadTopicArticle()` → `loadThemeArticle()`
- `type: 'topic'` → `type: 'theme'`
- `topicId` → `themeId`
- `#topic-` hash prefix → `#theme-`
- `__topic_` data key prefix → `__theme_`
- `/api/topics/` → `/api/themes/`
- Log/error text: "topic" → "theme"

#### `src/server/spa/client/core.ts`
- `state.type === 'topic'` → `state.type === 'theme'`
- `state.topicId` → `state.themeId`
- `loadTopicArticle` → `loadThemeArticle`

#### `src/server/spa/client/ask-ai.ts`
- `topicIds` → `themeIds`
- `topicLinks` → `themeLinks`
- `topicId` → `themeId`
- `loadTopicArticle` → `loadThemeArticle`

#### `src/server/spa/client/index.ts`
- Re-export updates if any

#### `src/server/spa/scripts/sidebar.ts` (mirror of client/sidebar.ts)
- Same renames as `client/sidebar.ts`

#### `src/server/spa/scripts/content.ts` (mirror of client/content.ts)
- Same renames as `client/content.ts`

#### `src/server/spa/scripts/ask-ai.ts` (mirror of client/ask-ai.ts)
- Same renames as `client/ask-ai.ts`

#### `src/server/spa/scripts/core.ts` (mirror of client/core.ts)
- Same renames as `client/core.ts`

### Phase 20: Website Output Files

#### `src/writing/website-data.ts`
- `topicsDir` → `themesDir`
- `topics/` directory path → `themes/`
- `__topic_` key prefix → `__theme_`
- `topicId` → `themeId`
- `topicDir` → `themeDir`

#### `src/writing/website-styles.ts`
- CSS classes: `.nav-topic-group` → `.nav-theme-group`
- `.nav-topic-header` → `.nav-theme-header`
- `.nav-topic-item` → `.nav-theme-item`
- `.nav-topic-children` → `.nav-theme-children`
- `.nav-topic-article` → `.nav-theme-article`
- `.topic-wide` → `.theme-wide`

#### `src/writing/website-client-script.ts`
- `loadTopicPage()` → `loadThemePage()`
- `moduleGraph.topics` → `moduleGraph.themes`
- CSS classes: `nav-topic-*` → `nav-theme-*`
- `__topic_` key prefix → `__theme_`
- `topicMeta` → `themeMeta`
- `topicSection` → `themeSection`
- `topicTitle` → `themeTitle`
- `state.type === 'topic'` → `state.type === 'theme'`
- `state.topicId` → `state.themeId`
- Breadcrumb: `'Home > Topics >'` → `'Home > Themes >'`
- Hash: `#topic-` → `#theme-`
- `.topic-wide` → `.theme-wide`

### Phase 21: Remaining Source Files

#### `src/server/index.ts`
- Check for any topic references (likely indirect via WikiData)

#### `src/server/spa/index.ts`
- Check for topic references in SPA entry

#### `src/server/spa/types.ts`
- Check for topic-related type definitions

#### `src/index.ts` (package entry)
- No direct topic references expected

### Phase 22: Re-export Updates in `src/types.ts`

- `TopicProbeResult` → `ThemeProbeResult`
- `DiscoveredTopic` → `DiscoveredTheme`
- Re-export from `'./discovery/iterative/types'`
- Re-export from `'./cache/types'` — verify cache types updated

### Phase 23: Import Path Updates (All Files)

Global find-and-replace across all `.ts` files:

| Old Import Path | New Import Path |
|---|---|
| `'./topic/'` or `'../topic/'` | `'./theme/'` or `'../theme/'` |
| `'./topic/topic-probe'` | `'./theme/theme-probe'` |
| `'./topic/topic-analysis'` | `'./theme/theme-analysis'` |
| `'../topic/topic-probe'` | `'../theme/theme-probe'` |
| `'./topic-cache'` | `'./theme-cache'` |
| `'./commands/topic'` | `'./commands/theme'` |
| `'../cache/topic-cache'` | `'../cache/theme-cache'` |

---

### Phase 24: Test Files (~300 occurrences)

Every test file referencing topic types, functions, or imports needs updating. The test files to modify:

#### Test files that were renamed (update internal content):
1. **`test/theme/theme-probe.test.ts`** — All topic→theme renames matching src
2. **`test/theme/theme-analysis.test.ts`** — All topic→theme renames
3. **`test/theme/article-generator.test.ts`** — topic→theme in test data & imports
4. **`test/theme/coverage-checker.test.ts`** — topic→theme in test data & imports
5. **`test/theme/file-writer.test.ts`** — topic→theme, `topics/` → `themes/`
6. **`test/theme/outline-generator.test.ts`** — topic→theme in test data & imports
7. **`test/theme/wiki-integrator.test.ts`** — topic→theme, `topics/` → `themes/`
8. **`test/cache/theme-cache.test.ts`** — All cache function renames, `topics/` → `themes/`
9. **`test/commands/theme.test.ts`** — `executeTopic` → `executeTheme`, all topic→theme
10. **`test/server/theme-support.test.ts`** — API routes `/api/topics` → `/api/themes`, all topic→theme

#### Test files that stay in place (update content only):
11. **`test/types.test.ts`** — Type name assertions
12. **`test/cli.test.ts`** — `topic` command → `theme` command
13. **`test/commands/seeds.test.ts`** — `maxTopics` → `maxThemes`, `generateTopicSeeds` → `generateThemeSeeds`
14. **`test/commands/discover.test.ts`** — `generateTopicSeeds` → `generateThemeSeeds`
15. **`test/commands/generate.test.ts`** — topic→theme references
16. **`test/commands/phases/phase-runners.test.ts`** — `generateTopicSeeds` → `generateThemeSeeds`
17. **`test/cache/cache-utils.test.ts`** — `topics` dir references
18. **`test/cache/discovery-cache.test.ts`** — `TopicSeed` → `ThemeSeed`, `topic` → `theme`
19. **`test/discovery/iterative/probe-response-parser.test.ts`** — `TopicProbeResult` → `ThemeProbeResult`
20. **`test/discovery/iterative/probe-prompts.test.ts`** — `TopicSeed` → `ThemeSeed`
21. **`test/discovery/iterative/merge-prompts.test.ts`** — topic→theme
22. **`test/discovery/iterative/merge-response-parser.test.ts`** — `newTopics` → `newThemes`
23. **`test/discovery/iterative/iterative-discovery.test.ts`** — `TopicSeed` → `ThemeSeed`, `runTopicProbe` → `runThemeProbe`
24. **`test/discovery/iterative/iterative-discovery-cache.test.ts`** — `completedTopics` → `completedThemes`
25. **`test/discovery/discovery-logging.test.ts`** — topic→theme
26. **`test/seeds/response-parser.test.ts`** — `topics` → `themes`, `topic` → `theme`
27. **`test/seeds/prompts.test.ts`** — `maxTopics` → `maxThemes`, topic→theme
28. **`test/seeds/heuristic-fallback.test.ts`** — `topic` → `theme`
29. **`test/seeds/seed-file-parser.test.ts`** — `topics` → `themes`, `topic` → `theme`
30. **`test/server/admin-handlers.test.ts`** — seed-related topic→theme
31. **`test/writing/website-generator.test.ts`** — `topics` → `themes`, CSS class renames

---

## Implementation Notes

### Ordering Strategy
1. **Rename directories/files first** (Phase 0) using `git mv` to preserve history
2. **Rename types** (Phases 1–3) — this breaks compilation everywhere
3. **Fix all source files** (Phases 4–23) — restore compilation
4. **Fix all test files** (Phase 24) — restore test compilation
5. **Verify**: `npm run build && npm run test:run` in `packages/deep-wiki`

### Property Renames Requiring JSON/Data Migration Awareness
These property renames affect cached data on disk (`.wiki-cache/`) and output data (`wiki/`):
- `TopicSeed.topic` → `ThemeSeed.theme` — affects `seeds.json`
- `SeedsOutput.topics` → `SeedsOutput.themes` — affects `seeds.json`
- `TopicProbeResult.topic` → `ThemeProbeResult.theme` — affects cached probe JSONs
- `TopicProbeResult.discoveredTopics` → `ThemeProbeResult.discoveredThemes` — affects cached probe JSONs
- `TopicOutline.topicId` → `ThemeOutline.themeId` — affects cached outlines
- `TopicAnalysis.topicId` → `ThemeAnalysis.themeId` — affects cached analyses
- `TopicArticle.topicId` → `ThemeArticle.themeId` — affects cached articles
- `ModuleGraph.topics` → `ModuleGraph.themes` — affects `module-graph.json`
- `DiscoveryProgressMetadata.completedTopics/pendingTopics` → `completedThemes/pendingThemes` — affects discovery metadata
- `MergeResult.newTopics` → `MergeResult.newThemes` — affects merge cache
- `TOPICS_DIR = 'topics'` → `THEMES_DIR = 'themes'` — affects cache directory layout
- Output path `wiki/topics/` → `wiki/themes/` — affects generated wiki output

**Note**: Existing caches will be invalidated by this rename. Users will need to regenerate. This is acceptable because cache invalidation by git hash already handles version drift. No migration code is needed — stale caches are simply ignored.

### AI Prompt Text
Several files contain AI prompt templates with natural-language "topic" references. These must be carefully updated to "theme" to maintain prompt quality:
- `src/seeds/prompts.ts` — seed generation prompt
- `src/discovery/iterative/probe-prompts.ts` — probe prompt
- `src/discovery/iterative/merge-prompts.ts` — merge prompt
- `src/theme/outline-prompts.ts` — outline prompt
- `src/theme/analysis-prompts.ts` — analysis prompt
- `src/theme/article-prompts.ts` — article generation prompt

### CSS Class Renames
All CSS classes with `topic` need updating in:
- `src/writing/website-styles.ts`
- `src/writing/website-client-script.ts`
- `src/server/spa/client/sidebar.ts`
- `src/server/spa/scripts/sidebar.ts`

### API Route Changes
- `GET /api/topics` → `GET /api/themes`
- `GET /api/topics/:id` → `GET /api/themes/:id`
- `GET /api/topics/:id/:slug` → `GET /api/themes/:id/:slug`

These are internal-only routes (SPA ↔ server), not public API contracts, so no deprecation needed.

### Breadcrumb and Hash Changes
- Breadcrumb: `Home > Topics > {title}` → `Home > Themes > {title}`
- URL hash: `#topic-{id}` → `#theme-{id}`
- Data key: `__topic_{id}` → `__theme_{id}`
- Nav data-id: `topic:{id}:{slug}` → `theme:{id}:{slug}`

## Tests

After all renames, run the full test suite:

```bash
cd packages/deep-wiki
npm run build          # Verify compilation
npm run test:run       # Run all Vitest tests
```

All 23 test files should pass. Key test coverage:
- Type assertions in `test/types.test.ts`
- Cache round-trip in `test/cache/theme-cache.test.ts`
- CLI parsing in `test/cli.test.ts`
- API routes in `test/server/theme-support.test.ts`
- Discovery iteration in `test/discovery/iterative/iterative-discovery.test.ts`
- Seed parsing in `test/seeds/response-parser.test.ts`
- Article generation in `test/theme/article-generator.test.ts`

## Acceptance Criteria

- [ ] No `[Tt]opic` references remain in `packages/deep-wiki/src/` (except in non-deep-wiki contexts like "TopLevelArea" or unrelated English prose)
- [ ] No `[Tt]opic` references remain in `packages/deep-wiki/test/` (same exceptions)
- [ ] All source files compile: `npm run build` succeeds
- [ ] All tests pass: `npm run test:run` succeeds
- [ ] Directory `src/topic/` no longer exists; `src/theme/` exists
- [ ] Directory `test/topic/` no longer exists; `test/theme/` exists
- [ ] File `src/cache/topic-cache.ts` no longer exists; `src/cache/theme-cache.ts` exists
- [ ] File `src/commands/topic.ts` no longer exists; `src/commands/theme.ts` exists
- [ ] CLI command `deep-wiki theme` works (replacing `deep-wiki topic`)
- [ ] CLI option `--max-themes` works (replacing `--max-topics`)
- [ ] API routes `/api/themes`, `/api/themes/:id`, `/api/themes/:id/:slug` respond correctly
- [ ] Cache directory uses `themes/` subdirectory (not `topics/`)
- [ ] Wiki output uses `themes/` subdirectory (not `topics/`)
- [ ] CSS classes use `nav-theme-*` naming (not `nav-topic-*`)
- [ ] `git mv` was used for all file/directory renames to preserve history

## Dependencies

- Depends on: 001 (Area → Domain, for `TopicAreaMeta` → `ThemeMeta` simplification)
- Depends on: 002–006 (Module → Component, for `TopicRelatedModule` → `ThemeRelatedComponent` and `TopicInvolvedModule` → `ThemeInvolvedComponent`)
