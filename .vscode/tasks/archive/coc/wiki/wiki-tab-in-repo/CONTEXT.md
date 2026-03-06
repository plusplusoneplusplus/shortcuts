# Context: Wiki Tab in Repo Detail Page

## User Story
The user has a deep-wiki generated inside `docs/wiki` and added it to the CoC dashboard at `http://localhost:4000/#wiki/shortcuts`. They want to browse the wiki directly from the repo detail page (`#repos/{wsId}`) without navigating away — via a new "Wiki" tab. Auto-link when a wiki's `repoPath` matches the workspace, and allow manual specification when it doesn't.

## Goal
Add a Wiki sub-tab to the repo detail page that embeds the existing `WikiDetail` component, with automatic wiki resolution by path matching and a manual linking fallback for repos without a pre-associated wiki.

## Commit Sequence
1. Extend PATCH wiki endpoint with repoPath support
2. WikiDetail embedded mode (hide header, custom hash prefix)
3. LinkWikiPanel component (link existing / specify path / generate new)
4. RepoWikiTab wrapper + RepoSubTab type update
5. Router & RepoDetail integration (wiring, deep-links, tests)
6. Wiki settings popover (change, unlink, open standalone)

## Key Decisions
- Reuse `WikiDetail` via `embedded` prop rather than duplicating wiki rendering code
- Three-tier wiki resolution: exact repoPath match → wikiDir subfolder detection → manual link
- PATCH endpoint extended (not new endpoint) since it already exists for wiki metadata updates
- `LinkWikiPanel` is a standalone component reused in both empty state and "Change Wiki" modal

## Conventions
- New components go under `repos/RepoWikiTab/` as a folder module with barrel export
- Path normalization: forward slashes, case-insensitive on Windows
- Tests follow existing source-inspection pattern (read file source, assert on content)
- Hash format: `#repos/{wsId}/wiki[/{subTab}][/component/{id}]`
