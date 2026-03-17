import { describe, it, expect } from 'vitest';
import {
    CodeBlock,
    MarkdownHighlightResult,
    MarkdownLineType,
    ParsedTable,
    parseCodeBlocks,
    hasMermaidBlocks,
    parseMermaidBlocks,
    detectHeadingLevel,
    isBlockquote,
    isUnorderedListItem,
    isOrderedListItem,
    isHorizontalRule,
    isTaskListItem,
    isCodeFenceStart,
    isCodeFenceEnd,
    detectLineType,
    detectEmphasis,
    extractLinks,
    extractInlineCode,
    extractImages,
    isExternalImageUrl,
    isDataUrl,
    parseTableRow,
    parseTableAlignments,
    isTableSeparator,
    isTableRow,
    parseTable,
    parseTables,
    getLanguageDisplayName,
} from '../../../src/editor/parsing/markdown-parser';

// Also verify they're accessible through the barrel
import { generateAnchorId } from '../../../src/editor/parsing/markdown-parser';

// ─── parseCodeBlocks ─────────────────────────────────────────────────

describe('parseCodeBlocks', () => {
    it('parses a single code block', () => {
        const content = 'before\n```js\nconst x = 1;\n```\nafter';
        const blocks = parseCodeBlocks(content);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].language).toBe('js');
        expect(blocks[0].code).toBe('const x = 1;');
        expect(blocks[0].startLine).toBe(2);
        expect(blocks[0].endLine).toBe(4);
        expect(blocks[0].id).toBe('codeblock-2');
        expect(blocks[0].isMermaid).toBe(false);
    });

    it('parses multiple code blocks', () => {
        const content = '```python\nprint("hi")\n```\ntext\n```rust\nfn main() {}\n```';
        const blocks = parseCodeBlocks(content);

        expect(blocks).toHaveLength(2);
        expect(blocks[0].language).toBe('python');
        expect(blocks[1].language).toBe('rust');
    });

    it('detects language as plaintext when not specified', () => {
        const content = '```\nhello\n```';
        const blocks = parseCodeBlocks(content);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].language).toBe('plaintext');
    });

    it('detects mermaid blocks', () => {
        const content = '```mermaid\ngraph TD;\n  A-->B;\n```';
        const blocks = parseCodeBlocks(content);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].isMermaid).toBe(true);
        expect(blocks[0].language).toBe('mermaid');
    });

    it('handles indented code fences', () => {
        const content = '  ```js\n  const x = 1;\n  ```';
        const blocks = parseCodeBlocks(content);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].language).toBe('js');
    });

    it('does not treat info-string fences as closing fences', () => {
        const content = [
            '```',
            '# Prompt Example',
            '```markdown',
            '{documentContent}',
            '```',
            '```',
        ].join('\n');
        const blocks = parseCodeBlocks(content);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].language).toBe('plaintext');
        expect(blocks[0].code).toContain('```markdown');
        expect(blocks[0].code).toContain('{documentContent}');
        expect(blocks[0].code).toContain('```');
    });

    it('supports longer outer fences that contain triple backticks', () => {
        const content = [
            '````markdown',
            'Outer block',
            '```ts',
            'const x = 1;',
            '```',
            '````',
        ].join('\n');
        const blocks = parseCodeBlocks(content);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].language).toBe('markdown');
        expect(blocks[0].code).toContain('```ts');
        expect(blocks[0].code).toContain('const x = 1;');
        expect(blocks[0].code).toContain('```');
    });

    it('normalizes CRLF line endings', () => {
        const content = '```js\r\nconst x = 1;\r\n```';
        const blocks = parseCodeBlocks(content);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].code).toBe('const x = 1;');
    });

    it('handles unclosed code blocks gracefully', () => {
        const content = '```js\nconst x = 1;\nno closing fence';
        const blocks = parseCodeBlocks(content);

        expect(blocks).toHaveLength(0);
    });

    it('returns empty array for content without code blocks', () => {
        expect(parseCodeBlocks('just text')).toHaveLength(0);
        expect(parseCodeBlocks('')).toHaveLength(0);
    });
});

// ─── hasMermaidBlocks / parseMermaidBlocks ────────────────────────────

describe('hasMermaidBlocks', () => {
    it('returns true when mermaid block exists', () => {
        expect(hasMermaidBlocks('```mermaid\ngraph TD;\n```')).toBe(true);
    });

    it('returns false when no mermaid block', () => {
        expect(hasMermaidBlocks('```js\ncode\n```')).toBe(false);
        expect(hasMermaidBlocks('plain text')).toBe(false);
    });
});

describe('parseMermaidBlocks', () => {
    it('returns only mermaid blocks', () => {
        const content = '```js\ncode\n```\n```mermaid\ngraph TD;\n```';
        const mermaid = parseMermaidBlocks(content);

        expect(mermaid).toHaveLength(1);
        expect(mermaid[0].isMermaid).toBe(true);
    });
});

// ─── detectHeadingLevel ──────────────────────────────────────────────

describe('detectHeadingLevel', () => {
    it('detects heading levels 1–6', () => {
        expect(detectHeadingLevel('# Heading')).toBe(1);
        expect(detectHeadingLevel('## Heading')).toBe(2);
        expect(detectHeadingLevel('### Heading')).toBe(3);
        expect(detectHeadingLevel('#### Heading')).toBe(4);
        expect(detectHeadingLevel('##### Heading')).toBe(5);
        expect(detectHeadingLevel('###### Heading')).toBe(6);
    });

    it('returns 0 for non-headings', () => {
        expect(detectHeadingLevel('not a heading')).toBe(0);
        expect(detectHeadingLevel('####### too many')).toBe(0);
        expect(detectHeadingLevel('#NoSpace')).toBe(0);
    });
});

// ─── Line type booleans ──────────────────────────────────────────────

describe('isBlockquote', () => {
    it('detects blockquotes', () => {
        expect(isBlockquote('> quote')).toBe(true);
        expect(isBlockquote('>quote')).toBe(true); // regex allows zero or more spaces after >
        expect(isBlockquote('not a quote')).toBe(false);
    });
});

describe('isUnorderedListItem', () => {
    it('detects list items with -, *, +', () => {
        expect(isUnorderedListItem('- item')).toBe(true);
        expect(isUnorderedListItem('* item')).toBe(true);
        expect(isUnorderedListItem('+ item')).toBe(true);
        expect(isUnorderedListItem('  - indented')).toBe(true);
        expect(isUnorderedListItem('not a list')).toBe(false);
    });
});

describe('isOrderedListItem', () => {
    it('detects ordered list items', () => {
        expect(isOrderedListItem('1. item')).toBe(true);
        expect(isOrderedListItem('42. item')).toBe(true);
        expect(isOrderedListItem('  3. indented')).toBe(true);
        expect(isOrderedListItem('not a list')).toBe(false);
    });
});

describe('isHorizontalRule', () => {
    it('detects horizontal rules', () => {
        expect(isHorizontalRule('---')).toBe(true);
        expect(isHorizontalRule('***')).toBe(true);
        expect(isHorizontalRule('___')).toBe(true);
        expect(isHorizontalRule('----')).toBe(true);
        expect(isHorizontalRule('not a rule')).toBe(false);
    });
});

describe('isTaskListItem', () => {
    it('detects unchecked task items', () => {
        const result = isTaskListItem('- [ ] task');
        expect(result.isTask).toBe(true);
        expect(result.checked).toBe(false);
    });

    it('detects checked task items', () => {
        const result = isTaskListItem('- [x] done');
        expect(result.isTask).toBe(true);
        expect(result.checked).toBe(true);
    });

    it('handles uppercase X', () => {
        const result = isTaskListItem('- [X] done');
        expect(result.isTask).toBe(true);
        expect(result.checked).toBe(true);
    });

    it('returns false for non-task lines', () => {
        expect(isTaskListItem('not a task').isTask).toBe(false);
    });
});

// ─── Code fence detection ────────────────────────────────────────────

describe('isCodeFenceStart', () => {
    it('detects backtick fences with language', () => {
        const result = isCodeFenceStart('```typescript');
        expect(result.isFence).toBe(true);
        expect(result.language).toBe('typescript');
    });

    it('detects bare backtick fences', () => {
        const result = isCodeFenceStart('```');
        expect(result.isFence).toBe(true);
        expect(result.language).toBe('plaintext');
    });

    it('detects indented fences', () => {
        expect(isCodeFenceStart('  ```js').isFence).toBe(true);
    });

    it('rejects non-fence lines', () => {
        expect(isCodeFenceStart('not a fence').isFence).toBe(false);
    });
});

describe('isCodeFenceEnd', () => {
    it('detects closing fences', () => {
        expect(isCodeFenceEnd('```')).toBe(true);
        expect(isCodeFenceEnd('  ```')).toBe(true);
    });

    it('rejects non-closing lines', () => {
        expect(isCodeFenceEnd('```js')).toBe(false);
        expect(isCodeFenceEnd('text')).toBe(false);
    });
});

// ─── detectEmphasis ──────────────────────────────────────────────────

describe('detectEmphasis', () => {
    it('detects bold', () => {
        const result = detectEmphasis('**bold** text');
        expect(result.bold).toHaveLength(1);
        expect(result.bold[0].text).toBe('bold');
    });

    it('detects italic', () => {
        const result = detectEmphasis('*italic* text');
        expect(result.italic).toHaveLength(1);
        expect(result.italic[0].text).toBe('italic');
    });

    it('detects strikethrough', () => {
        const result = detectEmphasis('~~struck~~ text');
        expect(result.strikethrough).toHaveLength(1);
        expect(result.strikethrough[0].text).toBe('struck');
    });

    it('returns empty arrays for plain text', () => {
        const result = detectEmphasis('no emphasis');
        expect(result.bold).toHaveLength(0);
        expect(result.italic).toHaveLength(0);
        expect(result.strikethrough).toHaveLength(0);
    });
});

// ─── extractLinks / extractInlineCode / extractImages ────────────────

describe('extractLinks', () => {
    it('extracts markdown links', () => {
        const links = extractLinks('See [example](https://example.com) and [other](./other.md).');
        expect(links).toHaveLength(2);
        expect(links[0].text).toBe('example');
        expect(links[0].url).toBe('https://example.com');
        expect(links[1].text).toBe('other');
        expect(links[1].url).toBe('./other.md');
    });

    it('returns empty for no links', () => {
        expect(extractLinks('no links here')).toHaveLength(0);
    });
});

describe('extractInlineCode', () => {
    it('extracts inline code spans', () => {
        const spans = extractInlineCode('Use `foo()` and `bar()`.');
        expect(spans).toHaveLength(2);
        expect(spans[0].code).toBe('foo()');
        expect(spans[1].code).toBe('bar()');
    });
});

describe('extractImages', () => {
    it('extracts images', () => {
        const images = extractImages('![alt](image.png)');
        expect(images).toHaveLength(1);
        expect(images[0].alt).toBe('alt');
        expect(images[0].url).toBe('image.png');
    });

    it('extracts images with empty alt', () => {
        const images = extractImages('![](pic.jpg)');
        expect(images).toHaveLength(1);
        expect(images[0].alt).toBe('');
    });
});

describe('isExternalImageUrl', () => {
    it('detects http/https URLs', () => {
        expect(isExternalImageUrl('https://example.com/img.png')).toBe(true);
        expect(isExternalImageUrl('http://example.com/img.png')).toBe(true);
    });

    it('rejects non-external URLs', () => {
        expect(isExternalImageUrl('./local.png')).toBe(false);
        expect(isExternalImageUrl('data:image/png;base64,...')).toBe(false);
    });
});

describe('isDataUrl', () => {
    it('detects data URLs', () => {
        expect(isDataUrl('data:image/png;base64,abc')).toBe(true);
    });

    it('rejects non-data URLs', () => {
        expect(isDataUrl('https://example.com')).toBe(false);
    });
});

// ─── Table parsing ───────────────────────────────────────────────────

describe('parseTableRow', () => {
    it('splits row into cells', () => {
        expect(parseTableRow('| A | B | C |')).toEqual(['A', 'B', 'C']);
    });

    it('handles rows without leading/trailing pipes', () => {
        expect(parseTableRow('A | B | C')).toEqual(['A', 'B', 'C']);
    });
});

describe('parseTableAlignments', () => {
    it('detects left, center, right', () => {
        expect(parseTableAlignments('| --- | :---: | ---: |')).toEqual(['left', 'center', 'right']);
    });

    it('defaults to left', () => {
        expect(parseTableAlignments('| --- | --- |')).toEqual(['left', 'left']);
    });
});

describe('isTableSeparator', () => {
    it('detects separator lines', () => {
        expect(isTableSeparator('| --- | --- |')).toBe(true);
        expect(isTableSeparator('| :---: | ---: |')).toBe(true);
        expect(isTableSeparator('--- | ---')).toBe(true);
    });

    it('rejects non-separator lines', () => {
        expect(isTableSeparator('just text')).toBe(false);
    });
});

describe('isTableRow', () => {
    it('returns true for lines with pipes', () => {
        expect(isTableRow('| A | B |')).toBe(true);
    });

    it('returns false for lines without pipes', () => {
        expect(isTableRow('no pipes')).toBe(false);
    });
});

describe('parseTable', () => {
    it('parses a complete table', () => {
        const lines = [
            '| Name | Age |',
            '| --- | --- |',
            '| Alice | 30 |',
            '| Bob | 25 |',
        ];
        const result = parseTable(lines, 0);

        expect(result).not.toBeNull();
        expect(result!.headers).toEqual(['Name', 'Age']);
        expect(result!.rows).toHaveLength(2);
        expect(result!.rows[0]).toEqual(['Alice', '30']);
        expect(result!.rows[1]).toEqual(['Bob', '25']);
        expect(result!.alignments).toEqual(['left', 'left']);
    });

    it('parses with alignment markers', () => {
        const lines = [
            '| Left | Center | Right |',
            '| :--- | :---: | ---: |',
            '| a | b | c |',
        ];
        const result = parseTable(lines, 0);

        expect(result).not.toBeNull();
        expect(result!.alignments).toEqual(['left', 'center', 'right']);
    });

    it('returns null for invalid table', () => {
        expect(parseTable(['no table'], 0)).toBeNull();
        expect(parseTable([], 0)).toBeNull();
    });

    it('returns null when separator is missing', () => {
        const lines = [
            '| A | B |',
            '| C | D |',
        ];
        expect(parseTable(lines, 0)).toBeNull();
    });
});

describe('parseTables', () => {
    it('finds all tables in content', () => {
        const content = [
            '# Title',
            '',
            '| H1 | H2 |',
            '| --- | --- |',
            '| A | B |',
            '',
            'Some text',
            '',
            '| X | Y |',
            '| --- | --- |',
            '| 1 | 2 |',
            '| 3 | 4 |',
        ].join('\n');

        const tables = parseTables(content);
        expect(tables).toHaveLength(2);
        expect(tables[0].headers).toEqual(['H1', 'H2']);
        expect(tables[0].rows).toHaveLength(1);
        expect(tables[1].headers).toEqual(['X', 'Y']);
        expect(tables[1].rows).toHaveLength(2);
    });

    it('returns empty array when no tables', () => {
        expect(parseTables('just text')).toHaveLength(0);
    });

    it('handles CRLF line endings', () => {
        const content = '| A | B |\r\n| --- | --- |\r\n| 1 | 2 |';
        const tables = parseTables(content);
        expect(tables).toHaveLength(1);
        expect(tables[0].rows[0]).toEqual(['1', '2']);
    });

    it('assigns correct 1-based line numbers', () => {
        const content = 'line1\n| H |\n| --- |\n| V |';
        const tables = parseTables(content);
        expect(tables).toHaveLength(1);
        expect(tables[0].startLine).toBe(2); // 1-based
        expect(tables[0].id).toBe('table-2');
    });
});

// ─── detectLineType ──────────────────────────────────────────────────

describe('detectLineType', () => {
    it('detects all line types outside code blocks', () => {
        expect(detectLineType('# Heading', false)).toBe('heading');
        expect(detectLineType('> quote', false)).toBe('blockquote');
        expect(detectLineType('- item', false)).toBe('unordered-list');
        expect(detectLineType('1. item', false)).toBe('ordered-list');
        expect(detectLineType('- [x] task', false)).toBe('task-list');
        expect(detectLineType('---', false)).toBe('horizontal-rule');
        expect(detectLineType('```js', false)).toBe('code-fence-start');
        expect(detectLineType('| cell |', false)).toBe('table-row');
        expect(detectLineType('text', false)).toBe('paragraph');
        expect(detectLineType('', false)).toBe('empty');
    });

    it('returns code-fence-end inside code blocks', () => {
        expect(detectLineType('```', true)).toBe('code-fence-end');
    });

    it('returns paragraph for non-fence lines inside code blocks', () => {
        expect(detectLineType('# heading inside code', true)).toBe('paragraph');
        expect(detectLineType('- list inside code', true)).toBe('paragraph');
    });
});

// ─── getLanguageDisplayName ──────────────────────────────────────────

describe('getLanguageDisplayName', () => {
    it('returns known display names', () => {
        expect(getLanguageDisplayName('js')).toBe('JavaScript');
        expect(getLanguageDisplayName('typescript')).toBe('TypeScript');
        expect(getLanguageDisplayName('python')).toBe('Python');
        expect(getLanguageDisplayName('mermaid')).toBe('Mermaid Diagram');
    });

    it('returns uppercased name for unknown languages', () => {
        expect(getLanguageDisplayName('xyz')).toBe('XYZ');
    });

    it('is case-insensitive', () => {
        expect(getLanguageDisplayName('JavaScript')).toBe('JavaScript');
        expect(getLanguageDisplayName('PYTHON')).toBe('Python');
    });
});

// ─── generateAnchorId ────────────────────────────────────────────────

describe('generateAnchorId', () => {
    it('converts heading text to anchor', () => {
        expect(generateAnchorId('Hello World')).toBe('hello-world');
    });

    it('removes markdown formatting', () => {
        expect(generateAnchorId('**bold** and *italic*')).toBe('bold-and-italic');
    });

    it('collapses hyphens', () => {
        expect(generateAnchorId('a - b - c')).toBe('a-b-c');
    });

    it('returns empty string for empty input', () => {
        expect(generateAnchorId('')).toBe('');
    });

    it('handles unicode text', () => {
        const result = generateAnchorId('日本語テスト');
        expect(result).toBe('日本語テスト');
    });
});
