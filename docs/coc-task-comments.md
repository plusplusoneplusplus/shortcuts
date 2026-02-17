# CoC Task Comments Guide

## Overview

The CoC task commenting feature allows you to add inline comments to task results for review, documentation, and AI-assisted analysis. Comments are persistent, categorized, and anchored to specific text in the output.

## Quick Start

1. **Open a task result** in the task viewer (`coc serve`)
2. **Select text** you want to comment on
3. **Press** `Cmd+Shift+M` (macOS) or `Ctrl+Shift+M` (Windows/Linux)
4. **Choose a category** (optional): Bug, Question, Suggestion, Praise, Nitpick, General
5. **Enter your comment** and submit

Your comment is saved and visible inline in the task viewer and in the comments panel.

---

## Features

### Comment Categories

Comments can be categorized for better organization:

- **Bug** — Potential bugs or issues found in the output
- **Question** — Questions needing clarification
- **Suggestion** — Improvement suggestions
- **Praise** — Positive feedback on good patterns
- **Nitpick** — Minor style or formatting issues
- **General** — General comments (default)

### Comment Anchoring

Comments are anchored to specific text in the result:
- Anchors use content fingerprinting and context tracking (surrounding text)
- Fuzzy matching relocates anchors even if the surrounding content changes
- The original anchored text is displayed in the comment card

### Filtering

Filter comments to focus on what matters:
- **By category**: Show only bugs, questions, etc.
- **By status**: Show open comments, resolved, or all
- Comment counts are displayed per category in the filter bar

### AI Integration

Generate AI prompts from your comments:

1. Accumulate comments on a task result
2. Use the prompt generation feature to create a structured prompt
3. The prompt includes task context, all comments with categories, and anchored text
4. Send to an AI assistant for automated review or analysis

---

## Usage Examples

### Code Review Workflow

1. Run a pipeline to analyze code
2. Review the results in the task viewer
3. Add comments on issues found:
   - **Bug** comments on potential errors
   - **Suggestion** comments on improvements
   - **Question** comments on unclear logic
4. Generate AI prompt for automated follow-up
5. Iterate until all comments are resolved

### Documentation Review

1. Run a documentation generation task
2. Add comments on unclear sections using **Question** category
3. Use **Suggestion** for improvements
4. Generate prompt for AI to expand or clarify documentation

### Quality Assurance

1. Execute a test analysis pipeline
2. Comment on coverage gaps using **Bug** category
3. Use **Nitpick** for style issues
4. Track resolution via comment status filtering

---

## Comment Storage

### Location

Comments are stored locally per workspace:

```
{dataDir}/tasks-comments/{workspaceId}/{sha256(filePath)}.json
```

Each task file has its own comment file, identified by the SHA-256 hash of the file path. Comments are scoped to a workspace via a deterministic workspace ID.

### Format

```json
{
  "comments": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "text": "This function needs error handling",
      "category": "bug",
      "status": "open",
      "anchor": {
        "startLine": 42,
        "endLine": 45,
        "startColumn": 0,
        "endColumn": 25,
        "text": "function processData(input) {\n  return input.map(x => x.value);\n}",
        "contextBefore": "// Process input data",
        "contextAfter": "// Return results",
        "fingerprint": "a1b2c3d4"
      },
      "createdAt": "2026-01-15T10:30:00.000Z",
      "updatedAt": "2026-01-15T10:30:00.000Z"
    }
  ]
}
```

### Version Control

**Recommendations**:
- Add the comments directory to version control for team collaboration
- Or add to `.gitignore` for personal notes only
- Comments are JSON files and merge cleanly in most cases

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+M` | Add comment on selected text |

---

## Best Practices

### Writing Effective Comments

1. **Be specific**: Reference the exact text that prompted the comment
2. **Use categories**: Helps with filtering and prioritization
3. **Add context**: Explain *why* something is an issue, not just *what*
4. **Keep it actionable**: Write comments that can be acted on

### Organizing Comments

1. **Use categories consistently** across team members
2. **Resolve comments** when addressed to keep the view clean
3. **Use filters** to focus on one category at a time during review
4. **Archive completed tasks** to keep the workspace tidy

---

## Troubleshooting

### Comments Not Appearing

**Issue**: Comments don't show in the viewer
**Solution**: Verify the comment JSON file exists and is valid. Check browser console for errors.

### Anchor Lost

**Issue**: Comment anchor can't find text after content changes
**Solution**: Anchors use fuzzy matching, but heavy modifications may break the link. The original anchored text is still displayed in the comment.

### Keyboard Shortcut Conflict

**Issue**: `Cmd/Ctrl+Shift+M` doesn't work
**Solution**: Check for conflicting shortcuts in your OS or browser. The shortcut only works when a task result is open in the viewer.

---

## FAQ

**Q: Are comments synced across machines?**
A: No, comments are stored locally. Use git or file sync for sharing.

**Q: Do comments affect task execution?**
A: No. Comments are metadata only and don't change pipeline results.

**Q: Can I add comments programmatically?**
A: Yes. Create or modify the JSON file directly — comments are plain JSON.

**Q: What happens to comments when a task is re-run?**
A: Comments persist. Anchors attempt to relocate to the new content via fuzzy matching.

---

## Related Documentation

- [CoC README](../packages/coc/README.md) — Main CoC documentation
- [Pipeline YAML Guide](../CLAUDE.md#yaml-pipeline-framework) — Pipeline configuration
- [VS Code Extension](../README.md) — Extension features
