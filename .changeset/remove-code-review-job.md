---
"@plusplusoneplusplus/forge": major
---

Remove deprecated code-review-job and related exports.

The following public APIs have been removed:

- `createCodeReviewJob` — factory for the map-reduce code review job
- `CodeReviewInput` — input type for code review jobs
- `CodeReviewOutput` — output type for code review jobs
- `CodeReviewJobOptions` — options for code review job creation
- `RuleReviewResult` — per-rule review result type
- `ReviewFinding` — individual review finding type (replaced by `ReviewComment`)
- `ReviewSummary` — aggregated review summary type
- `Rule` — rule descriptor type
- `RuleInput` — rule input type
- `RuleWorkItemData` — rule work-item data type
- `RuleSplitter` — map-reduce splitter for rules
- `BatchedRuleSplitter` — batched variant of RuleSplitter
- `createRuleSplitter` — factory for RuleSplitter
- `createBatchedRuleSplitter` — factory for BatchedRuleSplitter
- `findingToComment` — migration helper (ReviewFinding → ReviewComment)
- `findingsToComments` — migration helper (ReviewFinding[] → ReviewComment[])
- `commentToFinding` — migration helper (ReviewComment → ReviewFinding)
- `commentsToFindings` — migration helper (ReviewComment[] → ReviewFinding[])
- `codeReviewOutputToResult` — migration helper (CodeReviewOutput → DiffReviewResult)
- `resultToCodeReviewOutput` — migration helper (DiffReviewResult → CodeReviewOutput)
- `FindingToCommentOptions` — options type for migration helpers

Use `IDiffReviewer`, `AIReviewer`, and `HumanReviewer` from `@plusplusoneplusplus/forge/review` instead.
