# @plusplusoneplusplus/coc-client

## 0.2.0

### Minor Changes

- 9413f77: Add AI-powered focused diff classification for PR review

  - New `/classify-diff` bundled skill with structured JSON output schema for per-hunk classification
  - Feature-flag gated `focusedDiff` (disabled by default) with admin panel toggle
  - REST API endpoints: POST to trigger classification, GET for cached results
  - Dashboard filter bar with Logic/Mechanical/Test/Generated checkboxes on PR Files Changed tab
  - File tree badges showing max hunk intensity per file
  - Visual dimming of non-logic hunks in focused mode
  - Classification stored as CoC conversation in process store, cached by PR ID + head SHA
  - `headSha` and `baseSha` added to canonical `PullRequest` type (GitHub and ADO adapters)
  - `PullRequestsClient` extended with `classify()` and `getClassification()` methods
