/**
 * Tests for smart prompt delivery in the CLI utilities.
 * Covers the decision logic for choosing between direct and file-based prompt delivery,
 * as well as temp file creation and cross-platform compatibility.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    shouldUseFileDelivery,
    writePromptToTempFile,
    buildCliCommand,
    PROMPT_LENGTH_THRESHOLD,
    PROBLEMATIC_CHARS_PATTERN
} from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// shouldUseFileDelivery Tests
// ============================================================================

suite('Smart Prompt Delivery - shouldUseFileDelivery', () => {

    suite('Length-based decisions', () => {
        test('should use direct delivery for short simple prompts', () => {
            const shortPrompt = 'Explain this function';
            assert.strictEqual(shouldUseFileDelivery(shortPrompt), false);
        });

        test('should use direct delivery for prompt at length threshold', () => {
            const prompt = 'a'.repeat(PROMPT_LENGTH_THRESHOLD);
            assert.strictEqual(shouldUseFileDelivery(prompt), false);
        });

        test('should use file delivery for prompt exceeding length threshold', () => {
            const longPrompt = 'a'.repeat(PROMPT_LENGTH_THRESHOLD + 1);
            assert.strictEqual(shouldUseFileDelivery(longPrompt), true);
        });

        test('should use file delivery for very long prompts', () => {
            const veryLongPrompt = 'x'.repeat(10000);
            assert.strictEqual(shouldUseFileDelivery(veryLongPrompt), true);
        });

        test('should use direct delivery for empty string', () => {
            assert.strictEqual(shouldUseFileDelivery(''), false);
        });
    });

    suite('Character-based decisions - Safe characters', () => {
        test('should use direct delivery for alphanumeric only', () => {
            assert.strictEqual(shouldUseFileDelivery('HelloWorld123'), false);
        });

        test('should use direct delivery for spaces', () => {
            assert.strictEqual(shouldUseFileDelivery('Hello World'), false);
        });

        test('should use direct delivery for periods', () => {
            assert.strictEqual(shouldUseFileDelivery('file.txt'), false);
        });

        test('should use direct delivery for commas', () => {
            assert.strictEqual(shouldUseFileDelivery('a, b, c'), false);
        });

        test('should use direct delivery for colons', () => {
            assert.strictEqual(shouldUseFileDelivery('key: value'), false);
        });

        test('should use direct delivery for semicolons', () => {
            assert.strictEqual(shouldUseFileDelivery('item1; item2'), false);
        });

        test('should use direct delivery for hyphens', () => {
            assert.strictEqual(shouldUseFileDelivery('my-variable'), false);
        });

        test('should use direct delivery for underscores', () => {
            assert.strictEqual(shouldUseFileDelivery('my_variable'), false);
        });

        test('should use direct delivery for @ symbol', () => {
            assert.strictEqual(shouldUseFileDelivery('user@example.com'), false);
        });

        test('should use direct delivery for typical simple prompt', () => {
            const prompt = 'Explain the code in auth.service.ts';
            assert.strictEqual(shouldUseFileDelivery(prompt), false);
        });
    });

    suite('Character-based decisions - Problematic characters', () => {
        test('should use file delivery for single quotes', () => {
            assert.strictEqual(shouldUseFileDelivery("it's a test"), true);
        });

        test('should use file delivery for double quotes', () => {
            assert.strictEqual(shouldUseFileDelivery('say "hello"'), true);
        });

        test('should use file delivery for backticks', () => {
            assert.strictEqual(shouldUseFileDelivery('use `code` here'), true);
        });

        test('should use file delivery for dollar sign', () => {
            assert.strictEqual(shouldUseFileDelivery('$HOME variable'), true);
        });

        test('should use file delivery for exclamation mark', () => {
            assert.strictEqual(shouldUseFileDelivery('Hello!'), true);
        });

        test('should use file delivery for percent sign', () => {
            assert.strictEqual(shouldUseFileDelivery('100% complete'), true);
        });

        test('should use file delivery for backslash', () => {
            assert.strictEqual(shouldUseFileDelivery('C:\\path'), true);
        });

        test('should use file delivery for angle brackets', () => {
            assert.strictEqual(shouldUseFileDelivery('<div>'), true);
            assert.strictEqual(shouldUseFileDelivery('a > b'), true);
        });

        test('should use file delivery for pipe character', () => {
            assert.strictEqual(shouldUseFileDelivery('cmd | grep'), true);
        });

        test('should use file delivery for ampersand', () => {
            assert.strictEqual(shouldUseFileDelivery('cmd1 && cmd2'), true);
        });

        test('should use file delivery for parentheses', () => {
            assert.strictEqual(shouldUseFileDelivery('function()'), true);
        });

        test('should use file delivery for curly braces', () => {
            assert.strictEqual(shouldUseFileDelivery('{ key: value }'), true);
        });

        test('should use file delivery for square brackets', () => {
            assert.strictEqual(shouldUseFileDelivery('array[0]'), true);
        });

        test('should use file delivery for hash/pound sign', () => {
            assert.strictEqual(shouldUseFileDelivery('# comment'), true);
        });

        test('should use file delivery for asterisk', () => {
            assert.strictEqual(shouldUseFileDelivery('*.txt'), true);
        });

        test('should use file delivery for question mark', () => {
            assert.strictEqual(shouldUseFileDelivery('what?'), true);
        });

        test('should use file delivery for tilde', () => {
            assert.strictEqual(shouldUseFileDelivery('~/home'), true);
        });

        test('should use file delivery for newlines', () => {
            assert.strictEqual(shouldUseFileDelivery('line1\nline2'), true);
        });

        test('should use file delivery for carriage returns', () => {
            assert.strictEqual(shouldUseFileDelivery('line1\rline2'), true);
        });

        test('should use file delivery for tabs', () => {
            assert.strictEqual(shouldUseFileDelivery('col1\tcol2'), true);
        });
    });

    suite('Real-world prompt examples', () => {
        test('should use direct delivery for simple question', () => {
            assert.strictEqual(shouldUseFileDelivery('What does this function do'), false);
        });

        test('should use file delivery for code with quotes', () => {
            const prompt = 'Explain: const msg = "Hello"';
            assert.strictEqual(shouldUseFileDelivery(prompt), true);
        });

        test('should use file delivery for markdown code blocks', () => {
            const prompt = 'Review:\n```js\nconsole.log("test");\n```';
            assert.strictEqual(shouldUseFileDelivery(prompt), true);
        });

        test('should use file delivery for JSON content', () => {
            const prompt = 'Parse: {"key": "value"}';
            assert.strictEqual(shouldUseFileDelivery(prompt), true);
        });

        test('should use file delivery for shell commands', () => {
            const prompt = 'Explain: cat file.txt | grep "test"';
            assert.strictEqual(shouldUseFileDelivery(prompt), true);
        });

        test('should use file delivery for regex patterns', () => {
            const prompt = 'Fix regex: /^[a-z]+$/';
            assert.strictEqual(shouldUseFileDelivery(prompt), true);
        });

        test('should use file delivery for HTML content', () => {
            const prompt = 'Fix: <div class="container">Hello</div>';
            assert.strictEqual(shouldUseFileDelivery(prompt), true);
        });

        test('should use file delivery for TypeScript generics', () => {
            const prompt = 'Review: Array<string>';
            assert.strictEqual(shouldUseFileDelivery(prompt), true);
        });

        test('should use file delivery for template literals', () => {
            const prompt = 'Fix: `Hello ${name}!`';
            assert.strictEqual(shouldUseFileDelivery(prompt), true);
        });

        test('should use file delivery for arrow functions', () => {
            const prompt = 'Explain: const fn = (x) => x * 2';
            assert.strictEqual(shouldUseFileDelivery(prompt), true);
        });
    });
});

// ============================================================================
// writePromptToTempFile Tests
// ============================================================================

suite('Smart Prompt Delivery - writePromptToTempFile', () => {

    suite('Basic functionality', () => {
        test('should create a file in temp directory', () => {
            const prompt = 'Test prompt content';
            const filepath = writePromptToTempFile(prompt);

            assert.ok(fs.existsSync(filepath), 'File should exist');
            assert.ok(filepath.startsWith(os.tmpdir()), 'File should be in temp directory');

            // Cleanup
            fs.unlinkSync(filepath);
        });

        test('should write correct content to file', () => {
            const prompt = 'Test prompt content with unicode: 世界 🌍';
            const filepath = writePromptToTempFile(prompt);

            const content = fs.readFileSync(filepath, 'utf-8');
            assert.strictEqual(content, prompt);

            // Cleanup
            fs.unlinkSync(filepath);
        });

        test('should create unique filenames', () => {
            const prompt = 'Same content';
            const filepath1 = writePromptToTempFile(prompt);
            const filepath2 = writePromptToTempFile(prompt);

            assert.notStrictEqual(filepath1, filepath2, 'Should create unique filenames');
            assert.ok(fs.existsSync(filepath1), 'File 1 should exist');
            assert.ok(fs.existsSync(filepath2), 'File 2 should exist');

            // Cleanup
            fs.unlinkSync(filepath1);
            fs.unlinkSync(filepath2);
        });

        test('should use correct filename pattern', () => {
            const filepath = writePromptToTempFile('test');
            const filename = path.basename(filepath);

            assert.ok(filename.startsWith('copilot-prompt-'), 'Should start with copilot-prompt-');
            assert.ok(filename.endsWith('.txt'), 'Should end with .txt');

            // Cleanup
            fs.unlinkSync(filepath);
        });
    });

    suite('Content handling', () => {
        test('should handle empty string', () => {
            const filepath = writePromptToTempFile('');
            const content = fs.readFileSync(filepath, 'utf-8');
            assert.strictEqual(content, '');

            // Cleanup
            fs.unlinkSync(filepath);
        });

        test('should handle very long content', () => {
            const longContent = 'x'.repeat(100000);
            const filepath = writePromptToTempFile(longContent);
            const content = fs.readFileSync(filepath, 'utf-8');
            assert.strictEqual(content, longContent);

            // Cleanup
            fs.unlinkSync(filepath);
        });

        test('should preserve newlines', () => {
            const prompt = 'line1\nline2\nline3';
            const filepath = writePromptToTempFile(prompt);
            const content = fs.readFileSync(filepath, 'utf-8');
            assert.strictEqual(content, prompt);

            // Cleanup
            fs.unlinkSync(filepath);
        });

        test('should preserve Windows line endings', () => {
            const prompt = 'line1\r\nline2\r\nline3';
            const filepath = writePromptToTempFile(prompt);
            const content = fs.readFileSync(filepath, 'utf-8');
            assert.strictEqual(content, prompt);

            // Cleanup
            fs.unlinkSync(filepath);
        });

        test('should preserve special characters', () => {
            const prompt = 'Quotes: "\' Symbols: $!%`\\ Brackets: ()[]{}<>';
            const filepath = writePromptToTempFile(prompt);
            const content = fs.readFileSync(filepath, 'utf-8');
            assert.strictEqual(content, prompt);

            // Cleanup
            fs.unlinkSync(filepath);
        });

        test('should preserve Unicode content', () => {
            const prompt = '日本語 中文 한국어 العربية 🎉🚀💻';
            const filepath = writePromptToTempFile(prompt);
            const content = fs.readFileSync(filepath, 'utf-8');
            assert.strictEqual(content, prompt);

            // Cleanup
            fs.unlinkSync(filepath);
        });
    });

    suite('Cross-platform path handling', () => {
        test('should create valid path on current platform', () => {
            const filepath = writePromptToTempFile('test');

            // Path should be absolute
            assert.ok(path.isAbsolute(filepath), 'Path should be absolute');

            // Should be accessible
            assert.ok(fs.existsSync(filepath), 'File should be accessible');

            // Cleanup
            fs.unlinkSync(filepath);
        });
    });
});

// ============================================================================
// buildCliCommand Integration Tests
// ============================================================================

suite('Smart Prompt Delivery - buildCliCommand Integration', () => {

    suite('Delivery method selection', () => {
        test('should use direct delivery for no prompt', () => {
            const result = buildCliCommand('copilot');
            assert.strictEqual(result.deliveryMethod, 'direct');
            assert.strictEqual(result.tempFilePath, undefined);
        });

        test('should use direct delivery for simple prompt', () => {
            const result = buildCliCommand('copilot', { prompt: 'Explain this function' });
            assert.strictEqual(result.deliveryMethod, 'direct');
            assert.strictEqual(result.tempFilePath, undefined);
            assert.ok(result.command.includes('Explain this function'));
        });

        test('should use file delivery for prompt with quotes', () => {
            const result = buildCliCommand('copilot', { prompt: 'Fix "this" bug' });
            assert.strictEqual(result.deliveryMethod, 'file');
            assert.ok(result.tempFilePath, 'Should have temp file path');
            assert.ok(fs.existsSync(result.tempFilePath!), 'Temp file should exist');

            // Verify content
            const content = fs.readFileSync(result.tempFilePath!, 'utf-8');
            assert.strictEqual(content, 'Fix "this" bug');

            // Cleanup
            fs.unlinkSync(result.tempFilePath!);
        });

        test('should use file delivery for long prompt', () => {
            const longPrompt = 'a'.repeat(PROMPT_LENGTH_THRESHOLD + 100);
            const result = buildCliCommand('claude', { prompt: longPrompt });
            assert.strictEqual(result.deliveryMethod, 'file');
            assert.ok(result.tempFilePath);

            // Cleanup
            fs.unlinkSync(result.tempFilePath!);
        });

        test('should use file delivery for prompt with newlines', () => {
            const result = buildCliCommand('copilot', { prompt: 'line1\nline2' });
            assert.strictEqual(result.deliveryMethod, 'file');

            // Cleanup
            if (result.tempFilePath) {
                fs.unlinkSync(result.tempFilePath);
            }
        });
    });

    suite('Command format', () => {
        test('direct delivery should include prompt in command', () => {
            const result = buildCliCommand('copilot', {
                prompt: 'Simple prompt',
                platform: 'darwin'
            });
            assert.ok(result.command.includes('Simple prompt'));
            assert.ok(result.command.includes('-i'));
        });

        test('file delivery should include redirect instruction', () => {
            const result = buildCliCommand('copilot', {
                prompt: 'Prompt with "quotes"',
                platform: 'darwin'
            });
            assert.ok(result.command.includes('Follow the instructions in'));
            assert.ok(result.command.includes('-i'));

            // Cleanup
            if (result.tempFilePath) {
                fs.unlinkSync(result.tempFilePath);
            }
        });

        test('should include model flag when specified', () => {
            const result = buildCliCommand('copilot', {
                prompt: 'Simple prompt',
                model: 'gpt-4'
            });
            assert.ok(result.command.includes('--model gpt-4'));
        });

        test('should work with claude tool', () => {
            const result = buildCliCommand('claude', { prompt: 'Simple prompt' });
            assert.ok(result.command.startsWith('claude'));
        });
    });

    suite('Cross-platform command generation', () => {
        test('direct delivery on Unix should use single quotes', () => {
            const result = buildCliCommand('copilot', {
                prompt: 'Simple prompt',
                platform: 'darwin'
            });
            assert.ok(result.command.includes("'Simple prompt'"));
        });

        test('direct delivery on Windows should use double quotes', () => {
            const result = buildCliCommand('copilot', {
                prompt: 'Simple prompt',
                platform: 'win32'
            });
            assert.ok(result.command.includes('"Simple prompt"'));
        });

        test('file delivery redirect should be properly escaped on Unix', () => {
            const result = buildCliCommand('copilot', {
                prompt: 'Prompt with "quotes"',
                platform: 'darwin'
            });

            // Should use single quotes for the redirect prompt
            assert.ok(result.command.includes("'Follow the instructions in"));

            // Cleanup
            if (result.tempFilePath) {
                fs.unlinkSync(result.tempFilePath);
            }
        });

        test('file delivery redirect should be properly escaped on Windows', () => {
            const result = buildCliCommand('copilot', {
                prompt: 'Prompt with "quotes"',
                platform: 'win32'
            });

            // Should use double quotes for the redirect prompt
            assert.ok(result.command.includes('"Follow the instructions in'));

            // Cleanup
            if (result.tempFilePath) {
                fs.unlinkSync(result.tempFilePath);
            }
        });

        test('file delivery on Linux should work same as macOS', () => {
            const result1 = buildCliCommand('copilot', {
                prompt: 'Prompt with $var',
                platform: 'darwin'
            });
            const result2 = buildCliCommand('copilot', {
                prompt: 'Prompt with $var',
                platform: 'linux'
            });

            assert.strictEqual(result1.deliveryMethod, 'file');
            assert.strictEqual(result2.deliveryMethod, 'file');

            // Both should have similar command structure (single quotes)
            assert.ok(result1.command.includes("'Follow the instructions in"));
            assert.ok(result2.command.includes("'Follow the instructions in"));

            // Cleanup
            if (result1.tempFilePath) fs.unlinkSync(result1.tempFilePath);
            if (result2.tempFilePath) fs.unlinkSync(result2.tempFilePath);
        });
    });
});

// ============================================================================
// PROBLEMATIC_CHARS_PATTERN Tests
// ============================================================================

suite('Smart Prompt Delivery - PROBLEMATIC_CHARS_PATTERN', () => {
    test('should not match safe characters', () => {
        const safeStrings = [
            'abcdefghijklmnopqrstuvwxyz',
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            '0123456789',
            'hello world',
            'file.name.txt',
            'key: value',
            'item1, item2',
            'first; second',
            'my-variable',
            'my_variable',
            'user@domain',
        ];

        for (const str of safeStrings) {
            assert.strictEqual(
                PROBLEMATIC_CHARS_PATTERN.test(str),
                false,
                `'${str}' should be considered safe`
            );
        }
    });

    test('should match problematic characters', () => {
        const problematicStrings = [
            ["'", 'single quote'],
            ['"', 'double quote'],
            ['`', 'backtick'],
            ['$', 'dollar sign'],
            ['!', 'exclamation'],
            ['%', 'percent'],
            ['\\', 'backslash'],
            ['<', 'less than'],
            ['>', 'greater than'],
            ['|', 'pipe'],
            ['&', 'ampersand'],
            ['(', 'open paren'],
            [')', 'close paren'],
            ['{', 'open brace'],
            ['}', 'close brace'],
            ['[', 'open bracket'],
            [']', 'close bracket'],
            ['#', 'hash'],
            ['*', 'asterisk'],
            ['?', 'question mark'],
            ['~', 'tilde'],
            ['\n', 'newline'],
            ['\r', 'carriage return'],
            ['\t', 'tab'],
        ];

        for (const [char, name] of problematicStrings) {
            assert.strictEqual(
                PROBLEMATIC_CHARS_PATTERN.test(char),
                true,
                `'${name}' (${char.charCodeAt(0)}) should be considered problematic`
            );
        }
    });
});
