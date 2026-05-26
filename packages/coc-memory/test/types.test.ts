/**
 * Tests for core memory types — structural guards and constant values.
 */
import { describe, it, expect } from 'vitest';
import type {
    MemoryFact,
    MemoryEpisode,
    MemoryScope,
    MemoryFactStatus,
    MemoryFactSource,
    MemoryEpisodeEventType,
} from '../src/types';
import {
    FEATURE_FLAG_COC_MEMORY,
    GLOBAL_MEMORY_SUBDIR,
    WORKSPACE_MEMORY_SUBDIR,
} from '../src/types';

// ---------------------------------------------------------------------------
// Helper: build a minimal valid MemoryFact
// ---------------------------------------------------------------------------

function buildFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
    return {
        id: 'fact-001',
        scope: 'global',
        content: 'The project uses TypeScript strict mode.',
        importance: 0.8,
        confidence: 0.9,
        status: 'active',
        tags: ['typescript', 'project'],
        source: 'explicit',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        recalledCount: 0,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('FEATURE_FLAG_COC_MEMORY', () => {
    it('has the expected constant value', () => {
        expect(FEATURE_FLAG_COC_MEMORY).toBe('cocMemoryV2Enabled');
    });
});

describe('storage path constants', () => {
    it('GLOBAL_MEMORY_SUBDIR', () => {
        expect(GLOBAL_MEMORY_SUBDIR).toBe('memory/global');
    });

    it('WORKSPACE_MEMORY_SUBDIR', () => {
        expect(WORKSPACE_MEMORY_SUBDIR).toBe('memory');
    });
});

// ---------------------------------------------------------------------------
// MemoryScope
// ---------------------------------------------------------------------------

describe('MemoryScope', () => {
    it('accepts global scope', () => {
        const scope: MemoryScope = 'global';
        expect(scope).toBe('global');
    });

    it('accepts workspace scope', () => {
        const scope: MemoryScope = 'workspace';
        expect(scope).toBe('workspace');
    });
});

// ---------------------------------------------------------------------------
// MemoryFactStatus
// ---------------------------------------------------------------------------

describe('MemoryFactStatus', () => {
    const statuses: MemoryFactStatus[] = ['active', 'review', 'rejected', 'archived'];

    it('covers all four lifecycle states', () => {
        expect(statuses).toHaveLength(4);
    });

    it.each(statuses)('status "%s" is a valid string', (s) => {
        expect(typeof s).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// MemoryFactSource
// ---------------------------------------------------------------------------

describe('MemoryFactSource', () => {
    const sources: MemoryFactSource[] = ['explicit', 'auto-extracted', 'imported'];

    it.each(sources)('source "%s" is a valid string', (s) => {
        expect(typeof s).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// MemoryFact
// ---------------------------------------------------------------------------

describe('MemoryFact', () => {
    it('constructs a minimal valid global fact', () => {
        const fact = buildFact();
        expect(fact.id).toBe('fact-001');
        expect(fact.scope).toBe('global');
        expect(fact.workspaceId).toBeUndefined();
        expect(fact.recalledCount).toBe(0);
        expect(fact.lastRecalledAt).toBeUndefined();
    });

    it('constructs a workspace-scoped fact', () => {
        const fact = buildFact({ scope: 'workspace', workspaceId: 'ws-abc123' });
        expect(fact.scope).toBe('workspace');
        expect(fact.workspaceId).toBe('ws-abc123');
    });

    it('stores Ralph provenance fields', () => {
        const fact = buildFact({
            source: 'auto-extracted',
            sourceProcessId: 'proc-xyz',
            sourceTurnIndex: 2,
            sourceRalphIteration: 3,
        });
        expect(fact.source).toBe('auto-extracted');
        expect(fact.sourceProcessId).toBe('proc-xyz');
        expect(fact.sourceTurnIndex).toBe(2);
        expect(fact.sourceRalphIteration).toBe(3);
    });

    it('importance and confidence are in [0, 1]', () => {
        const fact = buildFact({ importance: 0.5, confidence: 0.75 });
        expect(fact.importance).toBeGreaterThanOrEqual(0);
        expect(fact.importance).toBeLessThanOrEqual(1);
        expect(fact.confidence).toBeGreaterThanOrEqual(0);
        expect(fact.confidence).toBeLessThanOrEqual(1);
    });

    it('stores lastRecalledAt when provided', () => {
        const fact = buildFact({ recalledCount: 3, lastRecalledAt: '2026-06-01T00:00:00.000Z' });
        expect(fact.recalledCount).toBe(3);
        expect(fact.lastRecalledAt).toBe('2026-06-01T00:00:00.000Z');
    });
});

// ---------------------------------------------------------------------------
// MemoryEpisodeEventType
// ---------------------------------------------------------------------------

describe('MemoryEpisodeEventType', () => {
    const types: MemoryEpisodeEventType[] = ['chat-turn', 'ralph-iteration', 'note-session', 'commit-chat'];

    it.each(types)('event type "%s" is a valid string', (t) => {
        expect(typeof t).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// MemoryEpisode
// ---------------------------------------------------------------------------

describe('MemoryEpisode', () => {
    it('constructs a minimal valid episode', () => {
        const episode: MemoryEpisode = {
            id: 'ep-001',
            scope: 'global',
            processId: 'proc-001',
            summary: 'Discussed TypeScript strict-mode configuration.',
            eventType: 'chat-turn',
            createdAt: '2026-01-01T00:00:00.000Z',
            provenance: { createdBy: 'ai', version: 1 },
        };
        expect(episode.id).toBe('ep-001');
        expect(episode.workspaceId).toBeUndefined();
        expect(episode.turnIndex).toBeUndefined();
    });

    it('accepts Ralph iteration fields', () => {
        const episode: MemoryEpisode = {
            id: 'ep-002',
            scope: 'workspace',
            workspaceId: 'ws-abc123',
            processId: 'proc-002',
            ralphId: 'ralph-session-42',
            iterationIndex: 5,
            summary: 'Implemented AC-01 package skeleton.',
            eventType: 'ralph-iteration',
            createdAt: '2026-01-02T00:00:00.000Z',
            provenance: { createdBy: 'ai', model: 'claude-sonnet-4.6', version: 1 },
        };
        expect(episode.ralphId).toBe('ralph-session-42');
        expect(episode.iterationIndex).toBe(5);
    });
});
