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
    extractImages,
    extractInlineCode,
    extractLinks,
    generateAnchorId,
    getLanguageDisplayName,
    hasMermaidBlocks,
    isBlockquote,
    isCodeFenceEnd,
    isCodeFenceStart,
    isDataUrl,
    isExternalImageUrl,
    isHorizontalRule,
    isOrderedListItem,
    isTableRow,
    isTableSeparator,
    isTaskListItem,
    isUnorderedListItem,
    parseCodeBlocks,
    parseMermaidBlocks,
    parseTable,
    parseTableAlignments,
    parseTableRow
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

        test('should parse code block with leading spaces (1-3)', () => {
            const content1 = `Some text
 \`\`\`rust
fn main() {}
 \`\`\`
More text`;

            const blocks1 = parseCodeBlocks(content1);
            assert.strictEqual(blocks1.length, 1);
            assert.strictEqual(blocks1[0].language, 'rust');
            assert.strictEqual(blocks1[0].code, 'fn main() {}');

            const content2 = `Some text
  \`\`\`python
print("hello")
  \`\`\``;

            const blocks2 = parseCodeBlocks(content2);
            assert.strictEqual(blocks2.length, 1);
            assert.strictEqual(blocks2[0].language, 'python');

            const content3 = `Some text
   \`\`\`cpp
int x = 0;
   \`\`\``;

            const blocks3 = parseCodeBlocks(content3);
            assert.strictEqual(blocks3.length, 1);
            assert.strictEqual(blocks3[0].language, 'cpp');
        });

        test('should parse code block with deep indentation (4+ spaces)', () => {
            // Non-standard markdown, but we're lenient to support various document styles
            const content1 = `Some text
    \`\`\`rust
fn main() {}
    \`\`\`
More text`;

            const blocks1 = parseCodeBlocks(content1);
            assert.strictEqual(blocks1.length, 1);
            assert.strictEqual(blocks1[0].language, 'rust');
            assert.strictEqual(blocks1[0].code, 'fn main() {}');

            const content2 = `Some text
        \`\`\`python
print("hello")
        \`\`\``;

            const blocks2 = parseCodeBlocks(content2);
            assert.strictEqual(blocks2.length, 1);
            assert.strictEqual(blocks2[0].language, 'python');
        });

        test('should parse code block with leading tab', () => {
            const content = `Some text
\t\`\`\`typescript
const x: number = 42;
\t\`\`\`
More text`;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].language, 'typescript');
            assert.strictEqual(blocks[0].code, 'const x: number = 42;');
        });

        test('should parse code block with mixed indented opening and closing fences', () => {
            const content = `Some text
  \`\`\`go
func main() {}
\t\`\`\`
More text`;

            const blocks = parseCodeBlocks(content);
            assert.strictEqual(blocks.length, 1);
            assert.strictEqual(blocks[0].language, 'go');
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

        test('should detect code fence with leading spaces (1-3)', () => {
            const result1 = isCodeFenceStart(' ```rust');
            assert.strictEqual(result1.isFence, true);
            assert.strictEqual(result1.language, 'rust');

            const result2 = isCodeFenceStart('  ```python');
            assert.strictEqual(result2.isFence, true);
            assert.strictEqual(result2.language, 'python');

            const result3 = isCodeFenceStart('   ```cpp');
            assert.strictEqual(result3.isFence, true);
            assert.strictEqual(result3.language, 'cpp');
        });

        test('should detect code fence with leading tab', () => {
            const result = isCodeFenceStart('\t```typescript');
            assert.strictEqual(result.isFence, true);
            assert.strictEqual(result.language, 'typescript');
        });

        test('should detect code fence with deep indentation (4+ spaces)', () => {
            const result1 = isCodeFenceStart('    ```rust');
            assert.strictEqual(result1.isFence, true);
            assert.strictEqual(result1.language, 'rust');

            const result2 = isCodeFenceStart('        ```python');
            assert.strictEqual(result2.isFence, true);
            assert.strictEqual(result2.language, 'python');
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

        test('should detect code fence end with leading spaces (1-3)', () => {
            assert.strictEqual(isCodeFenceEnd(' ```'), true);
            assert.strictEqual(isCodeFenceEnd('  ```'), true);
            assert.strictEqual(isCodeFenceEnd('   ```'), true);
        });

        test('should detect code fence end with leading tab', () => {
            assert.strictEqual(isCodeFenceEnd('\t```'), true);
        });

        test('should detect code fence end with leading whitespace and trailing whitespace', () => {
            assert.strictEqual(isCodeFenceEnd('  ```  '), true);
            assert.strictEqual(isCodeFenceEnd('\t```  '), true);
        });

        test('should detect code fence end with deep indentation (4+ spaces)', () => {
            assert.strictEqual(isCodeFenceEnd('    ```'), true);
            assert.strictEqual(isCodeFenceEnd('        ```'), true);
            assert.strictEqual(isCodeFenceEnd('    ```  '), true);
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

    suite('parseTableRow', () => {
        test('should parse simple row', () => {
            const row = parseTableRow('| A | B | C |');
            assert.deepStrictEqual(row, ['A', 'B', 'C']);
        });

        test('should handle no leading pipe', () => {
            const row = parseTableRow('A | B | C |');
            assert.deepStrictEqual(row, ['A', 'B', 'C']);
        });

        test('should trim whitespace', () => {
            const row = parseTableRow('|  A  |  B  |  C  |');
            assert.deepStrictEqual(row, ['A', 'B', 'C']);
        });

        test('should handle empty cells', () => {
            const row = parseTableRow('| A |  | C |');
            assert.deepStrictEqual(row, ['A', '', 'C']);
        });
    });

    suite('parseTableAlignments', () => {
        test('should detect left alignment (default)', () => {
            const alignments = parseTableAlignments('|---|---|---|');
            assert.deepStrictEqual(alignments, ['left', 'left', 'left']);
        });

        test('should detect center alignment', () => {
            const alignments = parseTableAlignments('|:---:|:---:|');
            assert.deepStrictEqual(alignments, ['center', 'center']);
        });

        test('should detect right alignment', () => {
            const alignments = parseTableAlignments('|---:|---:|');
            assert.deepStrictEqual(alignments, ['right', 'right']);
        });

        test('should detect mixed alignments', () => {
            const alignments = parseTableAlignments('|---|:---:|---:|');
            assert.deepStrictEqual(alignments, ['left', 'center', 'right']);
        });

        test('should handle left colon only as left', () => {
            const alignments = parseTableAlignments('|:---|');
            assert.deepStrictEqual(alignments, ['left']);
        });
    });

    suite('isTableSeparator', () => {
        test('should detect basic separator', () => {
            assert.strictEqual(isTableSeparator('|---|---|'), true);
        });

        test('should detect separator with colons', () => {
            assert.strictEqual(isTableSeparator('|:---:|---:|'), true);
        });

        test('should detect separator with spaces', () => {
            assert.strictEqual(isTableSeparator('| --- | --- |'), true);
        });

        test('should return false for non-separator', () => {
            assert.strictEqual(isTableSeparator('| A | B |'), false);
        });
    });

    suite('isTableRow', () => {
        test('should detect table row', () => {
            assert.strictEqual(isTableRow('| A | B |'), true);
        });

        test('should return false for non-table row', () => {
            assert.strictEqual(isTableRow('No pipe here'), false);
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
            assert.deepStrictEqual(result.alignments, ['left', 'left']);
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

        test('should parse table with alignments', () => {
            const lines = [
                '| Left | Center | Right |',
                '|:-----|:------:|------:|',
                '| A    | B      | C     |'
            ];

            const result = parseTable(lines, 0);
            assert.ok(result);
            assert.deepStrictEqual(result.alignments, ['left', 'center', 'right']);
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

        test('should handle table starting at different index', () => {
            const lines = [
                'Some text',
                '',
                '| A | B |',
                '|---|---|',
                '| 1 | 2 |'
            ];

            const result = parseTable(lines, 2);
            assert.ok(result);
            assert.deepStrictEqual(result.headers, ['A', 'B']);
        });
    });

    suite('extractImages', () => {
        test('should extract single image', () => {
            const images = extractImages('![Alt text](image.png)');
            assert.strictEqual(images.length, 1);
            assert.strictEqual(images[0].alt, 'Alt text');
            assert.strictEqual(images[0].url, 'image.png');
        });

        test('should extract multiple images', () => {
            const images = extractImages('![A](a.png) text ![B](b.jpg)');
            assert.strictEqual(images.length, 2);
            assert.strictEqual(images[0].alt, 'A');
            assert.strictEqual(images[1].alt, 'B');
        });

        test('should handle empty alt text', () => {
            const images = extractImages('![](image.png)');
            assert.strictEqual(images.length, 1);
            assert.strictEqual(images[0].alt, '');
        });

        test('should return empty array for no images', () => {
            const images = extractImages('No images here');
            assert.strictEqual(images.length, 0);
        });

        test('should include position information', () => {
            const images = extractImages('![Alt](img.png)');
            assert.strictEqual(images[0].start, 0);
            assert.strictEqual(images[0].end, 15);
        });

        test('should handle URL with query params', () => {
            const images = extractImages('![Alt](image.png?v=1)');
            assert.strictEqual(images[0].url, 'image.png?v=1');
        });
    });

    suite('isExternalImageUrl', () => {
        test('should detect http URL', () => {
            assert.strictEqual(isExternalImageUrl('http://example.com/image.png'), true);
        });

        test('should detect https URL', () => {
            assert.strictEqual(isExternalImageUrl('https://example.com/image.png'), true);
        });

        test('should handle case insensitivity', () => {
            assert.strictEqual(isExternalImageUrl('HTTP://example.com/image.png'), true);
            assert.strictEqual(isExternalImageUrl('HTTPS://example.com/image.png'), true);
        });

        test('should return false for relative path', () => {
            assert.strictEqual(isExternalImageUrl('./images/photo.png'), false);
        });

        test('should return false for absolute path', () => {
            assert.strictEqual(isExternalImageUrl('/images/photo.png'), false);
        });
    });

    suite('isDataUrl', () => {
        test('should detect data URL', () => {
            assert.strictEqual(isDataUrl('data:image/png;base64,ABC123'), true);
        });

        test('should handle case insensitivity', () => {
            assert.strictEqual(isDataUrl('DATA:image/png;base64,ABC'), true);
        });

        test('should return false for http URL', () => {
            assert.strictEqual(isDataUrl('https://example.com/image.png'), false);
        });

        test('should return false for file path', () => {
            assert.strictEqual(isDataUrl('./image.png'), false);
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

            // Simple bold (not nested - nested emphasis not supported by current parser)
            const simpleBold = '**bold text here**';
            const emphasis = detectEmphasis(simpleBold);
            assert.ok(emphasis.bold.length >= 1, 'Should detect simple bold text');
        });
    });

    suite('generateAnchorId', () => {
        test('should generate simple anchor from heading', () => {
            assert.strictEqual(generateAnchorId('Getting Started'), 'getting-started');
        });

        test('should handle heading with numbers', () => {
            assert.strictEqual(generateAnchorId('Step 1 Configuration'), 'step-1-configuration');
        });

        test('should remove punctuation', () => {
            assert.strictEqual(generateAnchorId('Hello, World!'), 'hello-world');
            assert.strictEqual(generateAnchorId('What\'s New?'), 'whats-new');
            assert.strictEqual(generateAnchorId('Section (Beta)'), 'section-beta');
        });

        test('should handle markdown formatting markers', () => {
            assert.strictEqual(generateAnchorId('**Bold** Heading'), 'bold-heading');
            assert.strictEqual(generateAnchorId('*Italic* Text'), 'italic-text');
            assert.strictEqual(generateAnchorId('`Code` Example'), 'code-example');
            assert.strictEqual(generateAnchorId('~~Strikethrough~~ Text'), 'strikethrough-text');
        });

        test('should collapse multiple spaces and hyphens', () => {
            assert.strictEqual(generateAnchorId('Multiple   Spaces'), 'multiple-spaces');
            assert.strictEqual(generateAnchorId('Hyphen---Test'), 'hyphen-test');
            assert.strictEqual(generateAnchorId('Mixed - - Separators'), 'mixed-separators');
        });

        test('should remove leading and trailing hyphens', () => {
            assert.strictEqual(generateAnchorId('- Leading Hyphen'), 'leading-hyphen');
            assert.strictEqual(generateAnchorId('Trailing Hyphen -'), 'trailing-hyphen');
            assert.strictEqual(generateAnchorId('- Both Ends -'), 'both-ends');
        });

        test('should handle empty and whitespace-only strings', () => {
            assert.strictEqual(generateAnchorId(''), '');
            assert.strictEqual(generateAnchorId('   '), '');
        });

        test('should handle unicode characters (cross-platform)', () => {
            // German umlauts
            assert.strictEqual(generateAnchorId('Über uns'), 'über-uns');
            // French accents
            assert.strictEqual(generateAnchorId('Café Menu'), 'café-menu');
            // Spanish
            assert.strictEqual(generateAnchorId('Información'), 'información');
            // Japanese (hiragana and katakana are preserved)
            assert.strictEqual(generateAnchorId('こんにちは World'), 'こんにちは-world');
            // Chinese
            assert.strictEqual(generateAnchorId('中文 Section'), '中文-section');
        });

        test('should work consistently across platforms (Windows/Mac/Linux)', () => {
            // Test various special characters that might behave differently
            const testCases = [
                { input: 'Path\\Like\\Windows', expected: 'pathlikewindows' },
                { input: 'Path/Like/Unix', expected: 'pathlikeunix' },
                { input: 'Line\nBreak', expected: 'line-break' },
                { input: 'Tab\tCharacter', expected: 'tab-character' },
                { input: 'Carriage\rReturn', expected: 'carriage-return' },
            ];

            for (const { input, expected } of testCases) {
                assert.strictEqual(generateAnchorId(input), expected, `Failed for input: ${JSON.stringify(input)}`);
            }
        });

        test('should handle real-world ToC examples', () => {
            // Common heading patterns from documentation
            assert.strictEqual(generateAnchorId('Table of Contents'), 'table-of-contents');
            assert.strictEqual(generateAnchorId('API Reference'), 'api-reference');
            assert.strictEqual(generateAnchorId('1. Introduction'), '1-introduction');
            assert.strictEqual(generateAnchorId('2.1 Sub-section'), '21-sub-section');
            assert.strictEqual(generateAnchorId('Q&A / FAQ'), 'qa-faq');
            assert.strictEqual(generateAnchorId('v1.0.0 Release Notes'), 'v100-release-notes');
        });
    });
});
