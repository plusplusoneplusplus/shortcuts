---
status: pending
---

# 011: Serve Mode Topic Support

## Summary
Update the interactive web server (`deep-wiki serve`) to index, serve, and display topic articles alongside module articles — in navigation, Q&A context retrieval, and API endpoints.

## Motivation
The serve mode currently only knows about modules. With topic areas now written to `wiki/topics/`, the server needs to:
1. Load and serve topic articles via API
2. Index topic content for TF-IDF so the AI Q&A can reference topic articles when answering questions
3. Show topics in the sidebar navigation
4. Extend the `/api/graph` response with topic metadata

Without this, topic articles would exist on disk but be invisible in the interactive server — the primary way users browse the wiki.

## Changes

### Files to Modify
- `packages/deep-wiki/src/server/wiki-data.ts` — Load topic articles from disk, expose via getters
- `packages/deep-wiki/src/server/context-builder.ts` — Index topic documents alongside modules in TF-IDF
- `packages/deep-wiki/src/server/api-handlers.ts` — Add `/api/topics` endpoint, extend `/api/graph` to include topics
- `packages/deep-wiki/src/server/ask-handler.ts` — Include topic context in Q&A prompt when relevant
- `packages/deep-wiki/src/server/spa/sidebar.ts` (or equivalent SPA script) — Add "Topics" section in sidebar navigation
- `packages/deep-wiki/src/server/spa/ask-ai.ts` (or equivalent) — Show topic source attribution in AI answers

### Files to Create
- `packages/deep-wiki/test/server/topic-support.test.ts` — Tests for all topic-related server changes

## Implementation Notes

### wiki-data.ts Changes
- On server startup, scan `wiki/topics/` directory for both single files and area directories
- Parse `module-graph.json` → `topics[]` array for metadata
- Store topic markdown content keyed by `topicId/slug`
- New getters:
  ```typescript
  getTopicList(): TopicAreaMeta[]
  getTopicArticle(topicId: string, slug?: string): { content: string; meta: TopicAreaMeta } | null
  getTopicArticles(topicId: string): { slug: string; title: string; content: string }[]
  ```

### context-builder.ts Changes
- In `buildIndex()`, after indexing modules, also index topic articles:
  - Each topic article becomes a separate document in the TF-IDF index
  - Document ID format: `topic:{topicId}:{slug}` (e.g., `topic:compaction:compaction-styles`)
  - Tokenize: topic title, description, article content, involved module names
- In `retrieve()`:
  - Score both module and topic documents
  - Return results with a `source` field: `'module' | 'topic'`
  - Topic context includes the article markdown + link back to topic index
  - Default: up to 5 modules + 3 topic articles in context

### api-handlers.ts Changes
- `GET /api/topics` → Returns list of all topic areas with metadata
- `GET /api/topics/:topicId` → Returns topic area detail (all articles, metadata)
- `GET /api/topics/:topicId/:slug` → Returns single topic article content
- Extend `GET /api/graph` → Include `topics` field in response (from module-graph.json)

### ask-handler.ts Changes
- When building the Q&A prompt, if context retrieval returns topic documents:
  - Include topic article content in the context section
  - Label clearly: "--- Topic Article: Compaction Styles ---"
  - Include link reference: "Source: topics/compaction/compaction-styles.md"

### SPA Sidebar Changes
- After the "Modules" section (or Areas), add a "Topics" section
- Read topic data from `/api/graph` response (the `topics` array)
- Area-layout topics show as expandable tree items with sub-articles
- Single-layout topics show as flat links
- Clicking a topic article loads its content in the main panel
- Search filter should also match topic titles and descriptions

### Q&A Source Attribution
- When AI answer references a topic article, show source tag: `📋 compaction/compaction-styles`
- Distinguish from module sources: `📦 compaction-picker` vs `📋 compaction/styles`

## Tests
- **wiki-data topic loading**: Verify topics loaded from topics/ directory + module-graph.json
- **wiki-data (no topics)**: Existing wikis without topics/ → empty topic list, no errors
- **TF-IDF indexing**: Topic articles indexed, retrievable by keyword
- **Context retrieval**: Question about "compaction" retrieves both module and topic articles
- **API /api/topics**: Returns topic list
- **API /api/topics/:id**: Returns topic area with all articles
- **API /api/graph extended**: Response includes topics[] field
- **Ask handler with topics**: Q&A prompt includes topic context when relevant
- **Sidebar rendering**: Topics section appears with correct structure
- **Backward compatibility**: Server works correctly when wiki has no topics

## Acceptance Criteria
- [ ] Topic articles loaded and served via API endpoints
- [ ] TF-IDF indexes topic content alongside modules
- [ ] Q&A answers can reference and cite topic articles
- [ ] Sidebar shows Topics section with area/single layouts
- [ ] `/api/graph` response includes topic metadata
- [ ] Existing wikis without topics work unchanged
- [ ] All tests pass

## Dependencies
- Depends on: 001 (TopicAreaMeta type), 008 (topics in module-graph.json and wiki/topics/ directory)
- Parallel with: 010 (website topics) — both depend on 008, neither depends on each other
