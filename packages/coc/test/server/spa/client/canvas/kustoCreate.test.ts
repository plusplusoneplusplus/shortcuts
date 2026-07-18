import { describe, it, expect } from 'vitest';
import type { CanvasSummary } from '@plusplusoneplusplus/coc-client';
import {
    buildBlankKustoContent,
    extractKustoSeed,
    pickLatestKustoCanvas,
} from '../../../../../src/server/spa/client/react/features/canvas/kustoCreate';

function summary(overrides: Partial<CanvasSummary>): CanvasSummary {
    return {
        id: 'c1',
        workspaceId: 'ws',
        title: 'X',
        type: 'markdown',
        revision: 1,
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
        lastEditor: 'ai',
        ...overrides,
    };
}

describe('pickLatestKustoCanvas', () => {
    it('returns null when there are no Kusto canvases', () => {
        expect(pickLatestKustoCanvas([summary({ type: 'markdown' }), summary({ type: 'code' })])).toBeNull();
    });

    it('picks the Kusto canvas with the latest updatedAt', () => {
        const latest = pickLatestKustoCanvas([
            summary({ id: 'e-old', type: 'kusto', updatedAt: '2026-07-18T01:00:00.000Z' }),
            summary({ id: 'md', type: 'markdown', updatedAt: '2026-07-18T09:00:00.000Z' }),
            summary({ id: 'e-new', type: 'kusto', updatedAt: '2026-07-18T05:00:00.000Z' }),
        ]);
        expect(latest?.id).toBe('e-new');
    });

    it('ignores non-Kusto canvases even when newer', () => {
        const latest = pickLatestKustoCanvas([
            summary({ id: 'e1', type: 'kusto', updatedAt: '2026-07-18T02:00:00.000Z' }),
            summary({ id: 'md', type: 'markdown', updatedAt: '2026-07-18T20:00:00.000Z' }),
        ]);
        expect(latest?.id).toBe('e1');
    });
});

describe('extractKustoSeed', () => {
    it('reads cluster/database from stored Kusto content', () => {
        const content = JSON.stringify({ query: 'T', clusterUrl: 'https://c.kusto.windows.net', database: 'DB', columns: [], rows: [], truncated: false });
        expect(extractKustoSeed(content)).toEqual({ clusterUrl: 'https://c.kusto.windows.net', database: 'DB' });
    });

    it('falls back to empty strings for corrupt content', () => {
        expect(extractKustoSeed('not json')).toEqual({ clusterUrl: '', database: '' });
        expect(extractKustoSeed(null)).toEqual({ clusterUrl: '', database: '' });
    });
});

describe('buildBlankKustoContent', () => {
    it('builds a blank state carrying the seed cluster/database', () => {
        const parsed = JSON.parse(buildBlankKustoContent({ clusterUrl: 'https://c', database: 'DB' }));
        expect(parsed).toEqual({ query: '', clusterUrl: 'https://c', database: 'DB', columns: [], rows: [], truncated: false });
    });

    it('defaults to empty cluster/database when no seed is given', () => {
        const parsed = JSON.parse(buildBlankKustoContent());
        expect(parsed.clusterUrl).toBe('');
        expect(parsed.database).toBe('');
        expect(parsed.query).toBe('');
    });
});
