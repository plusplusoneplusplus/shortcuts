/**
 * Tests for useSyntaxHighlight utility functions.
 *
 * Validates language detection from file names and per-line syntax
 * highlighting behaviour, including HTML escaping and error fallback.
 */

import { describe, it, expect } from 'vitest';
import { getLanguageFromFileName, highlightLine, escapeHtml } from '../../../src/server/spa/client/react/repos/useSyntaxHighlight';

describe('escapeHtml', () => {
    it('escapes ampersands', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes less-than', () => {
        expect(escapeHtml('<div>')).toBe('&lt;div&gt;');
    });

    it('escapes greater-than', () => {
        expect(escapeHtml('x > y')).toBe('x &gt; y');
    });

    it('escapes double quotes', () => {
        expect(escapeHtml('"value"')).toBe('&quot;value&quot;');
    });

    it('returns empty string unchanged', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('does not modify plain text', () => {
        expect(escapeHtml('hello world')).toBe('hello world');
    });
});

describe('getLanguageFromFileName', () => {
    it('returns typescript for .ts extension', () => {
        expect(getLanguageFromFileName('App.ts')).toBe('typescript');
    });

    it('returns typescript for .tsx extension', () => {
        expect(getLanguageFromFileName('Component.tsx')).toBe('typescript');
    });

    it('returns javascript for .js extension', () => {
        expect(getLanguageFromFileName('index.js')).toBe('javascript');
    });

    it('returns javascript for .jsx extension', () => {
        expect(getLanguageFromFileName('App.jsx')).toBe('javascript');
    });

    it('returns javascript for .mjs extension', () => {
        expect(getLanguageFromFileName('module.mjs')).toBe('javascript');
    });

    it('returns python for .py extension', () => {
        expect(getLanguageFromFileName('script.py')).toBe('python');
    });

    it('returns go for .go extension', () => {
        expect(getLanguageFromFileName('main.go')).toBe('go');
    });

    it('returns rust for .rs extension', () => {
        expect(getLanguageFromFileName('lib.rs')).toBe('rust');
    });

    it('returns java for .java extension', () => {
        expect(getLanguageFromFileName('Main.java')).toBe('java');
    });

    it('returns c for .c extension', () => {
        expect(getLanguageFromFileName('main.c')).toBe('c');
    });

    it('returns c for .h extension', () => {
        expect(getLanguageFromFileName('header.h')).toBe('c');
    });

    it('returns cpp for .cpp extension', () => {
        expect(getLanguageFromFileName('main.cpp')).toBe('cpp');
    });

    it('returns csharp for .cs extension', () => {
        expect(getLanguageFromFileName('Program.cs')).toBe('csharp');
    });

    it('returns json for .json extension', () => {
        expect(getLanguageFromFileName('package.json')).toBe('json');
    });

    it('returns yaml for .yaml extension', () => {
        expect(getLanguageFromFileName('config.yaml')).toBe('yaml');
    });

    it('returns yaml for .yml extension', () => {
        expect(getLanguageFromFileName('workflow.yml')).toBe('yaml');
    });

    it('returns bash for .sh extension', () => {
        expect(getLanguageFromFileName('script.sh')).toBe('bash');
    });

    it('returns css for .css extension', () => {
        expect(getLanguageFromFileName('styles.css')).toBe('css');
    });

    it('returns xml for .html extension', () => {
        expect(getLanguageFromFileName('index.html')).toBe('xml');
    });

    it('returns xml for .xml extension', () => {
        expect(getLanguageFromFileName('data.xml')).toBe('xml');
    });

    it('returns xml for .svg extension', () => {
        expect(getLanguageFromFileName('icon.svg')).toBe('xml');
    });

    it('returns markdown for .md extension', () => {
        expect(getLanguageFromFileName('README.md')).toBe('markdown');
    });

    it('handles full file paths (uses last extension)', () => {
        expect(getLanguageFromFileName('src/components/App.tsx')).toBe('typescript');
    });

    it('handles paths with forward slashes', () => {
        expect(getLanguageFromFileName('packages/coc/src/index.ts')).toBe('typescript');
    });

    it('is case-insensitive for extensions', () => {
        expect(getLanguageFromFileName('App.TS')).toBe('typescript');
        expect(getLanguageFromFileName('Main.JAVA')).toBe('java');
    });

    it('returns null for unknown extension', () => {
        expect(getLanguageFromFileName('binary.bin')).toBeNull();
    });

    it('returns null for no extension', () => {
        expect(getLanguageFromFileName('Makefile')).toBeNull();
    });

    it('returns null for null input', () => {
        expect(getLanguageFromFileName(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
        expect(getLanguageFromFileName(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(getLanguageFromFileName('')).toBeNull();
    });
});

describe('highlightLine', () => {
    it('returns HTML string for known language', () => {
        const result = highlightLine('const x = 1;', 'typescript');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('contains hljs span tokens for keyword', () => {
        const result = highlightLine('const x = 1;', 'typescript');
        expect(result).toContain('hljs-');
    });

    it('returns escaped HTML for null language', () => {
        const result = highlightLine('<div>', null);
        expect(result).toBe('&lt;div&gt;');
    });

    it('returns empty string for empty input with null language', () => {
        expect(highlightLine('', null)).toBe('');
    });

    it('returns empty string for empty input with known language', () => {
        expect(highlightLine('', 'typescript')).toBe('');
    });

    it('escapes HTML entities when language is null', () => {
        const result = highlightLine('a & b < c > d "e"', null);
        expect(result).toContain('&amp;');
        expect(result).toContain('&lt;');
        expect(result).toContain('&gt;');
        expect(result).toContain('&quot;');
    });

    it('does not fail for unknown/invalid language string — falls back to escaping', () => {
        const result = highlightLine('some code', 'nonexistentlang');
        expect(typeof result).toBe('string');
    });

    it('highlights JSON correctly', () => {
        const result = highlightLine('{ "key": "value" }', 'json');
        expect(result).toContain('hljs-');
    });

    it('highlights Python correctly', () => {
        const result = highlightLine('def hello():', 'python');
        expect(result).toContain('hljs-');
    });
});
