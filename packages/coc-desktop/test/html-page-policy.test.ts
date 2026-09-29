/**
 * Tests for the HTML page tab's pure policy: which paths the main process
 * accepts, and how page navigations / `window.open` are routed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    classifyHtmlPageNavigation,
    classifyHtmlPageWindowOpen,
    hasHtmlExtension,
    htmlPageFileUrl,
    validateHtmlPagePath,
} from '../src/html-page-policy';

describe('hasHtmlExtension', () => {
    it('accepts .html and .htm in any case', () => {
        expect(hasHtmlExtension('/a/b/index.html')).toBe(true);
        expect(hasHtmlExtension('/a/b/INDEX.HTM')).toBe(true);
        expect(hasHtmlExtension('page.Html')).toBe(true);
    });

    it('rejects everything else', () => {
        expect(hasHtmlExtension('/a/b/index.md')).toBe(false);
        expect(hasHtmlExtension('/a/b/index.html.txt')).toBe(false);
        expect(hasHtmlExtension('/a/b/html')).toBe(false);
        expect(hasHtmlExtension(undefined as unknown as string)).toBe(false);
    });
});

describe('validateHtmlPagePath', () => {
    let dir: string;
    let htmlFile: string;
    let mdFile: string;
    let htmlDir: string;

    beforeAll(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-html-page-'));
        htmlFile = path.join(dir, 'index.html');
        mdFile = path.join(dir, 'notes.md');
        htmlDir = path.join(dir, 'folder.html');
        fs.writeFileSync(htmlFile, '<h1>hi</h1>');
        fs.writeFileSync(mdFile, '# hi');
        fs.mkdirSync(htmlDir);
    });

    afterAll(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('accepts an existing absolute .html file', () => {
        expect(validateHtmlPagePath(htmlFile)).toEqual({ ok: true, path: path.normalize(htmlFile) });
    });

    it('rejects a non-html path even when it exists', () => {
        expect(validateHtmlPagePath(mdFile)).toEqual({ ok: false, reason: 'not-html' });
    });

    it('rejects a missing .html path', () => {
        expect(validateHtmlPagePath(path.join(dir, 'nope.html'))).toEqual({ ok: false, reason: 'missing' });
    });

    it('rejects a directory named like an html file', () => {
        expect(validateHtmlPagePath(htmlDir)).toEqual({ ok: false, reason: 'not-file' });
    });

    it('rejects relative paths', () => {
        expect(validateHtmlPagePath('demo/index.html')).toEqual({ ok: false, reason: 'not-absolute' });
    });

    it('rejects non-strings, empty strings and NUL bytes', () => {
        expect(validateHtmlPagePath(undefined)).toEqual({ ok: false, reason: 'invalid' });
        expect(validateHtmlPagePath(42)).toEqual({ ok: false, reason: 'invalid' });
        expect(validateHtmlPagePath('   ')).toEqual({ ok: false, reason: 'invalid' });
        expect(validateHtmlPagePath(htmlFile + '\0.html')).toEqual({ ok: false, reason: 'invalid' });
    });

    it('uses the injected stat function', () => {
        const fake = path.resolve('/virtual/page.htm');
        expect(validateHtmlPagePath(fake, () => ({ isFile: () => true }))).toEqual({ ok: true, path: fake });
        expect(validateHtmlPagePath(fake, () => null)).toEqual({ ok: false, reason: 'missing' });
    });
});

describe('htmlPageFileUrl', () => {
    it('builds a file:// URL that round-trips spaces', () => {
        const p = path.resolve('/tmp/my demo/index.html');
        const url = htmlPageFileUrl(p);
        expect(url.startsWith('file://')).toBe(true);
        expect(url).toBe(pathToFileURL(p).href);
        expect(url).toContain('my%20demo');
    });
});

describe('classifyHtmlPageNavigation', () => {
    const root = path.resolve('/work/demo/index.html');
    const current = pathToFileURL(root).href;
    const fileUrl = (p: string) => pathToFileURL(path.resolve(p)).href;

    it('sends http(s) navigations to the system browser', () => {
        expect(classifyHtmlPageNavigation('https://example.com/x', current, root)).toBe('external');
        expect(classifyHtmlPageNavigation('http://localhost:4000/', current, root)).toBe('external');
    });

    it('allows same-document anchors in place', () => {
        expect(classifyHtmlPageNavigation(current + '#section-2', current, root)).toBe('allow');
        expect(classifyHtmlPageNavigation(current + '#b', current + '#a', root)).toBe('allow');
    });

    it('allows sibling and nested html pages next to the file', () => {
        expect(classifyHtmlPageNavigation(fileUrl('/work/demo/about.html'), current, root)).toBe('allow');
        expect(classifyHtmlPageNavigation(fileUrl('/work/demo/docs/guide.htm'), current, root)).toBe('allow');
        expect(classifyHtmlPageNavigation(fileUrl('/work/demo/about.html') + '#top', current, root)).toBe('allow');
    });

    it('keeps in-folder anchors working after navigating to a sibling page', () => {
        const sibling = fileUrl('/work/demo/about.html');
        expect(classifyHtmlPageNavigation(sibling + '#x', sibling, root)).toBe('allow');
    });

    it('denies file:// pages outside the folder', () => {
        expect(classifyHtmlPageNavigation(fileUrl('/work/other/index.html'), current, root)).toBe('deny');
        expect(classifyHtmlPageNavigation(fileUrl('/work/index.html'), current, root)).toBe('deny');
        expect(classifyHtmlPageNavigation(fileUrl('/etc/passwd.html'), current, root)).toBe('deny');
    });

    it('denies non-html file:// targets even inside the folder', () => {
        expect(classifyHtmlPageNavigation(fileUrl('/work/demo/data.json'), current, root)).toBe('deny');
        expect(classifyHtmlPageNavigation(fileUrl('/work/demo/'), current, root)).toBe('deny');
    });

    it('denies other schemes and garbage', () => {
        for (const url of [
            'javascript:alert(1)',
            'data:text/html,<h1>x</h1>',
            'about:blank',
            'mailto:a@b.c',
            'vscode://file/x',
            'chrome://settings',
            'not a url',
            '',
        ]) {
            expect(classifyHtmlPageNavigation(url, current, root)).toBe('deny');
        }
    });

    it('still applies the folder rule when the current URL is unusable', () => {
        expect(classifyHtmlPageNavigation(fileUrl('/work/demo/a.html'), '', root)).toBe('allow');
        expect(classifyHtmlPageNavigation(fileUrl('/work/x/a.html'), 'garbage', root)).toBe('deny');
    });
});

describe('classifyHtmlPageWindowOpen', () => {
    it('opens http(s) in the system browser', () => {
        expect(classifyHtmlPageWindowOpen('https://example.com')).toBe('external');
        expect(classifyHtmlPageWindowOpen('http://example.com/a?b=c')).toBe('external');
    });

    it('denies everything else, including file:// pages', () => {
        expect(classifyHtmlPageWindowOpen(pathToFileURL(path.resolve('/work/demo/a.html')).href)).toBe('deny');
        expect(classifyHtmlPageWindowOpen('javascript:void(0)')).toBe('deny');
        expect(classifyHtmlPageWindowOpen('about:blank')).toBe('deny');
        expect(classifyHtmlPageWindowOpen('')).toBe('deny');
    });
});
