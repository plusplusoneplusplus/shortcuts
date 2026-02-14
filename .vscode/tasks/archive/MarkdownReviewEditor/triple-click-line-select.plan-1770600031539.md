# Triple Click to Select Line

## Description

Implement triple mouse click behavior in the Markdown Review Editor to select the entire line where the click occurred. This is a standard text editing convention that users expect — a single click places the cursor, a double click selects a word, and a triple click selects the full line.

## Acceptance Criteria

- [x] Triple-clicking on a line in the Markdown Review Editor selects the entire line content
- [x] Selection includes the full line from start to end (excluding the newline character)
- [x] Works correctly on lines of any length, including empty lines
- [x] Does not interfere with existing single-click (cursor placement) or double-click (word selection) behavior
- [x] Works consistently across different operating systems (macOS, Windows, Linux)
- [x] Selected text can be used with existing comment/annotation workflows (e.g., `Ctrl+Shift+M` to add a comment on the selected line)

## Subtasks

- [x] Add click-count tracking logic in the webview (detect triple click via timing or `detail` property of the `click`/`mousedown` event)
- [x] Implement line boundary detection to determine start and end offsets of the clicked line
- [x] Apply the selection range to cover the full line on triple click
- [x] Ensure the selection state is properly communicated to the extension host (for comment anchoring, prompt generation, etc.)
- [x] Test interaction with existing selection-based features (highlight, comment creation)
- [x] Handle edge cases: first line, last line, empty lines, lines inside code blocks or blockquotes

## Notes

- The `MouseEvent.detail` property provides the click count (1 for single, 2 for double, 3 for triple), which is the recommended approach over manual timing.
- The Markdown Review Editor uses a webview for rendering; selection logic will likely live in the webview's JavaScript.
- Verify that the selection coordinates/offsets align with how `CommentAnchor` resolves positions, so comments created on a triple-click selection anchor correctly.
