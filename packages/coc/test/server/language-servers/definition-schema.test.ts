/**
 * Validation of language-server definitions: field-level errors, executable
 * safety, normalization, and duplicate-id handling in a definition list.
 */

import { describe, it, expect } from 'vitest';
import {
    validateLanguageServerDefinition,
    validateLanguageServerDefinitions,
} from '../../../src/server/language-servers/definition-schema';

function validDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'test-server',
        displayName: 'Test Server',
        languageIds: ['plaintext'],
        filePatterns: ['**/*.txt'],
        command: 'test-language-server',
        args: ['--stdio'],
        rootMarkers: ['.git'],
        ...overrides,
    };
}

describe('validateLanguageServerDefinition', () => {
    it('accepts a complete definition', () => {
        const result = validateLanguageServerDefinition(validDefinition());
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.definition.id).toBe('test-server');
            expect(result.definition.args).toEqual(['--stdio']);
        }
    });

    it('rejects a non-object', () => {
        const result = validateLanguageServerDefinition('typescript-language-server --stdio');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors[0].message).toMatch(/JSON object/);
        }
    });

    it('reports the offending field for a missing command', () => {
        const result = validateLanguageServerDefinition(validDefinition({ command: '' }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map(e => e.field)).toContain('command');
        }
    });

    it.each([
        'sh -c "rm -rf /"',
        'server; rm -rf /',
        'server && evil',
        'server | evil',
        'server `evil`',
        'server $(evil)',
        'server\nevil',
    ])('rejects a command that is a shell command line: %s', command => {
        const result = validateLanguageServerDefinition(validDefinition({ command }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.some(e => e.field === 'command')).toBe(true);
        }
    });

    it('accepts an absolute executable path with spaces in the directory', () => {
        const result = validateLanguageServerDefinition(
            validDefinition({ command: '/opt/my tools/test-language-server' }),
        );
        expect(result.ok).toBe(true);
    });

    it('rejects args given as a single string instead of a vector', () => {
        const result = validateLanguageServerDefinition(validDefinition({ args: '--stdio --log' }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map(e => e.field)).toContain('args');
        }
    });

    it('reports the index of a bad argument', () => {
        const result = validateLanguageServerDefinition(validDefinition({ args: ['--stdio', 'a\nb'] }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map(e => e.field)).toContain('args.1');
        }
    });

    it('rejects an empty language id list', () => {
        const result = validateLanguageServerDefinition(validDefinition({ languageIds: [] }));
        expect(result.ok).toBe(false);
    });

    it('rejects an empty file pattern list', () => {
        const result = validateLanguageServerDefinition(validDefinition({ filePatterns: [] }));
        expect(result.ok).toBe(false);
    });

    it.each(['Has Spaces', 'UPPER', '-leading-dash', 'sla/sh'])('rejects the unsafe id %s', id => {
        const result = validateLanguageServerDefinition(validDefinition({ id }));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.map(e => e.field)).toContain('id');
        }
    });

    it('normalizes extension keys to lowercase with a leading dot', () => {
        const result = validateLanguageServerDefinition(
            validDefinition({ extensionLanguageIds: { TS: 'typescript', '.TSX': 'typescriptreact' } }),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.definition.extensionLanguageIds).toEqual({
                '.ts': 'typescript',
                '.tsx': 'typescriptreact',
            });
        }
    });

    it('keeps nested initialization options and settings', () => {
        const result = validateLanguageServerDefinition(
            validDefinition({
                initializationOptions: { preferences: { includeCompletionsForModuleExports: true } },
                settings: { test: { trace: 'off', levels: [1, 2] } },
            }),
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.definition.initializationOptions).toEqual({
                preferences: { includeCompletionsForModuleExports: true },
            });
            expect(result.definition.settings).toEqual({ test: { trace: 'off', levels: [1, 2] } });
        }
    });

    it('keeps valid per-definition session lifecycle controls', () => {
        const result = validateLanguageServerDefinition(validDefinition({
            sessionScope: 'workspace',
            maxSessions: 4,
            requestTimeoutMs: 120_000,
            idleTimeoutMs: 1_800_000,
        }));
        expect(result).toMatchObject({
            ok: true,
            definition: {
                sessionScope: 'workspace',
                maxSessions: 4,
                requestTimeoutMs: 120_000,
                idleTimeoutMs: 1_800_000,
            },
        });
    });

    it.each([
        [{ sessionScope: 'global' }, 'sessionScope'],
        [{ maxSessions: 0 }, 'maxSessions'],
        [{ requestTimeoutMs: 0 }, 'requestTimeoutMs'],
        [{ idleTimeoutMs: -1 }, 'idleTimeoutMs'],
    ])('rejects invalid lifecycle controls %#', (overrides, field) => {
        const result = validateLanguageServerDefinition(validDefinition(overrides));
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors.some(error => error.field === field)).toBe(true);
        }
    });
});

describe('validateLanguageServerDefinitions', () => {
    it('keeps valid entries and reports invalid ones by index', () => {
        const result = validateLanguageServerDefinitions([
            validDefinition({ id: 'good' }),
            validDefinition({ id: 'bad', command: '' }),
        ]);
        expect(result.definitions.map(d => d.id)).toEqual(['good']);
        expect(result.errors.map(e => e.field)).toContain('1.command');
    });

    it('keeps the first definition of a duplicated id and reports the later one', () => {
        const result = validateLanguageServerDefinitions([
            validDefinition({ id: 'dup', displayName: 'First' }),
            validDefinition({ id: 'dup', displayName: 'Second' }),
        ]);
        expect(result.definitions).toHaveLength(1);
        expect(result.definitions[0].displayName).toBe('First');
        expect(result.errors.map(e => e.field)).toContain('1.id');
    });

    it('rejects a non-array', () => {
        const result = validateLanguageServerDefinitions({ id: 'x' });
        expect(result.definitions).toEqual([]);
        expect(result.errors).toHaveLength(1);
    });
});
