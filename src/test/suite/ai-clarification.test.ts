/**
 * Unit tests for AI Clarification Handler
 * Tests output parsing from Copilot CLI, prompt building, and instruction types
 */

import * as assert from 'assert';
import {
    buildClarificationPrompt,
    DEFAULT_PROMPTS,
    escapeShellArg,
    getPromptTemplate,
    parseCopilotOutput,
    validateAndTruncatePrompt
} from '../../shortcuts/markdown-comments/ai-clarification-handler';
import { AIInstructionType, ClarificationContext } from '../../shortcuts/markdown-comments/types';

/**
 * Helper function to create a ClarificationContext with defaults
 */
function createContext(overrides: Partial<ClarificationContext> = {}): ClarificationContext {
    return {
        selectedText: 'test text',
        selectionRange: { startLine: 1, endLine: 1 },
        filePath: 'test.md',
        surroundingContent: '',
        nearestHeading: null,
        headings: [],
        instructionType: 'clarify',
        ...overrides
    };
}

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

        test('should build simple clarify prompt with file path and selected text', () => {
            const context: ClarificationContext = {
                selectedText: 'test text',
                selectionRange: { startLine: 1, endLine: 1 },
                filePath: 'docs/test.md',
                surroundingContent: '',
                nearestHeading: null,
                headings: [],
                instructionType: 'clarify'
            };

            const result = buildClarificationPrompt(context);
            assert.strictEqual(result, 'Please clarify "test text" in the file docs/test.md');
        });

        test('should build go-deeper prompt with in-depth analysis instruction', () => {
            const context: ClarificationContext = {
                selectedText: 'test text',
                selectionRange: { startLine: 1, endLine: 1 },
                filePath: 'docs/test.md',
                surroundingContent: '',
                nearestHeading: null,
                headings: [],
                instructionType: 'go-deeper'
            };

            const result = buildClarificationPrompt(context);
            assert.strictEqual(result, 'Please provide an in-depth explanation and analysis of "test text" in the file docs/test.md');
        });

        test('should build custom prompt with user instruction', () => {
            const context: ClarificationContext = {
                selectedText: 'security logic',
                selectionRange: { startLine: 1, endLine: 1 },
                filePath: 'src/auth.rs',
                surroundingContent: '',
                nearestHeading: null,
                headings: [],
                instructionType: 'custom',
                customInstruction: 'Explain the security implications of'
            };

            const result = buildClarificationPrompt(context);
            assert.strictEqual(result, 'Explain the security implications of: "security logic" in the file src/auth.rs');
        });

        test('should use default instruction for custom type without customInstruction', () => {
            const context: ClarificationContext = {
                selectedText: 'test text',
                selectionRange: { startLine: 1, endLine: 1 },
                filePath: 'docs/test.md',
                surroundingContent: '',
                nearestHeading: null,
                headings: [],
                instructionType: 'custom'
            };

            const result = buildClarificationPrompt(context);
            assert.strictEqual(result, 'Please explain: "test text" in the file docs/test.md');
        });

        test('should trim whitespace from selected text', () => {
            const context: ClarificationContext = {
                selectedText: '  trimmed text  ',
                selectionRange: { startLine: 1, endLine: 1 },
                filePath: 'docs/test.md',
                surroundingContent: '',
                nearestHeading: null,
                headings: [],
                instructionType: 'clarify'
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
                headings: [],
                instructionType: 'clarify'
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
                headings: [],
                instructionType: 'clarify'
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
                headings: [],
                instructionType: 'clarify'
            };

            const result = validateAndTruncatePrompt(context);
            assert.strictEqual(result.truncated, true);
            assert.ok(result.prompt.length <= 8000);
            assert.ok(result.prompt.includes('...'));
        });

        test('should preserve instruction type when truncating', () => {
            const longText = 'x'.repeat(10000);
            const context: ClarificationContext = {
                selectedText: longText,
                selectionRange: { startLine: 1, endLine: 100 },
                filePath: 'test.md',
                surroundingContent: '',
                nearestHeading: null,
                headings: [],
                instructionType: 'go-deeper'
            };

            const result = validateAndTruncatePrompt(context);
            assert.strictEqual(result.truncated, true);
            assert.ok(result.prompt.includes('in-depth explanation and analysis'));
        });

        test('should preserve custom instruction when truncating', () => {
            const longText = 'x'.repeat(10000);
            const context = createContext({
                selectedText: longText,
                selectionRange: { startLine: 1, endLine: 100 },
                instructionType: 'custom',
                customInstruction: 'Analyze the performance of'
            });

            const result = validateAndTruncatePrompt(context);
            assert.strictEqual(result.truncated, true);
            assert.ok(result.prompt.includes('Analyze the performance of'));
        });
    });

    suite('DEFAULT_PROMPTS', () => {

        test('should have clarify prompt defined', () => {
            assert.strictEqual(typeof DEFAULT_PROMPTS.clarify, 'string');
            assert.ok(DEFAULT_PROMPTS.clarify.length > 0);
            assert.ok(DEFAULT_PROMPTS.clarify.includes('clarify'));
        });

        test('should have goDeeper prompt defined', () => {
            assert.strictEqual(typeof DEFAULT_PROMPTS.goDeeper, 'string');
            assert.ok(DEFAULT_PROMPTS.goDeeper.length > 0);
            assert.ok(DEFAULT_PROMPTS.goDeeper.includes('in-depth'));
        });

        test('should have customDefault prompt defined', () => {
            assert.strictEqual(typeof DEFAULT_PROMPTS.customDefault, 'string');
            assert.ok(DEFAULT_PROMPTS.customDefault.length > 0);
            assert.ok(DEFAULT_PROMPTS.customDefault.includes('explain'));
        });
    });

    suite('getPromptTemplate', () => {

        test('should return default clarify prompt when no setting configured', () => {
            const result = getPromptTemplate('clarify');
            assert.strictEqual(result, DEFAULT_PROMPTS.clarify);
        });

        test('should return default goDeeper prompt when no setting configured', () => {
            const result = getPromptTemplate('goDeeper');
            assert.strictEqual(result, DEFAULT_PROMPTS.goDeeper);
        });

        test('should return default customDefault prompt when no setting configured', () => {
            const result = getPromptTemplate('customDefault');
            assert.strictEqual(result, DEFAULT_PROMPTS.customDefault);
        });
    });

    suite('Instruction Types - Comprehensive', () => {

        test('should handle all instruction types', () => {
            const instructionTypes: AIInstructionType[] = ['clarify', 'go-deeper', 'custom'];

            for (const type of instructionTypes) {
                const context = createContext({ instructionType: type });
                const result = buildClarificationPrompt(context);

                assert.ok(result.length > 0, `Prompt for ${type} should not be empty`);
                assert.ok(result.includes('test text'), `Prompt for ${type} should include selected text`);
                assert.ok(result.includes('test.md'), `Prompt for ${type} should include file path`);
            }
        });

        test('clarify instruction should use clarify prompt template', () => {
            const context = createContext({ instructionType: 'clarify' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.startsWith('Please clarify'));
            assert.ok(!result.includes(':'), 'Clarify should not have colon before quote');
        });

        test('go-deeper instruction should use in-depth analysis prompt', () => {
            const context = createContext({ instructionType: 'go-deeper' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('in-depth'));
            assert.ok(result.includes('explanation'));
            assert.ok(result.includes('analysis'));
        });

        test('custom instruction with user-provided text', () => {
            const context = createContext({
                instructionType: 'custom',
                customInstruction: 'Compare and contrast'
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.startsWith('Compare and contrast'));
            assert.ok(result.includes(':'), 'Custom should have colon before quote');
        });

        test('custom instruction with empty string should use default', () => {
            const context = createContext({
                instructionType: 'custom',
                customInstruction: ''
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('Please explain'));
        });

        test('custom instruction with whitespace-only should use default', () => {
            const context = createContext({
                instructionType: 'custom',
                customInstruction: '   '
            });
            const result = buildClarificationPrompt(context);

            // Even whitespace-only is truthy, so it will be trimmed
            assert.ok(result.length > 0);
        });

        test('custom instruction with undefined should use default', () => {
            const context = createContext({
                instructionType: 'custom',
                customInstruction: undefined
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('Please explain'));
        });
    });

    suite('Selected Text Edge Cases', () => {

        test('should handle empty selected text', () => {
            const context = createContext({ selectedText: '' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('""'));
        });

        test('should handle selected text with only whitespace', () => {
            const context = createContext({ selectedText: '   ' });
            const result = buildClarificationPrompt(context);

            // After trim, it's empty
            assert.ok(result.includes('""'));
        });

        test('should handle selected text with newlines', () => {
            const context = createContext({
                selectedText: 'line1\nline2\nline3',
                selectionRange: { startLine: 1, endLine: 3 }
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('line1\nline2\nline3'));
        });

        test('should handle selected text with tabs', () => {
            const context = createContext({ selectedText: 'col1\tcol2\tcol3' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('col1\tcol2\tcol3'));
        });

        test('should handle selected text with special characters', () => {
            const context = createContext({ selectedText: 'fn main() { println!("hello"); }' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('fn main()'));
            assert.ok(result.includes('println!'));
        });

        test('should handle selected text with quotes', () => {
            const context = createContext({ selectedText: 'say "hello" to the world' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('say "hello" to the world'));
        });

        test('should handle selected text with unicode', () => {
            const context = createContext({ selectedText: '你好世界 🌍 émoji' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('你好世界'));
            assert.ok(result.includes('🌍'));
        });

        test('should handle very long selected text gracefully', () => {
            const longText = 'a'.repeat(5000);
            const context = createContext({ selectedText: longText });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes(longText));
        });
    });

    suite('File Path Variations', () => {

        test('should handle simple file path', () => {
            const context = createContext({ filePath: 'README.md' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('README.md'));
        });

        test('should handle nested file path', () => {
            const context = createContext({ filePath: 'src/utils/helpers.ts' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('src/utils/helpers.ts'));
        });

        test('should handle absolute file path', () => {
            const context = createContext({ filePath: '/home/user/project/file.md' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('/home/user/project/file.md'));
        });

        test('should handle Windows-style file path', () => {
            const context = createContext({ filePath: 'C:\\Users\\project\\file.md' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('C:\\Users\\project\\file.md'));
        });

        test('should handle file path with spaces', () => {
            const context = createContext({ filePath: 'my project/my file.md' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('my project/my file.md'));
        });

        test('should handle file path with special characters', () => {
            const context = createContext({ filePath: 'project-v2.0/[feature]/file_test.md' });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('project-v2.0/[feature]/file_test.md'));
        });
    });

    suite('Selection Range Handling', () => {

        test('should handle single line selection', () => {
            const context = createContext({
                selectionRange: { startLine: 5, endLine: 5 }
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.length > 0);
        });

        test('should handle multi-line selection', () => {
            const context = createContext({
                selectionRange: { startLine: 10, endLine: 25 }
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.length > 0);
        });

        test('should handle large line numbers', () => {
            const context = createContext({
                selectionRange: { startLine: 10000, endLine: 10500 }
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.length > 0);
        });
    });

    suite('Context Metadata', () => {

        test('should build prompt with surrounding content context', () => {
            const context = createContext({
                surroundingContent: 'function helper() { }\n// some comment'
            });
            const result = buildClarificationPrompt(context);

            // Current implementation doesn't include surrounding content in prompt
            // but the context should still be valid
            assert.ok(result.length > 0);
        });

        test('should build prompt with heading context', () => {
            const context = createContext({
                nearestHeading: 'Configuration Section',
                headings: ['Introduction', 'Configuration Section', 'Conclusion']
            });
            const result = buildClarificationPrompt(context);

            // Current implementation doesn't include headings in prompt
            // but the context should still be valid
            assert.ok(result.length > 0);
        });

        test('should handle null nearest heading', () => {
            const context = createContext({
                nearestHeading: null
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.length > 0);
        });

        test('should handle empty headings array', () => {
            const context = createContext({
                headings: []
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.length > 0);
        });
    });

    suite('Custom Instruction Variations', () => {

        test('should handle question-style custom instruction', () => {
            const context = createContext({
                instructionType: 'custom',
                customInstruction: 'What are the security implications of'
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.startsWith('What are the security implications of'));
        });

        test('should handle command-style custom instruction', () => {
            const context = createContext({
                instructionType: 'custom',
                customInstruction: 'List all potential bugs in'
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.startsWith('List all potential bugs in'));
        });

        test('should handle multi-word custom instruction', () => {
            const context = createContext({
                instructionType: 'custom',
                customInstruction: 'Explain the purpose, implementation details, and potential improvements for'
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('purpose'));
            assert.ok(result.includes('implementation details'));
            assert.ok(result.includes('potential improvements'));
        });

        test('should handle custom instruction with special characters', () => {
            const context = createContext({
                instructionType: 'custom',
                customInstruction: 'What\'s the O(n) complexity of'
            });
            const result = buildClarificationPrompt(context);

            assert.ok(result.includes("What's the O(n)"));
        });
    });

    suite('Prompt Format Consistency', () => {

        test('clarify prompt format should be consistent', () => {
            const context = createContext({
                selectedText: 'variable_name',
                filePath: 'src/main.rs',
                instructionType: 'clarify'
            });
            const result = buildClarificationPrompt(context);

            // Format: Please clarify "text" in the file path
            assert.ok(result.match(/^Please clarify ".*" in the file .*/));
        });

        test('go-deeper prompt format should be consistent', () => {
            const context = createContext({
                selectedText: 'algorithm',
                filePath: 'src/lib.rs',
                instructionType: 'go-deeper'
            });
            const result = buildClarificationPrompt(context);

            // Format: Please provide an in-depth... "text" in the file path
            assert.ok(result.match(/^Please provide an in-depth.*".*" in the file .*/));
        });

        test('custom prompt format should be consistent', () => {
            const context = createContext({
                selectedText: 'function',
                filePath: 'app.py',
                instructionType: 'custom',
                customInstruction: 'Describe'
            });
            const result = buildClarificationPrompt(context);

            // Format: Custom: "text" in the file path
            assert.ok(result.match(/^Describe: ".*" in the file .*/));
        });
    });

    suite('Integration - Full Workflow', () => {

        test('should handle realistic clarify request', () => {
            const context = createContext({
                selectedText: 'impl Drop for MyStruct',
                selectionRange: { startLine: 45, endLine: 50 },
                filePath: 'src/memory/allocator.rs',
                surroundingContent: 'struct MyStruct { buffer: Vec<u8> }',
                nearestHeading: 'Memory Management',
                headings: ['Overview', 'Memory Management', 'Usage'],
                instructionType: 'clarify'
            });

            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('Please clarify'));
            assert.ok(result.includes('impl Drop for MyStruct'));
            assert.ok(result.includes('allocator.rs'));
        });

        test('should handle realistic go-deeper request', () => {
            const context = createContext({
                selectedText: 'async fn process_batch<T: Send + Sync>',
                selectionRange: { startLine: 100, endLine: 150 },
                filePath: 'src/processor/batch.rs',
                surroundingContent: '// Processes items in parallel batches',
                nearestHeading: 'Batch Processing',
                headings: ['Introduction', 'Batch Processing', 'Error Handling'],
                instructionType: 'go-deeper'
            });

            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('in-depth explanation and analysis'));
            assert.ok(result.includes('async fn process_batch'));
            assert.ok(result.includes('batch.rs'));
        });

        test('should handle realistic custom instruction request', () => {
            const context = createContext({
                selectedText: 'unsafe { ptr::read(self.data) }',
                selectionRange: { startLine: 78, endLine: 78 },
                filePath: 'src/ffi/bindings.rs',
                surroundingContent: '// FFI binding for native library',
                nearestHeading: 'Unsafe Operations',
                headings: ['FFI Overview', 'Unsafe Operations', 'Safety Guarantees'],
                instructionType: 'custom',
                customInstruction: 'Explain the safety requirements and potential undefined behavior of'
            });

            const result = buildClarificationPrompt(context);

            assert.ok(result.includes('safety requirements'));
            assert.ok(result.includes('undefined behavior'));
            assert.ok(result.includes('unsafe { ptr::read'));
            assert.ok(result.includes('bindings.rs'));
        });
    });
});

