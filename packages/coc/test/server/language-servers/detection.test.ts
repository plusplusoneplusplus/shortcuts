/**
 * Language detection over temp-dir fixtures: root markers, the bounded
 * extension fallback, multi-language repos, and repos that say nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    DETECTION_EXCLUDED_DIRECTORIES,
    detectWorkspaceLanguages,
    detectableLanguageServerDefinitions,
} from '../../../src/server/language-servers/detection';

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-lsp-detect-'));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function write(relative: string, contents = ''): void {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents, 'utf-8');
}

describe('detectable presets', () => {
    it('considers only presets that ship disabled, leaving coc-symbols alone', () => {
        const ids = detectableLanguageServerDefinitions().map((definition) => definition.id);
        expect(ids).toEqual(['typescript', 'rust', 'python', 'clangd']);
    });
});

describe('detection by root marker', () => {
    it.each([
        ['Cargo.toml', 'rust'],
        ['package.json', 'typescript'],
        ['tsconfig.json', 'typescript'],
        ['jsconfig.json', 'typescript'],
        ['pyproject.toml', 'python'],
        ['requirements.txt', 'python'],
        ['setup.py', 'python'],
        ['setup.cfg', 'python'],
        ['pyrightconfig.json', 'python'],
        ['compile_commands.json', 'clangd'],
        ['.clangd', 'clangd'],
        ['compile_flags.txt', 'clangd'],
    ])('%s selects %s', (marker, expected) => {
        write(marker, '{}');
        expect(detectWorkspaceLanguages(root)).toEqual([expected]);
    });

    it('ignores a marker that is nested below the workspace root', () => {
        write('crates/inner/Cargo.toml', '');
        // Nothing at the root claims rust, and no .rs file exists either.
        expect(detectWorkspaceLanguages(root)).toEqual([]);
    });
});

describe('detection by file extension fallback', () => {
    it.each([
        ['src/main.rs', 'rust'],
        ['src/app.tsx', 'typescript'],
        ['scripts/tool.py', 'python'],
        ['src/main.cpp', 'clangd'],
    ])('%s selects %s', (file, expected) => {
        write(file, '');
        expect(detectWorkspaceLanguages(root)).toEqual([expected]);
    });

    it('finds a file at the depth limit but not below it', () => {
        write('a/b/c/deep.rs', '');
        expect(detectWorkspaceLanguages(root)).toEqual(['rust']);

        fs.rmSync(path.join(root, 'a'), { recursive: true, force: true });
        write('a/b/c/d/too-deep.rs', '');
        expect(detectWorkspaceLanguages(root)).toEqual([]);
    });

    it('stops once the entry budget is spent', () => {
        for (let i = 0; i < 20; i++) {
            write(`filler-${i}.txt`, '');
        }
        write('zz-last.rs', '');
        expect(detectWorkspaceLanguages(root, { maxEntries: 5 })).toEqual([]);
    });
});

describe('multi-language and empty repositories', () => {
    it('reports every language a mixed repo uses, in preset order', () => {
        write('Cargo.toml', '');
        write('package.json', '{}');
        write('pyproject.toml', '');
        write('src/main.cpp', '');
        expect(detectWorkspaceLanguages(root)).toEqual(['typescript', 'rust', 'python', 'clangd']);
    });

    it('mixes a marker match with an extension match', () => {
        write('Cargo.toml', '');
        write('tools/generate.py', '');
        expect(detectWorkspaceLanguages(root)).toEqual(['rust', 'python']);
    });

    it('detects nothing in an empty repository', () => {
        expect(detectWorkspaceLanguages(root)).toEqual([]);
    });

    it('detects nothing when the only sources live in excluded directories', () => {
        for (const excluded of DETECTION_EXCLUDED_DIRECTORIES) {
            write(`${excluded}/vendored.rs`, '');
            write(`${excluded}/vendored.py`, '');
            write(`${excluded}/vendored.ts`, '');
            write(`${excluded}/vendored.cpp`, '');
        }
        expect(detectWorkspaceLanguages(root)).toEqual([]);
    });

    it('detects nothing for a workspace root that does not exist', () => {
        expect(detectWorkspaceLanguages(path.join(root, 'missing'))).toEqual([]);
    });
});
