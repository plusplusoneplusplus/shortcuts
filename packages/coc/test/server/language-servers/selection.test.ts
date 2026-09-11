/**
 * File matching, deterministic server selection, language-id resolution, and
 * project-root discovery for language-server definitions.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    bestMatchingPattern,
    fileExtension,
    matchesPattern,
    normalizeRelativePath,
} from '../../../src/server/language-servers/file-match';
import {
    definitionMatchesFile,
    resolveLanguageId,
    resolveServerRoot,
    selectDefinitionForFile,
} from '../../../src/server/language-servers/selection';
import { RUST_PRESET, TYPESCRIPT_PRESET, mergeWithBuiltIns } from '../../../src/server/language-servers/presets';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

function definition(overrides: Partial<LanguageServerDefinition>): LanguageServerDefinition {
    return {
        id: 'test',
        displayName: 'Test',
        languageIds: ['plaintext'],
        filePatterns: ['**/*.txt'],
        command: 'test-language-server',
        args: [],
        rootMarkers: [],
        ...overrides,
    };
}

describe('normalizeRelativePath', () => {
    it.each([
        ['src\\app\\main.ts', 'src/app/main.ts'],
        ['./src/main.ts', 'src/main.ts'],
        ['/src/main.ts', 'src/main.ts'],
        ['src//app///main.ts', 'src/app/main.ts'],
        ['main.ts', 'main.ts'],
    ])('normalizes %s', (input, expected) => {
        expect(normalizeRelativePath(input)).toBe(expected);
    });
});

describe('fileExtension', () => {
    it.each([
        ['src/main.TS', '.ts'],
        ['src\\main.tsx', '.tsx'],
        ['src/.gitignore', ''],
        ['src/Makefile', ''],
        ['a/b.test.ts', '.ts'],
    ])('reads the extension of %s', (input, expected) => {
        expect(fileExtension(input)).toBe(expected);
    });
});

describe('matchesPattern', () => {
    it('matches a nested path with a double star', () => {
        expect(matchesPattern('**/*.ts', 'src/deep/main.ts')).toBe(true);
    });

    it('matches a root-level file with a double star', () => {
        expect(matchesPattern('**/*.ts', 'main.ts')).toBe(true);
    });

    it('does not let a single star cross a directory boundary', () => {
        expect(matchesPattern('*.ts', 'src/main.ts')).toBe(false);
        expect(matchesPattern('*.ts', 'main.ts')).toBe(true);
    });

    it('supports brace alternation', () => {
        expect(matchesPattern('**/*.{ts,tsx}', 'src/App.tsx')).toBe(true);
        expect(matchesPattern('**/*.{ts,tsx}', 'src/App.css')).toBe(false);
    });

    it('treats dots as literal characters', () => {
        expect(matchesPattern('**/*.ts', 'srcXts')).toBe(false);
    });

    it('matches Windows-style paths', () => {
        expect(matchesPattern('**/*.ts', 'src\\deep\\main.ts')).toBe(true);
    });

    it('matches a directory-scoped pattern', () => {
        expect(matchesPattern('packages/**/*.ts', 'packages/coc/src/main.ts')).toBe(true);
        expect(matchesPattern('packages/**/*.ts', 'other/src/main.ts')).toBe(false);
    });
});

describe('bestMatchingPattern', () => {
    it('prefers the more specific pattern', () => {
        expect(bestMatchingPattern(['**/*.ts', '**/*.test.ts'], 'src/a.test.ts')).toBe('**/*.test.ts');
    });

    it('returns undefined when nothing matches', () => {
        expect(bestMatchingPattern(['**/*.ts'], 'src/a.css')).toBeUndefined();
    });
});

describe('selectDefinitionForFile', () => {
    it('returns the single matching definition', () => {
        const ts = definition({ id: 'ts', filePatterns: ['**/*.ts'] });
        expect(selectDefinitionForFile([ts], 'src/main.ts')?.id).toBe('ts');
    });

    it('returns undefined when no definition claims the file', () => {
        const ts = definition({ id: 'ts', filePatterns: ['**/*.ts'] });
        expect(selectDefinitionForFile([ts], 'README.md')).toBeUndefined();
    });

    it('skips disabled definitions', () => {
        const disabled = definition({ id: 'ts', filePatterns: ['**/*.ts'], enabled: false });
        const enabled = definition({ id: 'other', filePatterns: ['**/*.ts'], enabled: true });
        expect(selectDefinitionForFile([disabled, enabled], 'src/main.ts')?.id).toBe('other');
    });

    it('prefers the higher priority on overlapping patterns', () => {
        const low = definition({ id: 'low', filePatterns: ['**/*.ts'], priority: 1 });
        const high = definition({ id: 'high', filePatterns: ['**/*.ts'], priority: 5 });
        expect(selectDefinitionForFile([low, high], 'src/main.ts')?.id).toBe('high');
        expect(selectDefinitionForFile([high, low], 'src/main.ts')?.id).toBe('high');
    });

    it('prefers the more specific pattern at equal priority', () => {
        const broad = definition({ id: 'broad', filePatterns: ['**/*.ts'] });
        const narrow = definition({ id: 'narrow', filePatterns: ['**/*.spec.ts'] });
        expect(selectDefinitionForFile([broad, narrow], 'src/a.spec.ts')?.id).toBe('narrow');
    });

    it('breaks a full tie by id so selection does not depend on input order', () => {
        const a = definition({ id: 'aaa', filePatterns: ['**/*.ts'] });
        const b = definition({ id: 'bbb', filePatterns: ['**/*.ts'] });
        expect(selectDefinitionForFile([a, b], 'src/main.ts')?.id).toBe('aaa');
        expect(selectDefinitionForFile([b, a], 'src/main.ts')?.id).toBe('aaa');
    });
});

describe('resolveLanguageId', () => {
    it.each([
        ['src/main.ts', 'typescript'],
        ['src/App.tsx', 'typescriptreact'],
        ['src/main.js', 'javascript'],
        ['src/App.jsx', 'javascriptreact'],
        ['src/main.mts', 'typescript'],
        ['src\\App.tsx', 'typescriptreact'],
    ])('maps %s through the TypeScript preset', (file, expected) => {
        expect(resolveLanguageId(TYPESCRIPT_PRESET, file)).toBe(expected);
    });

    it('falls back to the first declared language id', () => {
        const def = definition({ languageIds: ['plaintext'], extensionLanguageIds: { '.txt': 'plaintext' } });
        expect(resolveLanguageId(def, 'notes.log')).toBe('plaintext');
    });
});

describe('definitionMatchesFile', () => {
    it('ignores the enabled flag', () => {
        const def = definition({ filePatterns: ['**/*.ts'], enabled: false });
        expect(definitionMatchesFile(def, 'src/main.ts')).toBe(true);
    });
});

describe('resolveServerRoot', () => {
    const workspaceRoot = path.resolve(path.sep === '\\' ? 'C:\\ws' : '/ws');
    const def = definition({ rootMarkers: ['tsconfig.json', 'package.json'] });

    it('returns the nearest ancestor holding a marker', () => {
        const marker = path.join(workspaceRoot, 'packages', 'app', 'tsconfig.json');
        const root = resolveServerRoot(def, workspaceRoot, path.join('packages', 'app', 'src', 'main.ts'), c => c === marker);
        expect(root).toBe(path.join(workspaceRoot, 'packages', 'app'));
    });

    it('prefers the nearest marker over one higher up', () => {
        const near = path.join(workspaceRoot, 'packages', 'app', 'package.json');
        const far = path.join(workspaceRoot, 'package.json');
        const root = resolveServerRoot(def, workspaceRoot, path.join('packages', 'app', 'src', 'main.ts'), c => c === near || c === far);
        expect(root).toBe(path.join(workspaceRoot, 'packages', 'app'));
    });

    it('falls back to the workspace root when no marker exists', () => {
        expect(resolveServerRoot(def, workspaceRoot, path.join('src', 'main.ts'), () => false)).toBe(workspaceRoot);
    });

    it('never walks above the workspace root', () => {
        const root = resolveServerRoot(def, workspaceRoot, path.join('src', 'main.ts'), () => true);
        expect(root.startsWith(workspaceRoot)).toBe(true);
    });
});

describe('mergeWithBuiltIns', () => {
    it('exposes the built-in presets when nothing is configured', () => {
        expect(mergeWithBuiltIns([]).map(d => d.id)).toEqual(['typescript', 'rust']);
    });

    it('ships every preset disabled so language support starts off', () => {
        expect(TYPESCRIPT_PRESET.enabled).toBe(false);
        expect(RUST_PRESET.enabled).toBe(false);
    });

    it('defines Rust defaults for fast diagnostics and macro expansion', () => {
        expect(RUST_PRESET).toMatchObject({
            languageIds: ['rust'],
            filePatterns: ['**/*.rs'],
            command: 'rust-analyzer',
            args: [],
            rootMarkers: ['Cargo.toml'],
            extensionLanguageIds: { '.rs': 'rust' },
            initializationOptions: {
                checkOnSave: false,
                cargo: { buildScripts: { enable: true } },
                procMacro: { enable: true },
            },
            builtIn: true,
        });
    });

    it('lets a workspace definition override the preset without losing built-in status', () => {
        const merged = mergeWithBuiltIns([definition({ id: 'typescript', enabled: true, command: 'my-tsserver' })]);
        const ts = merged.find(d => d.id === 'typescript');
        expect(ts?.enabled).toBe(true);
        expect(ts?.command).toBe('my-tsserver');
        expect(ts?.builtIn).toBe(true);
    });

    it('appends custom definitions after the built-ins', () => {
        const merged = mergeWithBuiltIns([definition({ id: 'custom' })]);
        expect(merged.map(d => d.id)).toEqual(['typescript', 'rust', 'custom']);
        expect(merged.find(d => d.id === 'custom')?.builtIn).toBeUndefined();
    });

    it('routes a TypeScript file to the preset once enabled', () => {
        const merged = mergeWithBuiltIns([{ ...TYPESCRIPT_PRESET, enabled: true }]);
        expect(selectDefinitionForFile(merged, 'src/App.tsx')?.id).toBe('typescript');
    });

    it('routes only Rust source files to the Rust preset once enabled', () => {
        const merged = mergeWithBuiltIns([{ ...RUST_PRESET, enabled: true }]);
        expect(selectDefinitionForFile(merged, 'crates/app/src/main.rs')?.id).toBe('rust');
        expect(selectDefinitionForFile(merged, 'Cargo.toml')).toBeUndefined();
        expect(resolveLanguageId(RUST_PRESET, 'src/lib.rs')).toBe('rust');
    });
});
