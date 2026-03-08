/**
 * Tests for MonacoFileEditor helper: getMonacoLanguage
 */

import { describe, expect, it } from 'vitest';
import { getMonacoLanguage } from '../../../../../src/server/spa/client/react/repos/explorer/MonacoFileEditor';

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
