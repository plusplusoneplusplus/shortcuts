/**
 * Tests for shell argument escaping in the Copilot CLI invoker.
 * Covers platform-specific escaping for Windows (cmd.exe) and Unix/macOS shells.
 */

import * as assert from 'assert';
import { escapeShellArg } from '../../shortcuts/ai-service/copilot-cli-invoker';

suite('Shell Argument Escaping Tests', () => {

    suite('Unix/macOS Shell Escaping', () => {
        const platform: NodeJS.Platform = 'darwin';

        test('should wrap simple string in single quotes', () => {
            const result = escapeShellArg('hello world', platform);
            assert.strictEqual(result, "'hello world'");
        });

        test('should escape single quotes with end-escape-start pattern', () => {
            // Single quote becomes: '\'' (end quote, escaped quote, start quote)
            const result = escapeShellArg("it's a test", platform);
            assert.strictEqual(result, "'it'\\''s a test'");
        });

        test('should handle multiple single quotes', () => {
            const result = escapeShellArg("don't won't can't", platform);
            assert.strictEqual(result, "'don'\\''t won'\\''t can'\\''t'");
        });

        test('should preserve double quotes literally', () => {
            // Double quotes don't need escaping in single-quoted strings
            const result = escapeShellArg('say "hello"', platform);
            assert.strictEqual(result, "'say \"hello\"'");
        });

        test('should preserve special shell characters', () => {
            // These are preserved literally in single quotes
            const result = escapeShellArg('$HOME `whoami` $(pwd)', platform);
            assert.strictEqual(result, "'$HOME `whoami` $(pwd)'");
        });

        test('should preserve backslashes', () => {
            const result = escapeShellArg('path\\to\\file', platform);
            assert.strictEqual(result, "'path\\to\\file'");
        });

        test('should preserve newlines and tabs', () => {
            const result = escapeShellArg('line1\nline2\ttab', platform);
            assert.strictEqual(result, "'line1\nline2\ttab'");
        });

        test('should handle empty string', () => {
            const result = escapeShellArg('', platform);
            assert.strictEqual(result, "''");
        });

        test('should handle string with only single quote', () => {
            const result = escapeShellArg("'", platform);
            assert.strictEqual(result, "''\\'''");
        });

        test('should handle the problematic prompt example', () => {
            const prompt = 'is this safe?: "request->set"';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, "'is this safe?: \"request->set\"'");
        });

        test('should handle Linux platform the same as macOS', () => {
            const prompt = 'test "quote"';
            const darwinResult = escapeShellArg(prompt, 'darwin');
            const linuxResult = escapeShellArg(prompt, 'linux');
            assert.strictEqual(darwinResult, linuxResult);
        });
    });

    suite('Windows Shell Escaping (cmd.exe)', () => {
        const platform: NodeJS.Platform = 'win32';

        test('should wrap simple string in double quotes', () => {
            const result = escapeShellArg('hello world', platform);
            assert.strictEqual(result, '"hello world"');
        });

        test('should escape double quotes by doubling them', () => {
            const result = escapeShellArg('say "hello"', platform);
            assert.strictEqual(result, '"say ""hello"""');
        });

        test('should handle multiple double quotes', () => {
            const result = escapeShellArg('"a" and "b"', platform);
            assert.strictEqual(result, '"""a"" and ""b"""');
        });

        test('should escape percent signs by doubling them', () => {
            // Percent signs trigger environment variable expansion in cmd.exe
            const result = escapeShellArg('100% complete', platform);
            assert.strictEqual(result, '"100%% complete"');
        });

        test('should handle multiple percent signs', () => {
            const result = escapeShellArg('%PATH% and %HOME%', platform);
            assert.strictEqual(result, '"%%PATH%% and %%HOME%%"');
        });

        test('should preserve single quotes literally', () => {
            // Single quotes don't have special meaning in cmd.exe double-quoted strings
            const result = escapeShellArg("it's a test", platform);
            assert.strictEqual(result, '"it\'s a test"');
        });

        test('should preserve backslashes', () => {
            // Backslashes are literal in cmd.exe (unlike Unix)
            const result = escapeShellArg('C:\\Users\\test', platform);
            assert.strictEqual(result, '"C:\\Users\\test"');
        });

        test('should handle empty string', () => {
            const result = escapeShellArg('', platform);
            assert.strictEqual(result, '""');
        });

        test('should handle string with only double quote', () => {
            const result = escapeShellArg('"', platform);
            assert.strictEqual(result, '""""');
        });

        test('should handle the problematic prompt example from user', () => {
            // Original issue: copilot --allow-all-tools -p "is this safe?: "request->set""
            // This breaks because the inner quotes aren't escaped
            const prompt = 'is this safe?: "request->set"';
            const result = escapeShellArg(prompt, platform);
            // Expected: "is this safe?: ""request->set"""
            assert.strictEqual(result, '"is this safe?: ""request->set"""');
        });

        test('should handle complex prompt with quotes and special chars', () => {
            const prompt = 'What does this code do? "const x = 100%"';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"What does this code do? ""const x = 100%%"""');
        });

        test('should handle nested quotes', () => {
            const prompt = 'He said "she said \'hello\'"';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"He said ""she said \'hello\'\"""');
        });

        test('should handle code snippets with quotes', () => {
            // Note: exclamation marks are escaped with ^! for delayed expansion safety
            const prompt = 'Explain: console.log("Hello, World!")';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"Explain: console.log(""Hello, World^!"")"');
        });
    });

    suite('Windows Shell Escaping - Newlines', () => {
        const platform: NodeJS.Platform = 'win32';

        test('should convert Unix newlines to literal \\n', () => {
            const result = escapeShellArg('line1\nline2', platform);
            assert.strictEqual(result, '"line1\\nline2"');
        });

        test('should convert Windows CRLF to literal \\n', () => {
            const result = escapeShellArg('line1\r\nline2', platform);
            assert.strictEqual(result, '"line1\\nline2"');
        });

        test('should handle multiple newlines', () => {
            const result = escapeShellArg('a\nb\nc\nd', platform);
            assert.strictEqual(result, '"a\\nb\\nc\\nd"');
        });

        test('should handle mixed Windows and Unix newlines', () => {
            const result = escapeShellArg('a\r\nb\nc\r\nd', platform);
            assert.strictEqual(result, '"a\\nb\\nc\\nd"');
        });

        test('should remove standalone carriage returns', () => {
            const result = escapeShellArg('a\rb\rc', platform);
            assert.strictEqual(result, '"abc"');
        });

        test('should handle multiline code blocks', () => {
            const code = 'function test() {\n  return true;\n}';
            const result = escapeShellArg(code, platform);
            assert.strictEqual(result, '"function test() {\\n  return true;\\n}"');
        });

        test('should handle prompt with code and newlines', () => {
            const prompt = 'Explain this:\nconst x = "hello";\nconsole.log(x);';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"Explain this:\\nconst x = ""hello"";\\nconsole.log(x);"');
        });

        test('should handle trailing newline', () => {
            const result = escapeShellArg('hello\n', platform);
            assert.strictEqual(result, '"hello\\n"');
        });

        test('should handle leading newline', () => {
            const result = escapeShellArg('\nhello', platform);
            assert.strictEqual(result, '"\\nhello"');
        });

        test('should handle only newlines', () => {
            const result = escapeShellArg('\n\n\n', platform);
            assert.strictEqual(result, '"\\n\\n\\n"');
        });
    });

    suite('Windows Shell Escaping - Exclamation Marks (Delayed Expansion)', () => {
        const platform: NodeJS.Platform = 'win32';

        test('should escape single exclamation mark', () => {
            const result = escapeShellArg('Hello!', platform);
            assert.strictEqual(result, '"Hello^!"');
        });

        test('should escape multiple exclamation marks', () => {
            const result = escapeShellArg('Hello!! How are you!', platform);
            assert.strictEqual(result, '"Hello^!^! How are you^!"');
        });

        test('should escape exclamation marks in code', () => {
            const result = escapeShellArg('if (!value) { return; }', platform);
            assert.strictEqual(result, '"if (^!value) { return; }"');
        });

        test('should handle delayed expansion variable pattern', () => {
            // This pattern could be misinterpreted if delayed expansion is enabled
            const result = escapeShellArg('Use !PATH! variable', platform);
            assert.strictEqual(result, '"Use ^!PATH^! variable"');
        });

        test('should handle exclamation with other special chars', () => {
            const result = escapeShellArg('Say "Hello!" at 100%', platform);
            assert.strictEqual(result, '"Say ""Hello^!"" at 100%%"');
        });

        test('should handle TypeScript non-null assertion', () => {
            const result = escapeShellArg('const x = value!.property', platform);
            assert.strictEqual(result, '"const x = value^!.property"');
        });

        test('should handle JavaScript negation', () => {
            const result = escapeShellArg('!true === false', platform);
            assert.strictEqual(result, '"^!true === false"');
        });
    });

    suite('Windows Shell Escaping - Combined Edge Cases', () => {
        const platform: NodeJS.Platform = 'win32';

        test('should handle all special characters together', () => {
            const prompt = 'Is "!PATH!" equal to 100%?\nCheck now!';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"Is ""^!PATH^!"" equal to 100%%?\\nCheck now^!"');
        });

        test('should handle real-world code review prompt', () => {
            const prompt = 'Review this code:\nfunction validate(x) {\n  if (!x) throw "Invalid!";\n  return x;\n}';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"Review this code:\\nfunction validate(x) {\\n  if (^!x) throw ""Invalid^!"";\\n  return x;\\n}"');
        });

        test('should handle prompt with markdown code block', () => {
            const prompt = 'Explain:\n```js\nconsole.log("Hello!");\n```';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"Explain:\\n```js\\nconsole.log(""Hello^!"");\\n```"');
        });

        test('should handle complex JSON-like content with newlines', () => {
            const prompt = '{\n  "message": "Hello!",\n  "progress": "100%"\n}';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"{\\n  ""message"": ""Hello^!"",\\n  ""progress"": ""100%%""\\n}"');
        });

        test('should handle Windows file paths with newlines in prompt', () => {
            const prompt = 'File at C:\\Users\\test\\file.txt\nContains "data!"';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"File at C:\\Users\\test\\file.txt\\nContains ""data^!"""');
        });

        test('should preserve angle brackets as literals inside double quotes', () => {
            // < and > are redirection operators in cmd.exe, but they are
            // literal inside double quotes, so no escaping is needed
            const prompt = 'Fix this HTML: <div class="test">Hello</div>';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"Fix this HTML: <div class=""test"">Hello</div>"');
        });

        test('should handle all shell operators as literals inside double quotes', () => {
            // These characters are special in cmd.exe outside quotes:
            // < > | & ^ - but inside double quotes they are literal
            const prompt = 'Operators: < > | & ^ should be literal';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"Operators: < > | & ^ should be literal"');
        });

        test('should handle pipe and ampersand in code snippets', () => {
            const prompt = 'Explain: cat file.txt | grep "test" && echo "done"';
            const result = escapeShellArg(prompt, platform);
            assert.strictEqual(result, '"Explain: cat file.txt | grep ""test"" && echo ""done"""');
        });
    });

    suite('Platform Detection', () => {
        test('should use process.platform when no platform specified', () => {
            // This test verifies the function works without explicit platform
            const result = escapeShellArg('test');
            // Should be wrapped in quotes (either single or double depending on platform)
            assert.ok(
                result.startsWith("'") || result.startsWith('"'),
                'Result should be wrapped in quotes'
            );
            assert.ok(
                result.endsWith("'") || result.endsWith('"'),
                'Result should be wrapped in quotes'
            );
        });

        test('should produce different output for Windows vs Unix', () => {
            const prompt = 'test "quote"';
            const windowsResult = escapeShellArg(prompt, 'win32');
            const unixResult = escapeShellArg(prompt, 'darwin');

            // Windows uses double quotes, Unix uses single quotes
            assert.ok(windowsResult.startsWith('"'), 'Windows should use double quotes');
            assert.ok(unixResult.startsWith("'"), 'Unix should use single quotes');
            assert.notStrictEqual(windowsResult, unixResult);
        });
    });

    suite('Edge Cases', () => {
        test('should handle very long strings', () => {
            const longString = 'x'.repeat(10000);
            const windowsResult = escapeShellArg(longString, 'win32');
            const unixResult = escapeShellArg(longString, 'darwin');

            assert.strictEqual(windowsResult, `"${longString}"`);
            assert.strictEqual(unixResult, `'${longString}'`);
        });

        test('should handle string with all special characters', () => {
            const special = '"\' % $ ` ! @ # ^ & * ( ) { } [ ] | \\ / < > ?';

            // Windows: escape ", %, and !
            const windowsResult = escapeShellArg(special, 'win32');
            assert.ok(windowsResult.includes('""'), 'Windows should escape double quotes');
            assert.ok(windowsResult.includes('%%'), 'Windows should escape percent signs');
            assert.ok(windowsResult.includes('^!'), 'Windows should escape exclamation marks');

            // Unix: escape single quotes
            const unixResult = escapeShellArg(special, 'darwin');
            assert.ok(unixResult.includes("'\\''"), 'Unix should escape single quotes');
        });

        test('should handle Unicode characters', () => {
            const unicode = 'Hello 世界 🌍 émoji';
            const windowsResult = escapeShellArg(unicode, 'win32');
            const unixResult = escapeShellArg(unicode, 'darwin');

            assert.strictEqual(windowsResult, `"${unicode}"`);
            assert.strictEqual(unixResult, `'${unicode}'`);
        });

        test('should handle multiline strings differently per platform', () => {
            const multiline = 'line1\nline2\nline3';
            const windowsResult = escapeShellArg(multiline, 'win32');
            const unixResult = escapeShellArg(multiline, 'darwin');

            // Windows converts newlines to literal \n strings
            assert.strictEqual(windowsResult, '"line1\\nline2\\nline3"');
            // Unix preserves actual newlines
            assert.ok(unixResult.includes('\n'), 'Unix should preserve actual newlines');
        });

        test('should handle string starting and ending with quotes', () => {
            const quotedString = '"quoted"';
            const windowsResult = escapeShellArg(quotedString, 'win32');
            assert.strictEqual(windowsResult, '"""quoted"""');

            const singleQuotedString = "'quoted'";
            const unixResult = escapeShellArg(singleQuotedString, 'darwin');
            assert.strictEqual(unixResult, "''\\''quoted'\\'''");
        });

        test('should handle JSON-like content', () => {
            const json = '{"key": "value", "num": 100}';
            const windowsResult = escapeShellArg(json, 'win32');
            assert.strictEqual(windowsResult, '"{""key"": ""value"", ""num"": 100}"');

            const unixResult = escapeShellArg(json, 'darwin');
            assert.strictEqual(unixResult, "'{\"key\": \"value\", \"num\": 100}'");
        });

        test('should handle code with string literals', () => {
            const code = 'const msg = "Hello"; console.log(msg);';
            const windowsResult = escapeShellArg(code, 'win32');
            assert.strictEqual(windowsResult, '"const msg = ""Hello""; console.log(msg);"');
        });

        test('should handle arrow syntax from the reported issue', () => {
            // The specific case from the user's report
            const prompt = 'is this safe?: "request->set"';
            const windowsResult = escapeShellArg(prompt, 'win32');

            // Verify the command would be valid
            // copilot --allow-all-tools -p "is this safe?: ""request->set"""
            assert.strictEqual(windowsResult, '"is this safe?: ""request->set"""');

            // Verify it doesn't contain unescaped internal quotes
            // The pattern ": " followed by quote should have the quote escaped
            assert.ok(!windowsResult.match(/: "[^"]/), 'Internal quotes should be escaped');
        });
    });

    suite('Real-world Prompt Examples', () => {
        test('should handle AI clarification prompts with code', () => {
            const prompt = 'What does this function do?\n```typescript\nfunction test(a: string): string {\n  return `Hello, ${a}!`;\n}\n```';

            // Both platforms should handle this
            const windowsResult = escapeShellArg(prompt, 'win32');
            const unixResult = escapeShellArg(prompt, 'darwin');

            assert.ok(windowsResult.length > prompt.length, 'Windows result should include wrapper quotes');
            assert.ok(unixResult.length > prompt.length, 'Unix result should include wrapper quotes');

            // Windows should convert newlines and escape exclamation
            assert.ok(windowsResult.includes('\\n'), 'Windows should convert newlines to \\n');
            assert.ok(windowsResult.includes('^!'), 'Windows should escape exclamation marks');
        });

        test('should handle prompts with SQL queries', () => {
            const prompt = 'Is this SQL safe? SELECT * FROM users WHERE name = "admin"';
            const windowsResult = escapeShellArg(prompt, 'win32');
            assert.strictEqual(windowsResult, '"Is this SQL safe? SELECT * FROM users WHERE name = ""admin"""');
        });

        test('should handle prompts with HTML', () => {
            const prompt = 'Fix this HTML: <div class="container">Hello</div>';
            const windowsResult = escapeShellArg(prompt, 'win32');
            assert.strictEqual(windowsResult, '"Fix this HTML: <div class=""container"">Hello</div>"');
        });

        test('should handle prompts with regex patterns', () => {
            const prompt = 'Explain this regex: /^"[^"]*"$/';
            const windowsResult = escapeShellArg(prompt, 'win32');
            assert.strictEqual(windowsResult, '"Explain this regex: /^""[^""]*""$/"');
        });

        test('should handle prompts with HTML and JavaScript events', () => {
            const prompt = 'Fix this: <button onclick="alert(\'Hello!\')">Click</button>';
            const windowsResult = escapeShellArg(prompt, 'win32');
            // Note: ! is escaped with ^!
            assert.strictEqual(windowsResult, '"Fix this: <button onclick=""alert(\'Hello^!\')\"">Click</button>"');
        });
    });
});

