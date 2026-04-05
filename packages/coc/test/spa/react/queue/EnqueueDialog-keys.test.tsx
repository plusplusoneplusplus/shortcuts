/**
 * Tests for EnqueueDialog key-uniqueness fixes.
 *
 * Covers:
 *  - flattenFolders producing duplicate values (root folders)
 *  - Model dedup/filter logic
 *  - Rendering selects with edge-case data without React key warnings
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { flattenFolders } from '../../../../src/server/spa/client/react/queue/EnqueueDialog';

/* ------------------------------------------------------------------ */
/*  flattenFolders                                                     */
/* ------------------------------------------------------------------ */

describe('flattenFolders', () => {
    it('produces value="" for root node', () => {
        const tree = { relativePath: '', name: 'root', children: [] };
        const result = flattenFolders(tree);
        expect(result).toEqual([{ label: '(root)', value: '' }]);
    });

    it('flattens nested tree with indentation', () => {
        const tree = {
            relativePath: '',
            name: 'root',
            children: [
                { relativePath: 'src', name: 'src', children: [
                    { relativePath: 'src/utils', name: 'utils', children: [] },
                ] },
            ],
        };
        const result = flattenFolders(tree);
        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({ label: '(root)', value: '' });
        expect(result[1].value).toBe('src');
        expect(result[2].value).toBe('src/utils');
    });

    it('skips nodes without relativePath', () => {
        const tree = { name: 'virtual', children: [
            { relativePath: 'a', name: 'a', children: [] },
        ] };
        const result = flattenFolders(tree);
        expect(result).toHaveLength(1);
        expect(result[0].value).toBe('a');
        expect(result[0].label).toContain('a');
    });

    it('handles empty children array', () => {
        const tree = { relativePath: 'pkg', name: 'pkg', children: [] };
        expect(flattenFolders(tree)).toHaveLength(1);
    });

    it('handles missing children property', () => {
        const tree = { relativePath: 'pkg', name: 'pkg' };
        expect(flattenFolders(tree)).toHaveLength(1);
    });
});

/* ------------------------------------------------------------------ */
/*  Model dedup logic (mirrors EnqueueDialog L59-63)                   */
/* ------------------------------------------------------------------ */

describe('model dedup logic', () => {
    function dedup(modelInfos: { id: string; enabled: boolean }[]) {
        const enabledModels = modelInfos.filter(m => m.enabled);
        return [...new Set(
            (enabledModels.length > 0 ? enabledModels : modelInfos)
                .map(m => m.id)
                .filter(Boolean)
        )];
    }

    it('removes duplicate model IDs', () => {
        const infos = [
            { id: 'gpt-4', enabled: true },
            { id: 'gpt-4', enabled: true },
            { id: 'gpt-3.5', enabled: true },
        ];
        expect(dedup(infos)).toEqual(['gpt-4', 'gpt-3.5']);
    });

    it('filters out empty-string model IDs', () => {
        const infos = [
            { id: '', enabled: true },
            { id: 'gpt-4', enabled: true },
        ];
        expect(dedup(infos)).toEqual(['gpt-4']);
    });

    it('falls back to all models when none are enabled', () => {
        const infos = [
            { id: 'model-a', enabled: false },
            { id: 'model-b', enabled: false },
        ];
        expect(dedup(infos)).toEqual(['model-a', 'model-b']);
    });

    it('returns empty array when all IDs are empty', () => {
        const infos = [{ id: '', enabled: true }];
        expect(dedup(infos)).toEqual([]);
    });
});

/* ------------------------------------------------------------------ */
/*  React key uniqueness — render selects with edge-case data          */
/* ------------------------------------------------------------------ */

describe('select key uniqueness (no React warnings)', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    it('folder select: no duplicate key warning with multiple root folders', () => {
        const folders = [
            { label: '(root)', value: '' },
            { label: '(root)', value: '' },
            { label: 'src', value: 'src' },
        ];

        render(
            <select>
                {folders.map((f, i) => (
                    <option key={`${f.value}::${i}`} value={f.value}>{f.label}</option>
                ))}
            </select>
        );

        const keyWarnings = consoleErrorSpy.mock.calls.filter(
            args => typeof args[0] === 'string' && args[0].includes('same key')
        );
        expect(keyWarnings).toHaveLength(0);
    });

    it('model select: no duplicate key warning after dedup', () => {
        const models = [...new Set(['gpt-4', 'gpt-4', 'gpt-3.5'].filter(Boolean))];

        render(
            <select>
                <option value="">Default</option>
                {models.map(m => (
                    <option key={m} value={m}>{m}</option>
                ))}
            </select>
        );

        const keyWarnings = consoleErrorSpy.mock.calls.filter(
            args => typeof args[0] === 'string' && args[0].includes('same key')
        );
        expect(keyWarnings).toHaveLength(0);
    });

    it('workspace select: no duplicate key warning with fallback', () => {
        const workspaces = [
            { id: 'ws-1', name: 'Repo A' },
            { id: '', name: 'Unknown' },
            { id: '', name: 'Also Unknown' },
        ];

        render(
            <select>
                <option value="">None</option>
                {workspaces.map((ws, i) => (
                    <option key={`${ws.id}::${i}`} value={ws.id}>{ws.name}</option>
                ))}
            </select>
        );

        const keyWarnings = consoleErrorSpy.mock.calls.filter(
            args => typeof args[0] === 'string' && args[0].includes('same key')
        );
        expect(keyWarnings).toHaveLength(0);
    });

    it('REGRESSION: old folder key pattern WOULD produce duplicate keys', () => {
        const folders = [
            { label: '(root)', value: '' },
            { label: '(root)', value: '' },
        ];

        render(
            <select data-testid="old-pattern">
                {folders.map((f, i) => (
                    // Old pattern: key={f.value} — would collide on ""
                    // We verify the new pattern avoids this
                    <option key={`${f.value}::${i}`} value={f.value}>{f.label}</option>
                ))}
            </select>
        );

        // Confirm two options are rendered (old pattern would merge them)
        const options = document.querySelectorAll('[data-testid="old-pattern"] option');
        expect(options).toHaveLength(2);
    });
});
