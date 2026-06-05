/**
 * Tests for the Ralph context accessors in `task-types.ts`.
 *
 * Covers the single-source-of-truth contract for reading Ralph orchestration
 * context from queue tasks and AIProcess history items, plus the canonical
 * payload→metadata projection used by the lifecycle runner.
 */

import { describe, it, expect } from 'vitest';
import {
    getForEachContext,
    getRalphContext,
    isForEachGenerationContext,
    isRalphTask,
    serializeForEachMetadata,
    serializeRalphMetadata,
    type ForEachGenerationContext,
    type RalphContext,
} from '../../../src/server/tasks/task-types';

const sampleRalph: RalphContext = {
    originalGoal: 'Refactor the foo module',
    sessionId: 'sess-1',
    currentIteration: 2,
    maxIterations: 5,
    phase: 'executing',
};

describe('getRalphContext', () => {
    it('returns null when source is null/undefined', () => {
        expect(getRalphContext(null)).toBeNull();
        expect(getRalphContext(undefined)).toBeNull();
    });

    it('returns null when neither payload.context.ralph nor metadata.ralph is present', () => {
        expect(getRalphContext({})).toBeNull();
        expect(getRalphContext({ payload: { kind: 'chat' } })).toBeNull();
        expect(getRalphContext({ metadata: {} })).toBeNull();
        expect(getRalphContext({ payload: { context: {} }, metadata: {} })).toBeNull();
    });

    it('reads from payload.context.ralph when present', () => {
        const result = getRalphContext({
            payload: { kind: 'chat', context: { ralph: sampleRalph } },
        });
        expect(result).toBe(sampleRalph);
    });

    it('falls back to metadata.ralph when payload is absent', () => {
        const result = getRalphContext({ metadata: { ralph: sampleRalph } });
        expect(result).toBe(sampleRalph);
    });

    it('falls back to metadata.ralph when payload exists but has no ralph context', () => {
        const result = getRalphContext({
            payload: { kind: 'chat', context: { skills: ['impl'] } },
            metadata: { ralph: sampleRalph },
        });
        expect(result).toBe(sampleRalph);
    });

    it('payload wins when both sources are present (precedence)', () => {
        const otherRalph: RalphContext = { ...sampleRalph, phase: 'grilling', sessionId: 'sess-2' };
        const result = getRalphContext({
            payload: { kind: 'chat', context: { ralph: sampleRalph } },
            metadata: { ralph: otherRalph },
        });
        expect(result).toBe(sampleRalph);
        expect(result?.sessionId).toBe('sess-1');
    });

    it('ignores non-object ralph values defensively', () => {
        expect(getRalphContext({ payload: { context: { ralph: 'not-an-object' } } })).toBeNull();
        expect(getRalphContext({ metadata: { ralph: 42 } })).toBeNull();
    });
});

describe('isRalphTask', () => {
    it('returns false when no ralph context is present', () => {
        expect(isRalphTask(null)).toBe(false);
        expect(isRalphTask({})).toBe(false);
        expect(isRalphTask({ payload: { kind: 'chat' } })).toBe(false);
    });

    it('returns true when ralph context lives on the payload', () => {
        expect(isRalphTask({ payload: { kind: 'chat', context: { ralph: sampleRalph } } })).toBe(true);
    });

    it('returns true when ralph context lives on metadata', () => {
        expect(isRalphTask({ metadata: { ralph: sampleRalph } })).toBe(true);
    });
});

describe('serializeRalphMetadata', () => {
    it('returns the ralph context for a mode=ralph chat payload', () => {
        const payload = {
            kind: 'chat',
            mode: 'ralph',
            prompt: 'go',
            context: { ralph: sampleRalph },
        };
        expect(serializeRalphMetadata(payload)).toBe(sampleRalph);
    });

    it('returns the ralph context for a mode=ask grilling-phase chat payload', () => {
        const grillingRalph: RalphContext = { ...sampleRalph, phase: 'grilling' };
        const payload = {
            kind: 'chat',
            mode: 'ask',
            prompt: 'grill me',
            context: { ralph: grillingRalph, skills: ['grill-me'] },
        };
        expect(serializeRalphMetadata(payload)).toBe(grillingRalph);
    });

    it('returns undefined for chat payloads without ralph context', () => {
        const payload = { kind: 'chat', mode: 'ask', prompt: 'hi', context: { skills: ['impl'] } };
        expect(serializeRalphMetadata(payload)).toBeUndefined();
    });

    it('returns undefined for chat payloads with no context object at all', () => {
        expect(serializeRalphMetadata({ kind: 'chat', mode: 'ask', prompt: 'hi' })).toBeUndefined();
    });

    it('returns undefined for non-chat payloads even when they carry a ralph-shaped object', () => {
        const payload = {
            kind: 'run-workflow',
            workflowPath: '/tmp/wf.yaml',
            workingDirectory: '/tmp',
            context: { ralph: sampleRalph },
        };
        expect(serializeRalphMetadata(payload)).toBeUndefined();
    });

    it('returns undefined for null/undefined/non-object inputs', () => {
        expect(serializeRalphMetadata(null)).toBeUndefined();
        expect(serializeRalphMetadata(undefined)).toBeUndefined();
        expect(serializeRalphMetadata('string')).toBeUndefined();
        expect(serializeRalphMetadata(42)).toBeUndefined();
    });
});

const sampleForEachGeneration: ForEachGenerationContext = {
    kind: 'generation',
    workspaceId: 'ws-1',
    generationId: 'for-each-gen-1',
    childMode: 'ask',
    originalRequest: 'Split this work into items',
    status: 'draft',
};

describe('For Each context accessors', () => {
    it('reads generation context from payload or metadata', () => {
        expect(getForEachContext({
            payload: { kind: 'chat', context: { forEach: sampleForEachGeneration } },
        })).toBe(sampleForEachGeneration);
        expect(getForEachContext({ metadata: { forEach: sampleForEachGeneration } })).toBe(sampleForEachGeneration);
    });

    it('identifies generation context without treating child context as generation', () => {
        expect(isForEachGenerationContext(sampleForEachGeneration)).toBe(true);
        expect(isForEachGenerationContext({
            workspaceId: 'ws-1',
            runId: 'run-1',
            itemId: 'item-1',
            childMode: 'ask',
        })).toBe(false);
    });

    it('serializes For Each metadata from chat payload context', () => {
        expect(serializeForEachMetadata({
            kind: 'chat',
            mode: 'ask',
            prompt: 'Split',
            context: { forEach: sampleForEachGeneration },
        })).toBe(sampleForEachGeneration);
    });
});
