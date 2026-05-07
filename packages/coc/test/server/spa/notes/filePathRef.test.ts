/**
 * Tests for file-path reference features:
 * - marked extension (markdown → HTML)
 * - turndown rule (HTML → markdown)
 * - round-trip fidelity
 * - filePathNodeExtension (paste regex, label helper)
 */

import { describe, it, expect } from 'vitest';
import {
    markdownToHtml,
    htmlToMarkdown,
} from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';
import {
    FILE_PATH_PASTE_RE,
    filePathLabel,
} from '../../../../src/server/spa/client/react/features/notes/editor/filePathNodeExtension';

// ─── marked extension: markdown → HTML ──────────────────────────────────────

describe('file path references — markdownToHtml', () => {
    it('converts a simple file path to a file-ref-link span', () => {
        const html = markdownToHtml('See tasks/coc/foo.plan.md for details');
        expect(html).toContain('class="file-ref-link"');
        expect(html).toContain('data-file-path="tasks/coc/foo.plan.md"');
        expect(html).toContain('>tasks/coc/foo.plan.md<');
    });

    it('converts TypeScript file path', () => {
        const html = markdownToHtml('Edit src/server/handler.ts');
        expect(html).toContain('data-file-path="src/server/handler.ts"');
    });

    it('converts JSON file path', () => {
        const html = markdownToHtml('Check package/config.json');
        expect(html).toContain('data-file-path="package/config.json"');
    });

    it('converts YAML file path', () => {
        const html = markdownToHtml('Open .github/workflows/ci.yaml');
        expect(html).toContain('data-file-path=".github/workflows/ci.yaml"');
    });

    it('converts deeply nested path', () => {
        const html = markdownToHtml('See packages/forge/src/ai/service.ts');
        expect(html).toContain('data-file-path="packages/forge/src/ai/service.ts"');
    });

    it('handles multiple file paths in one line', () => {
        const html = markdownToHtml('Compare src/a.ts and src/b.ts');
        const matches = html.match(/class="file-ref-link"/g);
        expect(matches).toHaveLength(2);
    });

    it('handles file path mixed with other content', () => {
        const html = markdownToHtml('Before **bold** src/main.ts after');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('class="file-ref-link"');
    });

    it('does not match a single filename without directory', () => {
        const html = markdownToHtml('Open readme.md please');
        expect(html).not.toContain('file-ref-link');
    });

    it('does not match paths inside code spans', () => {
        const html = markdownToHtml('Run `src/main.ts` to start');
        // In code spans, marked wraps in <code>, so the tokenizer shouldn't fire
        // The path inside backticks is rendered as code, not as a file-ref-link
        expect(html).toContain('<code>');
    });
});

// ─── turndown rule: HTML → markdown ─────────────────────────────────────────

describe('file path references — htmlToMarkdown', () => {
    it('converts file-ref-link span back to plain path text', () => {
        const html = '<p>See <span class="file-ref-link" data-file-path="tasks/coc/foo.plan.md">tasks/coc/foo.plan.md</span></p>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('tasks/coc/foo.plan.md');
        expect(md).not.toContain('<span');
        expect(md).not.toContain('file-ref-link');
    });

    it('strips span wrapper and preserves surrounding text', () => {
        const html = '<p>Before <span class="file-ref-link" data-file-path="src/main.ts">src/main.ts</span> after</p>';
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe('Before src/main.ts after');
    });

    it('handles multiple file-ref-link spans', () => {
        const html = '<p><span class="file-ref-link" data-file-path="a/b.ts">a/b.ts</span> and <span class="file-ref-link" data-file-path="c/d.ts">c/d.ts</span></p>';
        const md = htmlToMarkdown(html);
        expect(md).toContain('a/b.ts');
        expect(md).toContain('c/d.ts');
        expect(md).not.toContain('<span');
    });
});

// ─── round-trip ─────────────────────────────────────────────────────────────

describe('file path references — round-trip', () => {
    it('round-trips a simple file path', () => {
        const original = 'See tasks/coc/foo.plan.md for details';
        const html = markdownToHtml(original);
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe(original);
    });

    it('round-trips multiple file paths', () => {
        const original = 'Compare src/a.ts and src/b.ts here';
        const html = markdownToHtml(original);
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe(original);
    });

    it('round-trips file path alongside note links', () => {
        const original = 'See [[note:Notes.md]] and tasks/coc/plan.md';
        const html = markdownToHtml(original);
        const md = htmlToMarkdown(html);
        expect(md.trim()).toBe(original);
    });
});

// ─── filePathLabel ──────────────────────────────────────────────────────────

describe('filePathLabel', () => {
    it('returns the basename of a nested path', () => {
        expect(filePathLabel('tasks/coc/foo.plan.md')).toBe('foo.plan.md');
    });

    it('returns the filename for a shallow path', () => {
        expect(filePathLabel('src/main.ts')).toBe('main.ts');
    });

    it('returns the string itself if no slash', () => {
        expect(filePathLabel('readme.md')).toBe('readme.md');
    });
});

// ─── FILE_PATH_PASTE_RE ────────────────────────────────────────────────────

describe('FILE_PATH_PASTE_RE — paste regex', () => {
    function allMatches(text: string) {
        const re = new RegExp(FILE_PATH_PASTE_RE.source, FILE_PATH_PASTE_RE.flags);
        const results: Array<{ full: string; filePath: string }> = [];
        let m;
        while ((m = re.exec(text)) !== null) {
            results.push({ full: m[0], filePath: m[1] });
        }
        return results;
    }

    it('matches a simple file path', () => {
        const matches = allMatches('See tasks/coc/foo.plan.md here');
        expect(matches).toHaveLength(1);
        expect(matches[0].filePath).toBe('tasks/coc/foo.plan.md');
    });

    it('matches TypeScript file path', () => {
        const matches = allMatches('src/server/handler.ts');
        expect(matches).toHaveLength(1);
        expect(matches[0].filePath).toBe('src/server/handler.ts');
    });

    it('matches YAML file path', () => {
        const matches = allMatches('.github/workflows/ci.yaml');
        expect(matches).toHaveLength(1);
        expect(matches[0].filePath).toBe('.github/workflows/ci.yaml');
    });

    it('matches deeply nested path', () => {
        const matches = allMatches('packages/forge/src/ai/service.ts');
        expect(matches).toHaveLength(1);
        expect(matches[0].filePath).toBe('packages/forge/src/ai/service.ts');
    });

    it('matches multiple paths', () => {
        const matches = allMatches('Compare src/a.ts and src/b.ts');
        expect(matches).toHaveLength(2);
        expect(matches[0].filePath).toBe('src/a.ts');
        expect(matches[1].filePath).toBe('src/b.ts');
    });

    it('does not match single filename without directory', () => {
        const matches = allMatches('Open readme.md please');
        expect(matches).toHaveLength(0);
    });

    it('does not match URLs', () => {
        const matches = allMatches('Visit https://example.com/path/to/file.ts');
        expect(matches).toHaveLength(0);
    });

    it('does not match paths with unknown extensions', () => {
        const matches = allMatches('See folder/file.xyz');
        expect(matches).toHaveLength(0);
    });

    it('matches path with dots in directory names', () => {
        const matches = allMatches('.github/workflows/build.yml');
        expect(matches).toHaveLength(1);
        expect(matches[0].filePath).toBe('.github/workflows/build.yml');
    });

    it('matches path with hyphens and underscores', () => {
        const matches = allMatches('my-pkg/src_dir/the-file.ts');
        expect(matches).toHaveLength(1);
        expect(matches[0].filePath).toBe('my-pkg/src_dir/the-file.ts');
    });

    it('does not match a file path that is the target of a [[note:...]] wiki-link', () => {
        // Regression: FILE_PATH_PASTE_RE was consuming the path segment inside
        // [[note:...]] before the note-link paste rule could match the full token.
        // e.g. pasting [[note:New Features/Remote.md]] rendered as [[note:New ]]
        // with a stray file-ref chip for "Features/Remote.md".
        const matches = allMatches('[[note:Features/Remote.md]]');
        expect(matches).toHaveLength(0);
    });

    it('does not match a file path inside a note link with a heading', () => {
        const matches = allMatches('[[note:Section/Page.md#Intro]]');
        expect(matches).toHaveLength(0);
    });

    it('does not match a file path immediately before ] (markdown link label context)', () => {
        // Also blocked: [tasks/coc/plan.md] — path in square-bracket label
        const matches = allMatches('[tasks/coc/plan.md]');
        expect(matches).toHaveLength(0);
    });

    it('matches a file path followed by a closing parenthesis', () => {
        // Paths inside (...) are fine — they don't involve ] lookahead
        const matches = allMatches('(tasks/coc/plan.md)');
        expect(matches).toHaveLength(1);
        expect(matches[0].filePath).toBe('tasks/coc/plan.md');
    });
});
