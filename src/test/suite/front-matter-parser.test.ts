/**
 * Tests for Front Matter Parser
 * 
 * Tests parsing of YAML front matter from code review rule files.
 * Ensures cross-platform compatibility (Windows CRLF, Unix LF).
 */

import * as assert from 'assert';
import {
    parseFrontMatter,
    hasFrontMatter,
    extractFrontMatterString
} from '../../shortcuts/code-review/front-matter-parser';

suite('Front Matter Parser', () => {
    suite('parseFrontMatter', () => {
        test('parses front matter with model field', () => {
            const content = `---
model: claude-sonnet-4-5
---

# Rule Content
This is the rule body.`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.strictEqual(result.frontMatter.model, 'claude-sonnet-4-5');
            assert.ok(result.content.includes('# Rule Content'));
            assert.ok(!result.content.includes('---'));
            assert.strictEqual(result.error, undefined);
        });

        test('parses front matter with different model names', () => {
            const testCases = [
                'gpt-4',
                'gpt-4-turbo',
                'claude-3-opus',
                'claude-sonnet-4-5',
                'haiku',
                'gemini-pro',
                'llama-3.1-70b'
            ];

            for (const modelName of testCases) {
                const content = `---
model: ${modelName}
---

# Content`;

                const result = parseFrontMatter(content);
                assert.strictEqual(result.frontMatter.model, modelName, `Failed for model: ${modelName}`);
            }
        });

        test('handles content without front matter', () => {
            const content = `# Rule Content

This is just a regular markdown file without front matter.`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, false);
            assert.strictEqual(result.frontMatter.model, undefined);
            assert.strictEqual(result.content, content);
        });

        test('handles empty content', () => {
            const result = parseFrontMatter('');

            assert.strictEqual(result.hasFrontMatter, false);
            assert.strictEqual(result.content, '');
        });

        test('handles whitespace-only content', () => {
            const result = parseFrontMatter('   \n\n   ');

            assert.strictEqual(result.hasFrontMatter, false);
        });

        test('handles front matter with empty YAML', () => {
            const content = `---
---

# Content`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.strictEqual(result.frontMatter.model, undefined);
            assert.ok(result.content.includes('# Content'));
        });

        test('handles front matter with only whitespace in YAML', () => {
            const content = `---
   
---

# Content`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
        });

        test('ignores non-model fields in front matter', () => {
            const content = `---
id: my-rule
name: My Rule
model: claude-sonnet-4-5
severity: error
category: security
---

# Content`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.strictEqual(result.frontMatter.model, 'claude-sonnet-4-5');
            // Other fields should not be present
            assert.strictEqual(Object.keys(result.frontMatter).length, 1);
        });

        test('handles model field with different casing', () => {
            const testCases = [
                { yaml: 'model: gpt-4', expected: 'gpt-4' },
                { yaml: 'Model: gpt-4', expected: 'gpt-4' },
                { yaml: 'MODEL: gpt-4', expected: 'gpt-4' }
            ];

            for (const tc of testCases) {
                const content = `---
${tc.yaml}
---

# Content`;

                const result = parseFrontMatter(content);
                assert.strictEqual(result.frontMatter.model, tc.expected, `Failed for: ${tc.yaml}`);
            }
        });

        test('handles quoted model values', () => {
            const content = `---
model: "claude-sonnet-4-5"
---

# Content`;

            const result = parseFrontMatter(content);
            assert.strictEqual(result.frontMatter.model, 'claude-sonnet-4-5');
        });

        test('handles single-quoted model values', () => {
            const content = `---
model: 'claude-sonnet-4-5'
---

# Content`;

            const result = parseFrontMatter(content);
            assert.strictEqual(result.frontMatter.model, 'claude-sonnet-4-5');
        });

        test('returns error for invalid YAML', () => {
            const content = `---
model: [invalid yaml
  - broken
---

# Content`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.ok(result.error, 'Should have an error');
            assert.ok(result.error.includes('Failed to parse'));
        });

        test('handles --- in content body (not front matter)', () => {
            const content = `---
model: gpt-4
---

# Rule Content

Here is some code:

---
This is a horizontal rule in the content
---

More content after the rule.`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.strictEqual(result.frontMatter.model, 'gpt-4');
            assert.ok(result.content.includes('horizontal rule'));
        });

        test('does not match front matter not at start of file', () => {
            const content = `Some leading content

---
model: gpt-4
---

# Rule`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, false);
            assert.strictEqual(result.frontMatter.model, undefined);
        });
    });

    suite('Cross-Platform Line Endings', () => {
        test('handles Unix line endings (LF)', () => {
            const content = '---\nmodel: gpt-4\n---\n\n# Content';

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.strictEqual(result.frontMatter.model, 'gpt-4');
        });

        test('handles Windows line endings (CRLF)', () => {
            const content = '---\r\nmodel: gpt-4\r\n---\r\n\r\n# Content';

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.strictEqual(result.frontMatter.model, 'gpt-4');
        });

        test('handles mixed line endings', () => {
            const content = '---\r\nmodel: gpt-4\n---\r\n\n# Content';

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.strictEqual(result.frontMatter.model, 'gpt-4');
        });

        test('preserves line endings in content after front matter', () => {
            const unixContent = '---\nmodel: gpt-4\n---\n\nLine 1\nLine 2';
            const windowsContent = '---\r\nmodel: gpt-4\r\n---\r\n\r\nLine 1\r\nLine 2';

            const unixResult = parseFrontMatter(unixContent);
            const windowsResult = parseFrontMatter(windowsContent);

            assert.ok(unixResult.content.includes('Line 1'));
            assert.ok(unixResult.content.includes('Line 2'));
            assert.ok(windowsResult.content.includes('Line 1'));
            assert.ok(windowsResult.content.includes('Line 2'));
        });
    });

    suite('hasFrontMatter', () => {
        test('returns true for content with front matter', () => {
            const content = `---
model: gpt-4
---

# Content`;

            assert.strictEqual(hasFrontMatter(content), true);
        });

        test('returns false for content without front matter', () => {
            const content = `# Content

No front matter here.`;

            assert.strictEqual(hasFrontMatter(content), false);
        });

        test('returns false for empty content', () => {
            assert.strictEqual(hasFrontMatter(''), false);
        });

        test('returns false for null/undefined', () => {
            assert.strictEqual(hasFrontMatter(null as unknown as string), false);
            assert.strictEqual(hasFrontMatter(undefined as unknown as string), false);
        });

        test('returns true for Windows line endings', () => {
            const content = '---\r\nmodel: gpt-4\r\n---\r\n\r\n# Content';
            assert.strictEqual(hasFrontMatter(content), true);
        });
    });

    suite('extractFrontMatterString', () => {
        test('extracts front matter YAML string', () => {
            const content = `---
model: gpt-4
other: value
---

# Content`;

            const yaml = extractFrontMatterString(content);

            assert.ok(yaml);
            assert.ok(yaml.includes('model: gpt-4'));
            assert.ok(yaml.includes('other: value'));
        });

        test('returns null for content without front matter', () => {
            const content = `# Content

No front matter.`;

            const yaml = extractFrontMatterString(content);
            assert.strictEqual(yaml, null);
        });

        test('returns null for empty content', () => {
            assert.strictEqual(extractFrontMatterString(''), null);
        });

        test('returns null for null/undefined', () => {
            assert.strictEqual(extractFrontMatterString(null as unknown as string), null);
            assert.strictEqual(extractFrontMatterString(undefined as unknown as string), null);
        });
    });

    suite('Edge Cases', () => {
        test('handles front matter with trailing whitespace on delimiter', () => {
            const content = `---   
model: gpt-4
---   

# Content`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.strictEqual(result.frontMatter.model, 'gpt-4');
        });

        test('handles front matter at exact end of file', () => {
            const content = `---
model: gpt-4
---`;

            const result = parseFrontMatter(content);

            assert.strictEqual(result.hasFrontMatter, true);
            assert.strictEqual(result.frontMatter.model, 'gpt-4');
            assert.strictEqual(result.content, '');
        });

        test('handles model value with special characters', () => {
            const content = `---
model: "my-model/v2.0:latest"
---

# Content`;

            const result = parseFrontMatter(content);
            assert.strictEqual(result.frontMatter.model, 'my-model/v2.0:latest');
        });

        test('handles non-string model value gracefully', () => {
            const content = `---
model: 123
---

# Content`;

            const result = parseFrontMatter(content);

            // Number should not be treated as a valid model
            assert.strictEqual(result.frontMatter.model, undefined);
        });

        test('handles array model value gracefully', () => {
            const content = `---
model:
  - gpt-4
  - claude
---

# Content`;

            const result = parseFrontMatter(content);

            // Array should not be treated as a valid model
            assert.strictEqual(result.frontMatter.model, undefined);
        });

        test('handles very long model names', () => {
            const longModelName = 'a'.repeat(200);
            const content = `---
model: ${longModelName}
---

# Content`;

            const result = parseFrontMatter(content);
            assert.strictEqual(result.frontMatter.model, longModelName);
        });
    });
});
