# Context: Wiki Sub-Tab in Repo Detail View

## User Story
As a developer using the CoC dashboard, I want to access a workspace's wiki directly from its repo detail view, so I can browse documentation, ask AI questions, and manage wiki generation without leaving the repo context. Currently wikis live under a separate top-level "Wiki" tab requiring navigation away from the repo.

## Goal
Add a "Wiki" tab to the repo detail sub-tab bar that shows the workspace's wiki inline — handling zero, one, or multiple wikis — with full Browse/Ask/Graph/Admin functionality, status badges, and deep-link URL routing.

## Commit Sequence
1. Types, tab registration & routing
2. RepoWikiTab scaffold with empty state
3. Single wiki inline view
4. Multi-wiki selector & deep links
5. Tab badge & generation status indicators

## Key Decisions
- Reuse `WikiDetail` component with an `embedded` prop (hides back button, suppresses hash mutations) rather than duplicating wiki rendering logic
- Wiki selection in multi-wiki case is managed locally in `RepoWikiTab` component state, not in global AppContext
- Deep-link routing extends the existing `#repos/{id}/{subTab}` pattern: `#repos/{id}/wiki/{wikiId}/{wikiTab}`
- Tab positioned last (after Chat) per spec — wiki is a reference resource, not a primary workflow tab

## Conventions
- Follow existing badge patterns from queue/tasks/chat tabs (inline `<span>` with data-testid)
- Follow existing empty-state pattern (centered icon + message + action button)
- Match RepoChatTab prop pattern: `workspaceId` + `workspacePath`
- Tests in `packages/coc/test/spa/react/` following existing test patterns
