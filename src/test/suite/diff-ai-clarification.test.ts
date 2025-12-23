/**
 * Unit tests for Diff AI Clarification Handler
 * Tests prompt building, validation, and truncation for git diff AI clarification
 */

import * as assert from 'assert';
import {
    buildDiffClarificationPrompt,
    DEFAULT_PROMPTS,
    escapeShellArg,
    getPromptTemplate,
    parseCopilotOutput,
    validateAndTruncateDiffPrompt,
    VALID_MODELS
} from '../../shortcuts/git-diff-comments/diff-ai-clarification-handler';
import { DiffAIInstructionType, DiffClarificationContext, DiffSide } from '../../shortcuts/git-diff-comments/types';

/**
 * Helper function to create a DiffClarificationContext with defaults
 */
function createContext(overrides: Partial<DiffClarificationContext> = {}): DiffClarificationContext {
    return {
        selectedText: 'test code',
        selectionRange: { startLine: 1, endLine: 1 },
        side: 'new',
        filePath: 'src/test.ts',
        surroundingContent: '',
        instructionType: 'clarify',
        ...overrides
    };
}

suite('Diff AI Clarification Handler Tests', () => {

    suite('buildDiffClarificationPrompt', () => {

        test('should build simple clarify prompt with file path and selected text', () => {
            const context = createContext({
                selectedText: 'const x = 1;',
                filePath: 'src/index.ts',
                side: 'new',
                instructionType: 'clarify'
            });

            const result = buildDiffClarificationPrompt(context);
            assert.ok(result.includes('Please clarify'));
            assert.ok(result.includes('"const x = 1;"'));
            assert.ok(result.includes('src/index.ts'));
            assert.ok(result.includes('(from new version)'));
        });

        test('should include old version indicator for old side', () => {
            const context = createContext({
                selectedText: 'old code',
                side: 'old',
                instructionType: 'clarify'
            });

            const result = buildDiffClarificationPrompt(context);
            assert.ok(result.includes('(from old version)'));
        });

        test('should include new version indicator for new side', () => {
            const context = createContext({
                selectedText: 'new code',
                side: 'new',
                instructionType: 'clarify'
            });

            const result = buildDiffClarificationPrompt(context);
            assert.ok(result.includes('(from new version)'));
        });

        test('should not include side indicator for both side', () => {
            const context = createContext({
                selectedText: 'common code',
                side: 'both',
                instructionType: 'clarify'
            });

            const result = buildDiffClarificationPrompt(context);
            assert.ok(!result.includes('(from old version)'));
            assert.ok(!result.includes('(from new version)'));
        });

        test('should build go-deeper prompt with in-depth analysis instruction', () => {
            const context = createContext({
                selectedText: 'complex algorithm',
                instructionType: 'go-deeper'
            });

            const result = buildDiffClarificationPrompt(context);
            assert.ok(result.includes('in-depth explanation and analysis'));
            assert.ok(result.includes('"complex algorithm"'));
        });

        test('should build custom prompt with user instruction', () => {
            const context = createContext({
                selectedText: 'security check',
                instructionType: 'custom',
                customInstruction: 'Explain the security implications of'
            });

            const result = buildDiffClarificationPrompt(context);
            assert.ok(result.includes('Explain the security implications of'));
            assert.ok(result.includes(': "security check"'));
        });

        test('should use default instruction for custom type without customInstruction', () => {
            const context = createContext({
                selectedText: 'some code',
                instructionType: 'custom'
            });

            const result = buildDiffClarificationPrompt(context);
            assert.ok(result.includes('Please explain'));
        });

        test('should trim whitespace from selected text', () => {
            const context = createContext({
                selectedText: '  trimmed code  '
            });

            const result = buildDiffClarificationPrompt(context);
            assert.ok(result.includes('"trimmed code"'));
            assert.ok(!result.includes('"  trimmed code  "'));
        });

        test('should handle multi-line selected text', () => {
            const context = createContext({
                selectedText: 'line1\nline2\nline3',
                selectionRange: { startLine: 1, endLine: 3 }
            });

            const result = buildDiffClarificationPrompt(context);
            assert.ok(result.includes('line1\nline2\nline3'));
        });
    });

    suite('validateAndTruncateDiffPrompt', () => {

        test('should not truncate short prompts', () => {
            const context = createContext({
                selectedText: 'short code'
            });

            const result = validateAndTruncateDiffPrompt(context);
            assert.strictEqual(result.truncated, false);
            assert.ok(result.prompt.includes('short code'));
        });

        test('should truncate very long selected text', () => {
            const longText = 'x'.repeat(10000);
            const context = createContext({
                selectedText: longText
            });

            const result = validateAndTruncateDiffPrompt(context);
            assert.strictEqual(result.truncated, true);
            assert.ok(result.prompt.length <= 8000);
            assert.ok(result.prompt.includes('...'));
        });

        test('should preserve instruction type when truncating', () => {
            const longText = 'x'.repeat(10000);
            const context = createContext({
                selectedText: longText,
                instructionType: 'go-deeper'
            });

            const result = validateAndTruncateDiffPrompt(context);
            assert.strictEqual(result.truncated, true);
            assert.ok(result.prompt.includes('in-depth explanation and analysis'));
        });

        test('should preserve custom instruction when truncating', () => {
            const longText = 'x'.repeat(10000);
            const context = createContext({
                selectedText: longText,
                instructionType: 'custom',
                customInstruction: 'Analyze the performance of'
            });

            const result = validateAndTruncateDiffPrompt(context);
            assert.strictEqual(result.truncated, true);
            assert.ok(result.prompt.includes('Analyze the performance of'));
        });

        test('should preserve side indicator when truncating', () => {
            const longText = 'x'.repeat(10000);
            const context = createContext({
                selectedText: longText,
                side: 'old'
            });

            const result = validateAndTruncateDiffPrompt(context);
            assert.strictEqual(result.truncated, true);
            assert.ok(result.prompt.includes('(from old version)'));
        });
    });

    suite('Instruction Types - Comprehensive', () => {

        test('should handle all instruction types', () => {
            const instructionTypes: DiffAIInstructionType[] = ['clarify', 'go-deeper', 'custom'];

            for (const type of instructionTypes) {
                const context = createContext({ instructionType: type });
                const result = buildDiffClarificationPrompt(context);

                assert.ok(result.length > 0, `Prompt for ${type} should not be empty`);
                assert.ok(result.includes('test code'), `Prompt for ${type} should include selected text`);
                assert.ok(result.includes('src/test.ts'), `Prompt for ${type} should include file path`);
            }
        });

        test('clarify instruction should use clarify prompt template', () => {
            const context = createContext({ instructionType: 'clarify' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.startsWith('Please clarify'));
            assert.ok(!result.includes(':'), 'Clarify should not have colon before quote');
        });

        test('go-deeper instruction should use in-depth analysis prompt', () => {
            const context = createContext({ instructionType: 'go-deeper' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('in-depth'));
            assert.ok(result.includes('explanation'));
            assert.ok(result.includes('analysis'));
        });

        test('custom instruction with user-provided text', () => {
            const context = createContext({
                instructionType: 'custom',
                customInstruction: 'Compare and contrast'
            });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.startsWith('Compare and contrast'));
            assert.ok(result.includes(':'), 'Custom should have colon before quote');
        });
    });

    suite('Diff Side Variations', () => {

        test('should handle old side selection', () => {
            const context = createContext({
                side: 'old',
                selectedText: 'removed code'
            });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('(from old version)'));
            assert.ok(result.includes('removed code'));
        });

        test('should handle new side selection', () => {
            const context = createContext({
                side: 'new',
                selectedText: 'added code'
            });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('(from new version)'));
            assert.ok(result.includes('added code'));
        });

        test('should handle both side selection (context lines)', () => {
            const context = createContext({
                side: 'both',
                selectedText: 'unchanged code'
            });
            const result = buildDiffClarificationPrompt(context);

            // Should not include side indicator for 'both'
            assert.ok(!result.includes('(from old version)'));
            assert.ok(!result.includes('(from new version)'));
            assert.ok(result.includes('unchanged code'));
        });
    });

    suite('Selected Text Edge Cases', () => {

        test('should handle empty selected text', () => {
            const context = createContext({ selectedText: '' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('""'));
        });

        test('should handle selected text with only whitespace', () => {
            const context = createContext({ selectedText: '   ' });
            const result = buildDiffClarificationPrompt(context);

            // After trim, it's empty
            assert.ok(result.includes('""'));
        });

        test('should handle selected text with special characters', () => {
            const context = createContext({ selectedText: 'fn main() { println!("hello"); }' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('fn main()'));
            assert.ok(result.includes('println!'));
        });

        test('should handle selected text with quotes', () => {
            const context = createContext({ selectedText: 'say "hello" to the world' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('say "hello" to the world'));
        });

        test('should handle selected text with unicode', () => {
            const context = createContext({ selectedText: '你好世界 🌍 émoji' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('你好世界'));
            assert.ok(result.includes('🌍'));
        });
    });

    suite('File Path Variations', () => {

        test('should handle simple file path', () => {
            const context = createContext({ filePath: 'index.ts' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('index.ts'));
        });

        test('should handle nested file path', () => {
            const context = createContext({ filePath: 'src/utils/helpers.ts' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('src/utils/helpers.ts'));
        });

        test('should handle absolute file path', () => {
            const context = createContext({ filePath: '/home/user/project/file.ts' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('/home/user/project/file.ts'));
        });

        test('should handle file path with spaces', () => {
            const context = createContext({ filePath: 'my project/my file.ts' });
            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('my project/my file.ts'));
        });
    });

    suite('Prompt Format Consistency', () => {

        test('clarify prompt format should be consistent', () => {
            const context = createContext({
                selectedText: 'variable_name',
                filePath: 'src/main.ts',
                side: 'new',
                instructionType: 'clarify'
            });
            const result = buildDiffClarificationPrompt(context);

            // Format: Please clarify "text" (from side) in the file path
            assert.ok(result.match(/^Please clarify ".*" \(from new version\) in the file .*/));
        });

        test('go-deeper prompt format should be consistent', () => {
            const context = createContext({
                selectedText: 'algorithm',
                filePath: 'src/lib.ts',
                side: 'old',
                instructionType: 'go-deeper'
            });
            const result = buildDiffClarificationPrompt(context);

            // Format: Please provide an in-depth... "text" (from side) in the file path
            assert.ok(result.match(/^Please provide an in-depth.*".*" \(from old version\) in the file .*/));
        });

        test('custom prompt format should be consistent', () => {
            const context = createContext({
                selectedText: 'function',
                filePath: 'app.ts',
                side: 'new',
                instructionType: 'custom',
                customInstruction: 'Describe'
            });
            const result = buildDiffClarificationPrompt(context);

            // Format: Custom: "text" (from side) in the file path
            assert.ok(result.match(/^Describe: ".*" \(from new version\) in the file .*/));
        });
    });

    suite('Integration - Full Workflow', () => {

        test('should handle realistic clarify request for added code', () => {
            const context = createContext({
                selectedText: 'async function fetchData(url: string): Promise<Response>',
                selectionRange: { startLine: 45, endLine: 50 },
                side: 'new',
                filePath: 'src/api/client.ts',
                surroundingContent: '// API client implementation',
                instructionType: 'clarify'
            });

            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('Please clarify'));
            assert.ok(result.includes('async function fetchData'));
            assert.ok(result.includes('(from new version)'));
            assert.ok(result.includes('client.ts'));
        });

        test('should handle realistic go-deeper request for removed code', () => {
            const context = createContext({
                selectedText: 'function deprecatedMethod(): void { /* old implementation */ }',
                selectionRange: { startLine: 100, endLine: 105 },
                side: 'old',
                filePath: 'src/legacy/utils.ts',
                surroundingContent: '// Legacy utilities',
                instructionType: 'go-deeper'
            });

            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('in-depth explanation and analysis'));
            assert.ok(result.includes('deprecatedMethod'));
            assert.ok(result.includes('(from old version)'));
            assert.ok(result.includes('utils.ts'));
        });

        test('should handle realistic custom instruction request', () => {
            const context = createContext({
                selectedText: 'if (user.isAdmin && !user.isBanned) { grantAccess(); }',
                selectionRange: { startLine: 78, endLine: 78 },
                side: 'new',
                filePath: 'src/auth/permissions.ts',
                surroundingContent: '// Permission checks',
                instructionType: 'custom',
                customInstruction: 'Explain the security implications and potential vulnerabilities of'
            });

            const result = buildDiffClarificationPrompt(context);

            assert.ok(result.includes('security implications'));
            assert.ok(result.includes('vulnerabilities'));
            assert.ok(result.includes('user.isAdmin'));
            assert.ok(result.includes('permissions.ts'));
        });
    });

    suite('Re-exported AI Service Functions', () => {
        const isWindows = process.platform === 'win32';

        test('parseCopilotOutput should work correctly', () => {
            const output = `✓ Read src/test.ts
   └ 100 lines read

This is the clarification text.

Total usage est:       1 Premium request`;

            const result = parseCopilotOutput(output);
            assert.strictEqual(result, 'This is the clarification text.');
        });

        test('escapeShellArg should wrap string in appropriate quotes for platform', () => {
            const result = escapeShellArg('hello world');
            if (isWindows) {
                assert.strictEqual(result, '"hello world"');
            } else {
                assert.strictEqual(result, "'hello world'");
            }
        });

        test('escapeShellArg should escape quotes appropriately for platform', () => {
            const result = escapeShellArg("it's a test");
            if (isWindows) {
                // Windows preserves single quotes literally in double-quoted strings
                assert.strictEqual(result, '"it\'s a test"');
            } else {
                // Unix escapes single quotes with end-escape-start pattern
                assert.strictEqual(result, "'it'\\''s a test'");
            }
        });

        test('VALID_MODELS should contain expected model options', () => {
            assert.ok(VALID_MODELS.includes('claude-sonnet-4.5'));
            assert.ok(VALID_MODELS.includes('claude-haiku-4.5'));
            assert.ok(VALID_MODELS.includes('claude-opus-4.5'));
        });

        test('DEFAULT_PROMPTS should have all required prompts', () => {
            assert.ok(DEFAULT_PROMPTS.clarify);
            assert.ok(DEFAULT_PROMPTS.goDeeper);
            assert.ok(DEFAULT_PROMPTS.customDefault);
        });

        test('getPromptTemplate should return default prompts', () => {
            assert.ok(getPromptTemplate('clarify').includes('clarify'));
            assert.ok(getPromptTemplate('goDeeper').includes('in-depth'));
            assert.ok(getPromptTemplate('customDefault').includes('explain'));
        });
    });
});

