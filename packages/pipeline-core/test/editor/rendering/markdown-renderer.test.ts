import { describe, it, expect } from 'vitest';
import {
    escapeHtml,
    generateAnchorId,
    applyMarkdownHighlighting,
    applyInlineMarkdown,
    applySourceModeHighlighting,
    applySourceModeInlineHighlighting,
    resolveImagePath,
    MarkdownLineResult
} from '../../../src/editor/rendering/markdown-renderer';

describe('escapeHtml', () => {
    it('escapes ampersands', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes angle brackets', () => {
        expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    it('escapes quotes', () => {
        expect(escapeHtml('"hello" & \'world\'')).toBe('&quot;hello&quot; &amp; &#039;world&#039;');
    });

    it('handles empty string', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('handles string with no special chars', () => {
        expect(escapeHtml('plain text')).toBe('plain text');
    });
});

describe('generateAnchorId', () => {
    it('converts to lowercase and replaces spaces', () => {
        expect(generateAnchorId('Hello World')).toBe('hello-world');
    });

    it('removes punctuation', () => {
        expect(generateAnchorId('What is this?')).toBe('what-is-this');
    });

    it('removes markdown formatting', () => {
        expect(generateAnchorId('**Bold** and *italic*')).toBe('bold-and-italic');
    });

    it('handles empty string', () => {
        expect(generateAnchorId('')).toBe('');
    });

    it('collapses multiple hyphens', () => {
        expect(generateAnchorId('a  --  b')).toBe('a-b');
    });

    it('removes leading/trailing hyphens', () => {
        expect(generateAnchorId('--hello--')).toBe('hello');
    });

    it('handles unicode characters', () => {
        expect(generateAnchorId('日本語テスト')).toBe('日本語テスト');
    });
});

describe('applyMarkdownHighlighting', () => {
    it('renders a heading', () => {
        const result = applyMarkdownHighlighting('# Title', 1, false, null);
        expect(result.html).toContain('md-h1');
        expect(result.html).toContain('Title');
        expect(result.inCodeBlock).toBe(false);
        expect(result.anchorId).toBe('title');
    });

    it('renders an h2 heading', () => {
        const result = applyMarkdownHighlighting('## Section', 1, false, null);
        expect(result.html).toContain('md-h2');
        expect(result.anchorId).toBe('section');
    });

    it('detects code fence start', () => {
        const result = applyMarkdownHighlighting('```typescript', 1, false, null);
        expect(result.inCodeBlock).toBe(true);
        expect(result.codeBlockLang).toBe('typescript');
        expect(result.isCodeFenceStart).toBe(true);
    });

    it('detects code fence end', () => {
        const result = applyMarkdownHighlighting('```', 1, true, 'typescript');
        expect(result.inCodeBlock).toBe(false);
        expect(result.codeBlockLang).toBeNull();
        expect(result.isCodeFenceEnd).toBe(true);
    });

    it('does not apply highlighting inside code blocks', () => {
        const result = applyMarkdownHighlighting('# Not a heading', 1, true, 'plaintext');
        expect(result.html).not.toContain('md-h1');
        expect(result.inCodeBlock).toBe(true);
    });

    it('renders blockquotes', () => {
        const result = applyMarkdownHighlighting('> quote text', 1, false, null);
        expect(result.html).toContain('md-blockquote');
    });

    it('renders unordered list items', () => {
        const result = applyMarkdownHighlighting('- list item', 1, false, null);
        expect(result.html).toContain('md-list-item');
        expect(result.html).toContain('md-list-marker');
    });

    it('renders ordered list items', () => {
        const result = applyMarkdownHighlighting('1. ordered', 1, false, null);
        expect(result.html).toContain('md-list-item');
    });

    it('renders horizontal rules', () => {
        const result = applyMarkdownHighlighting('---', 1, false, null);
        expect(result.html).toContain('md-hr');
    });

    it('renders bold text', () => {
        const result = applyMarkdownHighlighting('some **bold** text', 1, false, null);
        expect(result.html).toContain('md-bold');
    });

    it('renders checkboxes', () => {
        const result = applyMarkdownHighlighting('- [x] done', 1, false, null);
        expect(result.html).toContain('md-checkbox-checked');
    });

    it('strips \\r from Windows line endings', () => {
        const result = applyMarkdownHighlighting('hello\r', 1, false, null);
        expect(result.html).not.toContain('\r');
    });

    it('handles indented code fences', () => {
        const result = applyMarkdownHighlighting('  ```js', 1, false, null);
        expect(result.inCodeBlock).toBe(true);
        expect(result.codeBlockLang).toBe('js');
    });
});

describe('applyInlineMarkdown', () => {
    it('handles empty string', () => {
        expect(applyInlineMarkdown('')).toBe('');
    });

    it('renders inline code', () => {
        expect(applyInlineMarkdown('use `foo`')).toContain('md-inline-code');
    });

    it('renders links', () => {
        const html = applyInlineMarkdown('[text](http://example.com)');
        expect(html).toContain('md-link');
        expect(html).toContain('http://example.com');
    });

    it('renders images', () => {
        const html = applyInlineMarkdown('![alt](img.png)');
        expect(html).toContain('md-image-container');
    });

    it('renders bold', () => {
        expect(applyInlineMarkdown('**bold**')).toContain('md-bold');
    });

    it('renders italic', () => {
        expect(applyInlineMarkdown('*italic*')).toContain('md-italic');
    });

    it('renders strikethrough', () => {
        expect(applyInlineMarkdown('~~strike~~')).toContain('md-strike');
    });

    it('renders anchor links with data attribute', () => {
        const html = applyInlineMarkdown('[section](#my-section)');
        expect(html).toContain('md-anchor-link');
        expect(html).toContain('data-anchor="my-section"');
    });

    // File path detection
    describe('file path detection', () => {
        it('detects /Users absolute paths', () => {
            const html = applyInlineMarkdown('See /Users/john/project/src/main.ts');
            expect(html).toContain('file-path-link');
            expect(html).toContain('data-full-path="/Users/john/project/src/main.ts"');
        });

        it('detects /home absolute paths', () => {
            const html = applyInlineMarkdown('Check /home/dev/app/index.js');
            expect(html).toContain('file-path-link');
            expect(html).toContain('data-full-path="/home/dev/app/index.js"');
        });

        it('detects /tmp, /var, /etc, /opt paths', () => {
            expect(applyInlineMarkdown('/tmp/out.log')).toContain('file-path-link');
            expect(applyInlineMarkdown('/var/log/sys')).toContain('file-path-link');
            expect(applyInlineMarkdown('/etc/nginx.conf')).toContain('file-path-link');
            expect(applyInlineMarkdown('/opt/bin/node')).toContain('file-path-link');
        });

        it('shortens /Users/<user>/Documents/Projects/ paths', () => {
            const html = applyInlineMarkdown('/Users/john/Documents/Projects/myapp/src/index.ts');
            expect(html).toContain('>myapp/src/index.ts</span>');
        });

        it('shortens /Users/<user>/ to ~/', () => {
            const html = applyInlineMarkdown('/Users/john/Desktop/file.txt');
            expect(html).toContain('>~/Desktop/file.txt</span>');
        });

        it('shortens /home/<user>/ to ~/', () => {
            const html = applyInlineMarkdown('/home/john/projects/app.js');
            expect(html).toContain('>~/projects/app.js</span>');
        });

        it('does not match relative paths', () => {
            const html = applyInlineMarkdown('src/main.ts');
            expect(html).not.toContain('file-path-link');
        });

        it('does not match paths inside inline code', () => {
            const html = applyInlineMarkdown('Run `cat /Users/john/file.txt`');
            // inline code is processed first
            expect(html).toContain('md-inline-code');
        });

        it('handles multiple paths in one line', () => {
            const html = applyInlineMarkdown('/Users/a/f1.ts and /Users/b/f2.ts');
            const matches = html.match(/file-path-link/g);
            expect(matches).toHaveLength(2);
        });
    });

    // Windows file path detection
    describe('Windows file path detection', () => {
        it('detects backslash-separated Windows paths', () => {
            const html = applyInlineMarkdown('See D:\\projects\\file.ts');
            expect(html).toContain('file-path-link');
            expect(html).toContain('data-full-path="D:/projects/file.ts"');
        });

        it('detects forward-slash Windows paths with drive letter', () => {
            const html = applyInlineMarkdown('See D:/projects/file.ts');
            expect(html).toContain('file-path-link');
            expect(html).toContain('data-full-path="D:/projects/file.ts"');
        });

        it('detects mixed-separator Windows paths', () => {
            const html = applyInlineMarkdown('See D:\\projects\\shortcuts/.vscode/tasks/plan.md');
            expect(html).toContain('file-path-link');
            expect(html).toContain('data-full-path="D:/projects/shortcuts/.vscode/tasks/plan.md"');
        });

        it('shortens C:\\Users\\<user>\\ to ~/', () => {
            const html = applyInlineMarkdown('C:\\Users\\John\\Documents\\file.md');
            expect(html).toContain('file-path-link');
            expect(html).toContain('>~/Documents/file.md</span>');
        });

        it('shortens C:/Users/<user>/Documents/Projects/ prefix', () => {
            const html = applyInlineMarkdown('C:/Users/John/Documents/Projects/myapp/src/index.ts');
            expect(html).toContain('>myapp/src/index.ts</span>');
        });

        it('detects multiple Windows paths in one line', () => {
            const html = applyInlineMarkdown('Compare D:\\a\\f1.ts and C:\\b\\f2.ts');
            const matches = html.match(/file-path-link/g);
            expect(matches).toHaveLength(2);
        });

        it('does not match Windows paths inside inline code', () => {
            const html = applyInlineMarkdown('Run `cat D:\\projects\\file.ts`');
            expect(html).toContain('md-inline-code');
            // Path inside code should not get a separate file-path-link
            const pathLinks = html.match(/file-path-link/g);
            expect(pathLinks).toBeNull();
        });

        it('does not match bare drive letter without path', () => {
            const html = applyInlineMarkdown('Drive C: is full');
            expect(html).not.toContain('file-path-link');
        });

        it('handles lowercase drive letters', () => {
            const html = applyInlineMarkdown('See d:\\projects\\file.ts');
            expect(html).toContain('file-path-link');
            expect(html).toContain('data-full-path="d:/projects/file.ts"');
        });
    });
});

describe('applySourceModeHighlighting', () => {
    it('highlights headings', () => {
        const result = applySourceModeHighlighting('## Heading', false);
        expect(result.html).toContain('src-h2');
        expect(result.inCodeBlock).toBe(false);
    });

    it('toggles code block state on fence', () => {
        const result = applySourceModeHighlighting('```', false);
        expect(result.inCodeBlock).toBe(true);
        expect(result.html).toContain('src-code-fence');
    });

    it('returns plain text inside code block', () => {
        const result = applySourceModeHighlighting('let x = 1;', true);
        expect(result.html).toBe('let x = 1;');
        expect(result.inCodeBlock).toBe(true);
    });

    it('highlights blockquotes', () => {
        const result = applySourceModeHighlighting('> quote', false);
        expect(result.html).toContain('src-blockquote');
    });

    it('highlights unordered lists', () => {
        const result = applySourceModeHighlighting('- item', false);
        expect(result.html).toContain('src-list-marker');
    });

    it('highlights ordered lists', () => {
        const result = applySourceModeHighlighting('1. item', false);
        expect(result.html).toContain('src-list-marker');
    });
});

describe('applySourceModeInlineHighlighting', () => {
    it('handles empty string', () => {
        expect(applySourceModeInlineHighlighting('')).toBe('');
    });

    it('highlights inline code', () => {
        expect(applySourceModeInlineHighlighting('`code`')).toContain('src-inline-code');
    });

    it('highlights bold', () => {
        expect(applySourceModeInlineHighlighting('**bold**')).toContain('src-bold');
    });
});

describe('resolveImagePath', () => {
    it('returns absolute URLs unchanged', () => {
        expect(resolveImagePath('https://example.com/img.png')).toBe('https://example.com/img.png');
    });

    it('returns data URIs unchanged', () => {
        expect(resolveImagePath('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
    });

    it('prefixes relative paths with IMG_PATH:', () => {
        expect(resolveImagePath('./image.png')).toBe('IMG_PATH:./image.png');
    });
});
