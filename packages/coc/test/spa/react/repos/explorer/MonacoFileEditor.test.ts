/**
 * Tests for MonacoFileEditor helpers: getMonacoLanguage, EXPLORER_EDITOR_OPTIONS
 */

import { describe, expect, it } from 'vitest';
import { getMonacoLanguage, EXPLORER_EDITOR_OPTIONS } from '../../../../../src/server/spa/client/react/repos/explorer/MonacoFileEditor';

describe('getMonacoLanguage', () => {
    it('maps TypeScript extensions', () => {
        expect(getMonacoLanguage('app.ts')).toBe('typescript');
        expect(getMonacoLanguage('Component.tsx')).toBe('typescript');
    });

    it('maps JavaScript extensions', () => {
        expect(getMonacoLanguage('index.js')).toBe('javascript');
        expect(getMonacoLanguage('App.jsx')).toBe('javascript');
        expect(getMonacoLanguage('config.mjs')).toBe('javascript');
        expect(getMonacoLanguage('config.cjs')).toBe('javascript');
    });

    it('maps Python', () => {
        expect(getMonacoLanguage('main.py')).toBe('python');
    });

    it('maps Go', () => {
        expect(getMonacoLanguage('main.go')).toBe('go');
    });

    it('maps Rust', () => {
        expect(getMonacoLanguage('lib.rs')).toBe('rust');
    });

    it('maps JSON', () => {
        expect(getMonacoLanguage('package.json')).toBe('json');
    });

    it('maps YAML', () => {
        expect(getMonacoLanguage('config.yaml')).toBe('yaml');
        expect(getMonacoLanguage('config.yml')).toBe('yaml');
    });

    it('maps HTML', () => {
        expect(getMonacoLanguage('index.html')).toBe('html');
        expect(getMonacoLanguage('index.htm')).toBe('html');
    });

    it('maps CSS variants', () => {
        expect(getMonacoLanguage('style.css')).toBe('css');
        expect(getMonacoLanguage('style.scss')).toBe('scss');
        expect(getMonacoLanguage('style.less')).toBe('less');
    });

    it('maps shell scripts', () => {
        expect(getMonacoLanguage('setup.sh')).toBe('shell');
        expect(getMonacoLanguage('build.bash')).toBe('shell');
    });

    it('maps Markdown', () => {
        expect(getMonacoLanguage('README.md')).toBe('markdown');
        expect(getMonacoLanguage('docs.mdx')).toBe('markdown');
    });

    it('maps XML/SVG', () => {
        expect(getMonacoLanguage('data.xml')).toBe('xml');
        expect(getMonacoLanguage('icon.svg')).toBe('xml');
    });

    it('maps C/C++ variants', () => {
        expect(getMonacoLanguage('main.c')).toBe('c');
        expect(getMonacoLanguage('header.h')).toBe('c');
        expect(getMonacoLanguage('main.cpp')).toBe('cpp');
        expect(getMonacoLanguage('main.cc')).toBe('cpp');
    });

    it('maps C#', () => {
        expect(getMonacoLanguage('Program.cs')).toBe('csharp');
    });

    it('maps Java', () => {
        expect(getMonacoLanguage('Main.java')).toBe('java');
    });

    it('maps SQL', () => {
        expect(getMonacoLanguage('query.sql')).toBe('sql');
    });

    it('maps Dockerfile', () => {
        expect(getMonacoLanguage('Dockerfile')).toBe('dockerfile');
    });

    it('returns plaintext for unknown extensions', () => {
        expect(getMonacoLanguage('file.xyz')).toBe('plaintext');
        expect(getMonacoLanguage('file.unknown')).toBe('plaintext');
    });

    it('returns plaintext for files without extension', () => {
        expect(getMonacoLanguage('LICENSE')).toBe('plaintext');
    });

    it('maps Makefile', () => {
        expect(getMonacoLanguage('Makefile')).toBe('makefile');
    });
});

describe('EXPLORER_EDITOR_OPTIONS', () => {
    it('disables minimap to remove right margin', () => {
        expect(EXPLORER_EDITOR_OPTIONS.minimap).toEqual({ enabled: false });
    });

    it('sets zero top and bottom padding', () => {
        expect(EXPLORER_EDITOR_OPTIONS.padding).toEqual({ top: 0, bottom: 0 });
    });

    it('disables glyph margin, folding, and line decorations to minimize left margin', () => {
        expect(EXPLORER_EDITOR_OPTIONS.glyphMargin).toBe(false);
        expect(EXPLORER_EDITOR_OPTIONS.folding).toBe(false);
        expect(EXPLORER_EDITOR_OPTIONS.lineDecorationsWidth).toBe(0);
    });

    it('disables overview ruler to remove right-side chrome', () => {
        expect(EXPLORER_EDITOR_OPTIONS.overviewRulerLanes).toBe(0);
        expect(EXPLORER_EDITOR_OPTIONS.overviewRulerBorder).toBe(false);
        expect(EXPLORER_EDITOR_OPTIONS.hideCursorInOverviewRuler).toBe(true);
    });

    it('uses slim scrollbar sizes', () => {
        expect(EXPLORER_EDITOR_OPTIONS.scrollbar).toEqual({
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
        });
    });
});
