/**
 * Unit tests for AI Clarification Handler
 * Tests output parsing from Copilot CLI
 */

import * as assert from 'assert';
import {
    buildClarificationPrompt,
    escapeShellArg,
    parseCopilotOutput,
    validateAndTruncatePrompt
} from '../../shortcuts/markdown-comments/ai-clarification-handler';
import { ClarificationContext } from '../../shortcuts/markdown-comments/types';

suite('AI Clarification Handler Tests', () => {

    suite('parseCopilotOutput', () => {

        test('should extract clarification from simple output', () => {
            const output = `✓ Read docs/design/cluster-topology.md
   └ 535 lines read

This is the clarification text.
It spans multiple lines.

Total usage est:       1 Premium request
Total duration (API):  12s`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'This is the clarification text.\nIt spans multiple lines.');
        });

        test('should handle output with multiple file reads', () => {
            const output = `✓ Read docs/design/cluster-topology.md
   └ 535 lines read

✓ Read src/config.rs
   └ 200 lines read

Here is the explanation of the code.

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'Here is the explanation of the code.');
        });

        test('should filter out Glob operations', () => {
            const output = `✓ Glob "crates/kv-test-utils/**/*.rs"

✓ Glob "tests/**/*.rs"

The code duplication issue is explained here.

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'The code duplication issue is explained here.');
        });

        test('should filter out failed operations', () => {
            const output = `✓ Read docs/design.md
   └ 100 lines read

✗ read_bash
Invalid session ID: read_files. Please supply a valid session ID to read output from.

The actual clarification content.

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'The actual clarification content.');
        });

        test('should filter out error messages', () => {
            const output = `Error: Something went wrong
Warning: This is a warning

The clarification text after errors.

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'The clarification text after errors.');
        });

        test('should handle complex multi-paragraph clarification', () => {
            const output = `✓ Read docs/design/251023-cluster-topology.md
   └ 535 lines read

Based on the design document, here is the clarification:

In this context, **Configuration drift** refers to the inconsistency between how different parts of the system define the cluster structure.

Specifically, the document identifies that:
1.  **Scripts** generate their own temporary config files at runtime.
2.  **Test utilities** implement their own separate logic.
3.  **Node information** is scattered across multiple structs.

Total usage est:       1 Premium request
Total duration (API):  12s
Total duration (wall): 14s
Total code changes:    0 lines added, 0 lines removed
Usage by model:
    gemini-3-pro-preview 39.4k input, 263 output`;

            const result = parseCopilotOutput(output);
            assert.ok(result.includes('Based on the design document'));
            assert.ok(result.includes('Configuration drift'));
            assert.ok(result.includes('Scripts'));
            assert.ok(result.includes('Test utilities'));
            assert.ok(!result.includes('Total usage'));
            assert.ok(!result.includes('gemini-3-pro'));
        });

        test('should strip ANSI escape codes', () => {
            const output = `\x1b[32m✓\x1b[0m Read docs/test.md
   └ 100 lines read

\x1b[1mBold text\x1b[0m and normal text.

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'Bold text and normal text.');
        });

        test('should handle empty output', () => {
            const output = `✓ Read docs/test.md
   └ 100 lines read

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, '');
        });

        test('should handle output with tree branch characters', () => {
            const output = `✓ Read file1.md
   ├ Reading content...
   └ 50 lines read

Clarification text here.

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'Clarification text here.');
        });

        test('should filter out tool invocation lines', () => {
            const output = `Read file docs/test.md
Glob pattern matched
Search completed
List directory done

Actual clarification content.

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'Actual clarification content.');
        });

        test('should handle session ID errors', () => {
            const output = `✓ Read docs/test.md
   └ 100 lines read

Invalid session ID: some_session. Please supply a valid session ID.
Another line with session ID reference.

The clarification we want.

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'The clarification we want.');
        });

        test('should preserve markdown formatting in clarification', () => {
            const output = `✓ Read docs/test.md
   └ 100 lines read

## Heading

- Bullet point 1
- Bullet point 2

\`\`\`rust
fn main() {
    println!("Hello");
}
\`\`\`

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.ok(result.includes('## Heading'));
            assert.ok(result.includes('- Bullet point 1'));
            assert.ok(result.includes('```rust'));
            assert.ok(result.includes('fn main()'));
        });

        test('should handle output with only status lines', () => {
            const output = `✓ Read docs/test.md
   └ 100 lines read

✓ Glob "**/*.rs"

✗ Failed operation

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, '');
        });
    });

    suite('escapeShellArg', () => {

        test('should wrap string in single quotes', () => {
            const result = escapeShellArg('hello world');
            assert.strictEqual(result, "'hello world'");
        });

        test('should escape single quotes', () => {
            const result = escapeShellArg("it's a test");
            assert.strictEqual(result, "'it'\\''s a test'");
        });

        test('should preserve newlines', () => {
            const result = escapeShellArg('line1\nline2');
            assert.strictEqual(result, "'line1\nline2'");
        });

        test('should preserve tabs', () => {
            const result = escapeShellArg('col1\tcol2');
            assert.strictEqual(result, "'col1\tcol2'");
        });

        test('should handle multiple single quotes', () => {
            const result = escapeShellArg("it's Bob's file");
            assert.strictEqual(result, "'it'\\''s Bob'\\''s file'");
        });

        test('should handle empty string', () => {
            const result = escapeShellArg('');
            assert.strictEqual(result, "''");
        });

        test('should preserve special characters in single quotes', () => {
            const result = escapeShellArg('$PATH `command` "quoted"');
            assert.strictEqual(result, "'$PATH `command` \"quoted\"'");
        });
    });

    suite('buildClarificationPrompt', () => {

        test('should build simple prompt with file path and selected text', () => {
            const context: ClarificationContext = {
                selectedText: 'test text',
                selectionRange: { startLine: 1, endLine: 1 },
                filePath: 'docs/test.md',
                surroundingContent: '',
                nearestHeading: null,
                headings: []
            };

            const result = buildClarificationPrompt(context);
            assert.strictEqual(result, 'Please clarify "test text" in the file docs/test.md');
        });

        test('should trim whitespace from selected text', () => {
            const context: ClarificationContext = {
                selectedText: '  trimmed text  ',
                selectionRange: { startLine: 1, endLine: 1 },
                filePath: 'docs/test.md',
                surroundingContent: '',
                nearestHeading: null,
                headings: []
            };

            const result = buildClarificationPrompt(context);
            assert.strictEqual(result, 'Please clarify "trimmed text" in the file docs/test.md');
        });

        test('should handle multi-line selected text', () => {
            const context: ClarificationContext = {
                selectedText: 'line1\nline2\nline3',
                selectionRange: { startLine: 1, endLine: 3 },
                filePath: 'src/main.rs',
                surroundingContent: '',
                nearestHeading: null,
                headings: []
            };

            const result = buildClarificationPrompt(context);
            assert.ok(result.includes('line1\nline2\nline3'));
            assert.ok(result.includes('src/main.rs'));
        });
    });

    suite('validateAndTruncatePrompt', () => {

        test('should not truncate short prompts', () => {
            const context: ClarificationContext = {
                selectedText: 'short text',
                selectionRange: { startLine: 1, endLine: 1 },
                filePath: 'test.md',
                surroundingContent: '',
                nearestHeading: null,
                headings: []
            };

            const result = validateAndTruncatePrompt(context);
            assert.strictEqual(result.truncated, false);
            assert.ok(result.prompt.includes('short text'));
        });

        test('should truncate very long selected text', () => {
            const longText = 'x'.repeat(10000);
            const context: ClarificationContext = {
                selectedText: longText,
                selectionRange: { startLine: 1, endLine: 100 },
                filePath: 'test.md',
                surroundingContent: '',
                nearestHeading: null,
                headings: []
            };

            const result = validateAndTruncatePrompt(context);
            assert.strictEqual(result.truncated, true);
            assert.ok(result.prompt.length <= 8000);
            assert.ok(result.prompt.includes('...'));
        });
    });
});

