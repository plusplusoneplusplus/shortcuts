/**
 * Comprehensive unit tests for Markdown Parser utilities
 * Tests syntax highlighting, code block parsing, and mermaid detection
 */

import * as assert from 'assert';
import {
    detectEmphasis,
    detectHeadingLevel,
    detectLineType,
    escapeHtml,
    extractInlineCode,
    extractLinks,
    getLanguageDisplayName,
    hasMermaidBlocks,
    isBlockquote,
    isCodeFenceEnd,
    isCodeFenceStart,
    isHorizontalRule,
    isOrderedListItem,
    isTaskListItem,
    isUnorderedListItem,
    parseCodeBlocks,
    parseMermaidBlocks,
    parseTable
} from '../../shortcuts/markdown-comments';

suite('Markdown Parser Tests', () => {

    suite('escapeHtml', () => {
        test('should escape HTML entities', () => {
            assert.strictEqual(escapeHtml('<script>alert("xss")</script>'),
                '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        });

        test('should escape ampersands', () => {
            assert.strictEqual(escapeHtml('A & B'), 'A &amp; B');
        });

        test('should escape quotes', () => {
            assert.strictEqual(escapeHtml('He said "hello"'), 'He said &quot;hello&quot;');
        });

        test('should escape single quotes', () => {
            assert.strictEqual(escapeHtml("It's working"), 'It&#039;s working');
        });

        test('should handle empty string', () => {
            assert.strictEqual(escapeHtml(''), '');
        });

        test('should not double-escape', () => {
            const result = escapeHtml('&lt;');
            assert.strictEqual(result, '&amp;lt;');
        });
    });

    suite('parseCodeBlocks', () => {
        test('should parse simple code block', () => {
            const content = `Some text
\`\`\`javascript
const x = 42;
\`\`\`
More text`;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].language, 'javascript');
            assert.strictEqual(blocks[0].code, 'const x = 42;');
            assert.strictEqual(blocks[0].startLine, 2);
            assert.strictEqual(blocks[0].endLine, 4);
            assert.strictEqual(blocks[0].isMermaid, false);
        });

        test('should parse multiple code blocks', () => {
            const content = `\`\`\`python
print("hello")
\`\`\`

\`\`\`typescript
const name: string = "world";
\`\`\``;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 2);
            assert.strictEqual(blocks[0].language, 'python');
            assert.strictEqual(blocks[1].language, 'typescript');
        });

        test('should detect mermaid blocks', () => {
            const content = `\`\`\`mermaid
graph TD
    A --> B
\`\`\``;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].language, 'mermaid');
            assert.strictEqual(blocks[0].isMermaid, true);
        });

        test('should handle code block without language', () => {
            const content = `\`\`\`
plain text
\`\`\``;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].language, 'plaintext');
        });

        test('should handle multi-line code blocks', () => {
            const content = `\`\`\`javascript
function hello() {
    console.log("Hello");
    console.log("World");
}
\`\`\``;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.ok(blocks[0].code.includes('function hello()'));
            assert.ok(blocks[0].code.includes('console.log'));
        });

        test('should handle empty code block', () => {
            const content = `\`\`\`javascript
\`\`\``;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].code, '');
        });

        test('should return empty array for content without code blocks', () => {
            const content = `# Heading
Some paragraph text
- List item`;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 0);
        });

        test('should generate unique IDs for blocks', () => {
            const content = `\`\`\`js
a
\`\`\`
\`\`\`py
b
\`\`\``;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 2);
            assert.notStrictEqual(blocks[0].id, blocks[1].id);
            assert.ok(blocks[0].id.includes('codeblock-'));
            assert.ok(blocks[1].id.includes('codeblock-'));
        });
    });

    suite('hasMermaidBlocks', () => {
        test('should detect mermaid block', () => {
            const content = `\`\`\`mermaid
graph TD
    A --> B
\`\`\``;
            assert.strictEqual(hasMermaidBlocks(content), true);
        });

        test('should return false for non-mermaid blocks', () => {
            const content = `\`\`\`javascript
const x = 1;
\`\`\``;
            assert.strictEqual(hasMermaidBlocks(content), false);
        });

        test('should return false for plain text', () => {
            const content = 'Just some regular text';
            assert.strictEqual(hasMermaidBlocks(content), false);
        });
    });

    suite('parseMermaidBlocks', () => {
        test('should only return mermaid blocks', () => {
            const content = `\`\`\`javascript
const x = 1;
\`\`\`

\`\`\`mermaid
graph TD
    A --> B
\`\`\`

\`\`\`python
print("hi")
\`\`\``;

            const blocks = parseMermaidBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].language, 'mermaid');
            assert.strictEqual(blocks[0].isMermaid, true);
        });
    });

    suite('detectHeadingLevel', () => {
        test('should detect h1', () => {
            assert.strictEqual(detectHeadingLevel('# Heading'), 1);
        });

        test('should detect h2', () => {
            assert.strictEqual(detectHeadingLevel('## Heading'), 2);
        });

        test('should detect h3', () => {
            assert.strictEqual(detectHeadingLevel('### Heading'), 3);
        });

        test('should detect h6', () => {
            assert.strictEqual(detectHeadingLevel('###### Heading'), 6);
        });

        test('should return 0 for non-heading', () => {
            assert.strictEqual(detectHeadingLevel('Regular text'), 0);
        });

        test('should require space after hashes', () => {
            assert.strictEqual(detectHeadingLevel('#NoSpace'), 0);
        });

        test('should handle more than 6 hashes', () => {
            assert.strictEqual(detectHeadingLevel('####### Not a heading'), 0);
        });
    });

    suite('isBlockquote', () => {
        test('should detect blockquote', () => {
            assert.strictEqual(isBlockquote('> This is quoted'), true);
        });

        test('should detect blockquote with space', () => {
            assert.strictEqual(isBlockquote('>   Indented quote'), true);
        });

        test('should return false for non-blockquote', () => {
            assert.strictEqual(isBlockquote('Regular text'), false);
        });
    });

    suite('isUnorderedListItem', () => {
        test('should detect dash list item', () => {
            assert.strictEqual(isUnorderedListItem('- Item'), true);
        });

        test('should detect asterisk list item', () => {
            assert.strictEqual(isUnorderedListItem('* Item'), true);
        });

        test('should detect plus list item', () => {
            assert.strictEqual(isUnorderedListItem('+ Item'), true);
        });

        test('should detect indented list item', () => {
            assert.strictEqual(isUnorderedListItem('  - Nested item'), true);
        });

        test('should return false for non-list', () => {
            assert.strictEqual(isUnorderedListItem('Regular text'), false);
        });

        test('should require space after marker', () => {
            assert.strictEqual(isUnorderedListItem('-NoSpace'), false);
        });
    });

    suite('isOrderedListItem', () => {
        test('should detect numbered list item', () => {
            assert.strictEqual(isOrderedListItem('1. First item'), true);
        });

        test('should detect multi-digit number', () => {
            assert.strictEqual(isOrderedListItem('10. Tenth item'), true);
        });

        test('should detect indented list item', () => {
            assert.strictEqual(isOrderedListItem('   5. Indented'), true);
        });

        test('should return false for non-list', () => {
            assert.strictEqual(isOrderedListItem('Regular text'), false);
        });

        test('should require period after number', () => {
            assert.strictEqual(isOrderedListItem('1 NoSpace'), false);
        });
    });

    suite('isHorizontalRule', () => {
        test('should detect dash rule', () => {
            assert.strictEqual(isHorizontalRule('---'), true);
        });

        test('should detect long dash rule', () => {
            assert.strictEqual(isHorizontalRule('----------'), true);
        });

        test('should detect asterisk rule', () => {
            assert.strictEqual(isHorizontalRule('***'), true);
        });

        test('should detect underscore rule', () => {
            assert.strictEqual(isHorizontalRule('___'), true);
        });

        test('should return false for heading', () => {
            assert.strictEqual(isHorizontalRule('# Heading'), false);
        });

        test('should return false for text with dashes', () => {
            assert.strictEqual(isHorizontalRule('-- not a rule --'), false);
        });
    });

    suite('isTaskListItem', () => {
        test('should detect unchecked task', () => {
            const result = isTaskListItem('- [ ] Todo item');
            assert.strictEqual(result.isTask, true);
            assert.strictEqual(result.checked, false);
        });

        test('should detect checked task', () => {
            const result = isTaskListItem('- [x] Done item');
            assert.strictEqual(result.isTask, true);
            assert.strictEqual(result.checked, true);
        });

        test('should handle uppercase X', () => {
            const result = isTaskListItem('- [X] Done item');
            assert.strictEqual(result.isTask, true);
            assert.strictEqual(result.checked, true);
        });

        test('should return false for regular list', () => {
            const result = isTaskListItem('- Regular item');
            assert.strictEqual(result.isTask, false);
            assert.strictEqual(result.checked, false);
        });

        test('should handle asterisk marker', () => {
            const result = isTaskListItem('* [ ] Task');
            assert.strictEqual(result.isTask, true);
        });

        test('should handle plus marker', () => {
            const result = isTaskListItem('+ [x] Task');
            assert.strictEqual(result.isTask, true);
            assert.strictEqual(result.checked, true);
        });
    });

    suite('extractLinks', () => {
        test('should extract single link', () => {
            const links = extractLinks('Check [Google](https://google.com) for info');
            assert.strictEqual(links.length, 1);
            assert.strictEqual(links[0].text, 'Google');
            assert.strictEqual(links[0].url, 'https://google.com');
        });

        test('should extract multiple links', () => {
            const links = extractLinks('[A](a.com) and [B](b.com)');
            assert.strictEqual(links.length, 2);
            assert.strictEqual(links[0].text, 'A');
            assert.strictEqual(links[1].text, 'B');
        });

        test('should return empty array for no links', () => {
            const links = extractLinks('No links here');
            assert.strictEqual(links.length, 0);
        });

        test('should include position information', () => {
            const links = extractLinks('[Link](url)');
            assert.strictEqual(links[0].start, 0);
            assert.strictEqual(links[0].end, 11);
        });
    });

    suite('extractInlineCode', () => {
        test('should extract inline code', () => {
            const codes = extractInlineCode('Use `npm install` to install');
            assert.strictEqual(codes.length, 1);
            assert.strictEqual(codes[0].code, 'npm install');
        });

        test('should extract multiple code spans', () => {
            const codes = extractInlineCode('Both `foo` and `bar` are valid');
            assert.strictEqual(codes.length, 2);
            assert.strictEqual(codes[0].code, 'foo');
            assert.strictEqual(codes[1].code, 'bar');
        });

        test('should return empty array for no code', () => {
            const codes = extractInlineCode('No code here');
            assert.strictEqual(codes.length, 0);
        });

        test('should include position information', () => {
            const codes = extractInlineCode('The `code` is here');
            assert.strictEqual(codes[0].start, 4);
            assert.strictEqual(codes[0].end, 10);
        });
    });

    suite('isCodeFenceStart', () => {
        test('should detect code fence with language', () => {
            const result = isCodeFenceStart('```javascript');
            assert.strictEqual(result.isFence, true);
            assert.strictEqual(result.language, 'javascript');
        });

        test('should detect code fence without language', () => {
            const result = isCodeFenceStart('```');
            assert.strictEqual(result.isFence, true);
            assert.strictEqual(result.language, 'plaintext');
        });

        test('should return false for non-fence', () => {
            const result = isCodeFenceStart('Regular text');
            assert.strictEqual(result.isFence, false);
        });

        test('should handle whitespace after language', () => {
            const result = isCodeFenceStart('```python  ');
            assert.strictEqual(result.isFence, true);
            assert.strictEqual(result.language, 'python');
        });
    });

    suite('isCodeFenceEnd', () => {
        test('should detect code fence end', () => {
            assert.strictEqual(isCodeFenceEnd('```'), true);
        });

        test('should handle whitespace', () => {
            assert.strictEqual(isCodeFenceEnd('```  '), true);
        });

        test('should return false for fence with language', () => {
            assert.strictEqual(isCodeFenceEnd('```javascript'), false);
        });
    });

    suite('detectEmphasis', () => {
        test('should detect bold with asterisks', () => {
            const result = detectEmphasis('This is **bold** text');
            assert.strictEqual(result.bold.length, 1);
            assert.strictEqual(result.bold[0].text, 'bold');
        });

        test('should detect bold with underscores', () => {
            const result = detectEmphasis('This is __bold__ text');
            assert.strictEqual(result.bold.length, 1);
            assert.strictEqual(result.bold[0].text, 'bold');
        });

        test('should detect italic with asterisks', () => {
            const result = detectEmphasis('This is *italic* text');
            assert.strictEqual(result.italic.length, 1);
            assert.strictEqual(result.italic[0].text, 'italic');
        });

        test('should detect italic with underscores', () => {
            const result = detectEmphasis('This is _italic_ text');
            assert.strictEqual(result.italic.length, 1);
            assert.strictEqual(result.italic[0].text, 'italic');
        });

        test('should detect strikethrough', () => {
            const result = detectEmphasis('This is ~~deleted~~ text');
            assert.strictEqual(result.strikethrough.length, 1);
            assert.strictEqual(result.strikethrough[0].text, 'deleted');
        });

        test('should detect multiple emphasis types', () => {
            const result = detectEmphasis('**bold** and *italic* and ~~strike~~');
            assert.strictEqual(result.bold.length, 1);
            assert.strictEqual(result.italic.length, 1);
            assert.strictEqual(result.strikethrough.length, 1);
        });

        test('should handle no emphasis', () => {
            const result = detectEmphasis('Plain text');
            assert.strictEqual(result.bold.length, 0);
            assert.strictEqual(result.italic.length, 0);
            assert.strictEqual(result.strikethrough.length, 0);
        });
    });

    suite('parseTable', () => {
        test('should parse simple table', () => {
            const lines = [
                '| Header 1 | Header 2 |',
                '|----------|----------|',
                '| Cell 1   | Cell 2   |'
            ];

            const result = parseTable(lines, 0);
            assert.ok(result);
            assert.deepStrictEqual(result.headers, ['Header 1', 'Header 2']);
            assert.strictEqual(result.rows.length, 1);
            assert.deepStrictEqual(result.rows[0], ['Cell 1', 'Cell 2']);
        });

        test('should parse table with multiple rows', () => {
            const lines = [
                '| A | B |',
                '|---|---|',
                '| 1 | 2 |',
                '| 3 | 4 |'
            ];

            const result = parseTable(lines, 0);
            assert.ok(result);
            assert.strictEqual(result.rows.length, 2);
        });

        test('should return null for non-table', () => {
            const lines = ['Not a table'];
            const result = parseTable(lines, 0);
            assert.strictEqual(result, null);
        });

        test('should return null for out of bounds', () => {
            const lines: string[] = [];
            const result = parseTable(lines, 0);
            assert.strictEqual(result, null);
        });

        test('should return endIndex', () => {
            const lines = [
                '| A | B |',
                '|---|---|',
                '| 1 | 2 |',
                '',
                'Next paragraph'
            ];

            const result = parseTable(lines, 0);
            assert.ok(result);
            assert.strictEqual(result.endIndex, 2);
        });
    });

    suite('detectLineType', () => {
        test('should detect heading', () => {
            assert.strictEqual(detectLineType('# Heading', false), 'heading');
        });

        test('should detect blockquote', () => {
            assert.strictEqual(detectLineType('> Quote', false), 'blockquote');
        });

        test('should detect unordered list', () => {
            assert.strictEqual(detectLineType('- Item', false), 'unordered-list');
        });

        test('should detect ordered list', () => {
            assert.strictEqual(detectLineType('1. Item', false), 'ordered-list');
        });

        test('should detect task list', () => {
            assert.strictEqual(detectLineType('- [ ] Task', false), 'task-list');
        });

        test('should detect horizontal rule', () => {
            assert.strictEqual(detectLineType('---', false), 'horizontal-rule');
        });

        test('should detect code fence start', () => {
            assert.strictEqual(detectLineType('```javascript', false), 'code-fence-start');
        });

        test('should detect code fence end when in code block', () => {
            assert.strictEqual(detectLineType('```', true), 'code-fence-end');
        });

        test('should detect table row', () => {
            assert.strictEqual(detectLineType('| A | B |', false), 'table-row');
        });

        test('should detect empty line', () => {
            assert.strictEqual(detectLineType('', false), 'empty');
            assert.strictEqual(detectLineType('   ', false), 'empty');
        });

        test('should default to paragraph', () => {
            assert.strictEqual(detectLineType('Regular text', false), 'paragraph');
        });

        test('should treat lines inside code block as paragraph', () => {
            assert.strictEqual(detectLineType('# Not a heading', true), 'paragraph');
        });
    });

    suite('getLanguageDisplayName', () => {
        test('should return display name for known languages', () => {
            assert.strictEqual(getLanguageDisplayName('js'), 'JavaScript');
            assert.strictEqual(getLanguageDisplayName('javascript'), 'JavaScript');
            assert.strictEqual(getLanguageDisplayName('ts'), 'TypeScript');
            assert.strictEqual(getLanguageDisplayName('py'), 'Python');
            assert.strictEqual(getLanguageDisplayName('mermaid'), 'Mermaid Diagram');
        });

        test('should handle case insensitivity', () => {
            assert.strictEqual(getLanguageDisplayName('JAVASCRIPT'), 'JavaScript');
            assert.strictEqual(getLanguageDisplayName('Python'), 'Python');
        });

        test('should uppercase unknown languages', () => {
            assert.strictEqual(getLanguageDisplayName('unknownlang'), 'UNKNOWNLANG');
        });

        test('should handle empty string', () => {
            assert.strictEqual(getLanguageDisplayName(''), '');
        });
    });

    suite('Integration Tests', () => {
        test('should parse complex markdown document', () => {
            const content = `# Main Heading

This is a paragraph with **bold** and *italic* text.

## Code Examples

\`\`\`javascript
function hello() {
    console.log("Hello, World!");
}
\`\`\`

### List Items

- Item 1
- Item 2
  - Nested item

1. First
2. Second

### Tasks

- [ ] Unchecked
- [x] Checked

## Mermaid Diagram

\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[End]
    B -->|No| D[Loop]
    D --> B
\`\`\`

---

> Blockquote text

| Name | Value |
|------|-------|
| A    | 1     |
| B    | 2     |

Check [this link](https://example.com) for more info.`;

            // Test code blocks
            const codeBlocks = parseCodeBlocks(content);
            assert.strictEqual(codeBlocks.length, 2);
            assert.strictEqual(codeBlocks[0].language, 'javascript');
            assert.strictEqual(codeBlocks[1].language, 'mermaid');
            assert.strictEqual(codeBlocks[1].isMermaid, true);

            // Test mermaid detection
            assert.strictEqual(hasMermaidBlocks(content), true);

            // Test mermaid blocks
            const mermaidBlocks = parseMermaidBlocks(content);
            assert.strictEqual(mermaidBlocks.length, 1);
            assert.ok(mermaidBlocks[0].code.includes('graph TD'));

            // Test link extraction
            const lines = content.split('\n');
            const lastLine = lines[lines.length - 1];
            const links = extractLinks(lastLine);
            assert.strictEqual(links.length, 1);
            assert.strictEqual(links[0].url, 'https://example.com');
        });

        test('should handle edge cases in markdown', () => {
            // Empty content
            assert.strictEqual(parseCodeBlocks('').length, 0);
            assert.strictEqual(hasMermaidBlocks(''), false);

            // Only whitespace
            assert.strictEqual(parseCodeBlocks('   \n   \n   ').length, 0);

            // Unclosed code block
            const unclosed = '```javascript\nsome code';
            const blocks = parseCodeBlocks(unclosed);
            assert.strictEqual(blocks.length, 0); // Should not parse unclosed blocks

            // Nested markers
            const nested = '**bold with *italic* inside**';
            const emphasis = detectEmphasis(nested);
            assert.ok(emphasis.bold.length >= 1);
        });
    });
});
