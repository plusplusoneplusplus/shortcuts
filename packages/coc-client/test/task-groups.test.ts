import { describe, expect, it } from 'vitest';
import {
    GROUP_PIN_TYPES,
    TASK_GROUP_KIND_SPECS,
    deriveTaskGroupRef,
    getTaskGroupId,
    isGroupPinType,
    isGroupedTask,
    isTaskGroupKind,
    isTaskGroupRef,
    kindForPinType,
    normalizeTaskGroupRef,
    pinTypeForKind,
    type TaskGroupRef,
} from '../src';

describe('task-group kind registry', () => {
    it('maps every known kind to a stable pin-type and back', () => {
        for (const spec of TASK_GROUP_KIND_SPECS) {
            expect(pinTypeForKind(spec.kind)).toBe(spec.pinType);
            expect(kindForPinType(spec.pinType)).toBe(spec.kind);
        }
    });

    it('preserves the legacy pin-type strings (back-compat with persisted group-pins.json)', () => {
        expect(pinTypeForKind('ralph')).toBe('ralph-session');
        expect(pinTypeForKind('for-each')).toBe('for-each-run');
        expect(pinTypeForKind('map-reduce')).toBe('map-reduce-run');
        expect(pinTypeForKind('dream')).toBe('dream-run');
        expect(GROUP_PIN_TYPES).toEqual(['ralph-session', 'for-each-run', 'map-reduce-run', 'dream-run']);
    });

    it('recognises registered kinds and pin-types, rejects unknown ones', () => {
        expect(isTaskGroupKind('for-each')).toBe(true);
        expect(isTaskGroupKind('dream')).toBe(true);
        expect(isTaskGroupKind('nope')).toBe(false);
        expect(isTaskGroupKind(42)).toBe(false);

        expect(isGroupPinType('dream-run')).toBe(true);
        expect(isGroupPinType('for-each-run')).toBe(true);
        expect(isGroupPinType('for-each')).toBe(false); // kind, not pin-type
        expect(isGroupPinType(undefined)).toBe(false);
    });

    it('returns undefined for unknown kind/pin-type lookups', () => {
        expect(pinTypeForKind('mystery')).toBeUndefined();
        expect(kindForPinType('mystery-run')).toBeUndefined();
    });
});

describe('isTaskGroupRef / normalizeTaskGroupRef', () => {
    it('accepts a structurally valid ref', () => {
        expect(isTaskGroupRef({ kind: 'dream', groupId: 'run-1', role: 'child' })).toBe(true);
        expect(isTaskGroupRef({ kind: 'for-each', groupId: 'r', role: 'anchor' })).toBe(true);
    });

    it('rejects malformed refs', () => {
        expect(isTaskGroupRef(null)).toBe(false);
        expect(isTaskGroupRef({ kind: 'dream', groupId: 'run-1' })).toBe(false); // no role
        expect(isTaskGroupRef({ kind: '', groupId: 'run-1', role: 'child' })).toBe(false);
        expect(isTaskGroupRef({ kind: 'dream', groupId: '   ', role: 'child' })).toBe(false);
        expect(isTaskGroupRef({ kind: 'dream', groupId: 'run-1', role: 'parent' })).toBe(false);
    });

    it('trims strings and keeps valid optional fields', () => {
        const ref = normalizeTaskGroupRef({ kind: ' dream ', groupId: ' run-1 ', role: 'child', itemId: ' a ', order: 3 });
        expect(ref).toEqual({ kind: 'dream', groupId: 'run-1', role: 'child', itemId: 'a', order: 3 });
    });

    it('drops malformed optional fields', () => {
        const ref = normalizeTaskGroupRef({ kind: 'dream', groupId: 'run-1', role: 'child', itemId: '   ', order: Number.NaN });
        expect(ref).toEqual({ kind: 'dream', groupId: 'run-1', role: 'child' });
    });

    it('returns undefined for an invalid value', () => {
        expect(normalizeTaskGroupRef({ kind: 'dream' })).toBeUndefined();
    });
});

describe('deriveTaskGroupRef — explicit unified ref', () => {
    it('reads an explicit ref from a live task payload context', () => {
        const task = { payload: { context: { group: { kind: 'dream', groupId: 'run-7', role: 'anchor' } } } };
        expect(deriveTaskGroupRef(task)).toEqual({ kind: 'dream', groupId: 'run-7', role: 'anchor' });
    });

    it('reads an explicit ref from a top-level history field', () => {
        const item = { group: { kind: 'map-reduce', groupId: 'run-9', role: 'child', itemId: 'i2' } };
        expect(deriveTaskGroupRef(item)).toEqual({ kind: 'map-reduce', groupId: 'run-9', role: 'child', itemId: 'i2' });
    });

    it('prefers an explicit ref over a legacy per-feature context', () => {
        const task = {
            payload: {
                context: {
                    group: { kind: 'dream', groupId: 'explicit', role: 'child' },
                    forEach: { runId: 'legacy', kind: 'child' },
                },
            },
        };
        expect(deriveTaskGroupRef(task)?.groupId).toBe('explicit');
        expect(deriveTaskGroupRef(task)?.kind).toBe('dream');
    });
});

describe('deriveTaskGroupRef — legacy for-each', () => {
    it('maps a child task (live payload context)', () => {
        const task = { payload: { context: { forEach: { workspaceId: 'ws', runId: 'run-1', itemId: 'i1', kind: 'child' } } } };
        expect(deriveTaskGroupRef(task)).toEqual({ kind: 'for-each', groupId: 'run-1', role: 'child', itemId: 'i1' });
    });

    it('maps the generation anchor', () => {
        const task = { payload: { context: { forEach: { workspaceId: 'ws', runId: 'run-1', kind: 'generation' } } } };
        expect(deriveTaskGroupRef(task)).toEqual({ kind: 'for-each', groupId: 'run-1', role: 'anchor' });
    });

    it('maps a history item (top-level forEach field)', () => {
        const item = { forEach: { workspaceId: 'ws', runId: 'run-2', kind: 'child', itemId: 'i9' } };
        expect(deriveTaskGroupRef(item)).toEqual({ kind: 'for-each', groupId: 'run-2', role: 'child', itemId: 'i9' });
    });

    it('ignores a for-each context with no runId', () => {
        expect(deriveTaskGroupRef({ forEach: { workspaceId: 'ws', kind: 'child' } })).toBeUndefined();
    });
});

describe('deriveTaskGroupRef — legacy map-reduce', () => {
    it('maps the generation anchor', () => {
        const task = { payload: { context: { mapReduce: { runId: 'run-3', kind: 'generation' } } } };
        expect(deriveTaskGroupRef(task)).toEqual({ kind: 'map-reduce', groupId: 'run-3', role: 'anchor' });
    });

    it('maps a map/reduce child phase with itemId', () => {
        const task = { payload: { context: { mapReduce: { runId: 'run-3', phase: 'map', itemId: 'm1' } } } };
        expect(deriveTaskGroupRef(task)).toEqual({ kind: 'map-reduce', groupId: 'run-3', role: 'child', itemId: 'm1' });
    });
});

describe('deriveTaskGroupRef — legacy ralph', () => {
    it('maps the grilling process to the anchor', () => {
        const task = { payload: { context: { ralph: { sessionId: 's1', phase: 'grilling' } } } };
        expect(deriveTaskGroupRef(task)).toEqual({ kind: 'ralph', groupId: 's1', role: 'anchor' });
    });

    it('maps an executing iteration to a child', () => {
        const task = { payload: { context: { ralph: { sessionId: 's1', phase: 'executing' } } } };
        expect(deriveTaskGroupRef(task)).toEqual({ kind: 'ralph', groupId: 's1', role: 'child' });
    });

    it('maps a history item (top-level ralph field)', () => {
        const item = { ralph: { sessionId: 's2', phase: 'executing' } };
        expect(deriveTaskGroupRef(item)).toEqual({ kind: 'ralph', groupId: 's2', role: 'child' });
    });
});

describe('deriveTaskGroupRef — legacy dream', () => {
    it('maps an internal step from process metadata.dreamStep', () => {
        const proc = { metadata: { dreamStep: { runId: 'dream-1', kind: 'analyzer' } } };
        expect(deriveTaskGroupRef(proc)).toEqual({ kind: 'dream', groupId: 'dream-1', role: 'child', itemId: 'analyzer' });
    });

    it('maps the critic step', () => {
        const proc = { metadata: { dreamStep: { runId: 'dream-1', kind: 'critic' } } };
        expect(deriveTaskGroupRef(proc)).toEqual({ kind: 'dream', groupId: 'dream-1', role: 'child', itemId: 'critic' });
    });

    it('maps a history item dream field (forwarded from metadata.dreamStep)', () => {
        const item = { dream: { runId: 'dream-2', kind: 'critic', purpose: 'Dream Critic', readOnly: true } };
        expect(deriveTaskGroupRef(item)).toEqual({ kind: 'dream', groupId: 'dream-2', role: 'child', itemId: 'critic' });
    });
});

describe('deriveTaskGroupRef — non-grouped & invalid input', () => {
    it('returns undefined for an unrelated task', () => {
        expect(deriveTaskGroupRef({ payload: { context: {} } })).toBeUndefined();
        expect(deriveTaskGroupRef({ id: 'plain-chat' })).toBeUndefined();
    });

    it('returns undefined for null/undefined/non-object input', () => {
        expect(deriveTaskGroupRef(null)).toBeUndefined();
        expect(deriveTaskGroupRef(undefined)).toBeUndefined();
        expect(deriveTaskGroupRef('nope' as unknown as Record<string, unknown>)).toBeUndefined();
    });
});

describe('deriveTaskGroupRef — convenience helpers', () => {
    it('getTaskGroupId returns the group id or undefined', () => {
        const task = { payload: { context: { forEach: { runId: 'run-1', kind: 'child' } } } };
        expect(getTaskGroupId(task)).toBe('run-1');
        expect(getTaskGroupId({ id: 'plain' })).toBeUndefined();
    });

    it('isGroupedTask reflects membership', () => {
        const ref: TaskGroupRef = { kind: 'dream', groupId: 'd1', role: 'child' };
        expect(isGroupedTask({ group: ref })).toBe(true);
        expect(isGroupedTask({ id: 'plain' })).toBe(false);
    });
});
