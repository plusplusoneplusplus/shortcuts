---
status: pending
---

# 010: Website Generator Topic Support

## Summary
Update the existing static website generator (Phase 5) to include a "Topics" navigation section and render topic area pages alongside module pages.

## Motivation
The generated wiki website currently only shows modules (and areas for large repos). With topics now being first-class wiki content, the website needs to display them in navigation and render their markdown as HTML pages. This is the final integration commit that makes topics visible in the browser.

## Changes

### Files to Modify
- `packages/deep-wiki/src/writing/website-generator.ts` — Add topics to navigation, render topic pages
- `packages/deep-wiki/test/writing/website-generator.test.ts` — Add tests for topic rendering

## Implementation Notes

### Navigation Changes
- Add a "Topics" section in the sidebar navigation (between "Modules" and any footer)
- Topic areas show as expandable items with sub-articles nested underneath
- Single-article topics show as flat links

### Page Rendering
- Topic articles are markdown → rendered the same way as module articles
- Topic index pages get a slightly different template (wider layout for architecture diagrams)
- Breadcrumb: `Home > Topics > Compaction > Compaction Styles`

### Data Source
- Read `topics` array from `module-graph.json` (populated by commit 008)
- Read markdown files from `wiki/topics/` directory
- Map each `TopicAreaMeta.articles[]` to rendered HTML pages

### Template Changes
- Sidebar HTML template gains a `{{#topics}}` section
- Topic page template includes "Part of [Topic Name]" breadcrumb for sub-articles
- Index page template includes special handling for mermaid diagrams

### CSS Changes (minimal)
- Topic items in sidebar get a distinct icon (📋 or similar, vs 📦 for modules)
- Topic index pages may have a wider content area for diagrams

## Tests
- **No topics**: Existing websites without topics render unchanged
- **With topics (area)**: Navigation includes Topics section with expandable area
- **With topics (single)**: Single-article topic shows as flat link
- **Topic page rendering**: Markdown → HTML conversion works for topic articles
- **Breadcrumb**: Sub-articles show correct breadcrumb navigation
- **Multiple topics**: Two topic areas + one single topic → all rendered
- **Mermaid diagrams**: Topic index pages render mermaid blocks correctly

## Acceptance Criteria
- [ ] Static website includes "Topics" section in navigation
- [ ] Topic area articles are rendered as HTML pages
- [ ] Sub-articles have breadcrumb back to topic index
- [ ] Existing websites (without topics) are not broken
- [ ] Mermaid diagrams in topic articles render correctly
- [ ] All existing website generator tests still pass
- [ ] New topic-specific tests pass

## Dependencies
- Depends on: 001 (TopicAreaMeta type), 008 (module-graph.json with topics)
- Uses (existing, modified): `writing/website-generator.ts`
