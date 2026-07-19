/**
 * Tests for Loop & Wakeup LLM Tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
    createLoopTool,
    createScheduleWakeupTool,
    parseDuration,
} from '../../src/server/llm-tools/loop-tools';
import type { LoopToolDeps, WakeupToolDeps } from '../../src/server/llm-tools/loop-tools';
import { LoopStore } from '../../src/server/loops/loop-store';
import type { LoopExecutor } from '../../src/server/loops/loop-executor';
import { MIN_LOOP_INTERVAL_MS, MIN_WAKEUP_DELAY_MS } from '../../src/server/loops/loop-types';

// ============================================================================
// parseDuration
// ============================================================================

describe('parseDuration', () => {
    it('parses seconds', () => {
        expect(parseDuration('30s')).toBe(30000);
        expect(parseDuration('1sec')).toBe(1000);
        expect(parseDuration('2seconds')).toBe(2000);
    });

    it('parses minutes', () => {
        expect(parseDuration('5m')).toBe(300000);
        expect(parseDuration('1min')).toBe(60000);
        expect(parseDuration('2minutes')).toBe(120000);
    });

    it('parses hours', () => {
        expect(parseDuration('1h')).toBe(3600000);
        expect(parseDuration('2hr')).toBe(7200000);
        expect(parseDuration('1.5hours')).toBe(5400000);
    });

    it('parses days', () => {
        expect(parseDuration('1d')).toBe(86400000);
        expect(parseDuration('3days')).toBe(259200000);
    });

    it('parses milliseconds', () => {
        expect(parseDuration('500ms')).toBe(500);
        expect(parseDuration('1000milliseconds')).toBe(1000);
    });

    it('parses raw numbers', () => {
        expect(parseDuration(5000)).toBe(5000);
        expect(parseDuration('5000')).toBe(5000);
    });

    it('handles decimal values', () => {
        expect(parseDuration('1.5h')).toBe(5400000);
        expect(parseDuration('0.5m')).toBe(30000);
    });

    it('is case-insensitive', () => {
        expect(parseDuration('30S')).toBe(30000);
        expect(parseDuration('5M')).toBe(300000);
    });

    it('trims whitespace', () => {
        expect(parseDuration('  30s  ')).toBe(30000);
    });

    it('throws on invalid input', () => {
        expect(() => parseDuration('abc')).toThrow('Invalid duration');
        expect(() => parseDuration('')).toThrow('Invalid duration');
        expect(() => parseDuration('30x')).toThrow('Invalid duration');
    });
});

// ============================================================================
// Helpers
// ============================================================================

function makeLoopToolDeps(overrides: Partial<LoopToolDeps> = {}): LoopToolDeps {
    const db = new Database(':memory:');
    const store = new LoopStore(db);
    const executor: Partial<LoopExecutor> = {
        armTimer: vi.fn(),
        disarmTimer: vi.fn(),
    };

    return {
        store,
        executor: executor as LoopExecutor,
        processId: 'proc-123',
        resolveWorkspaceId: vi.fn().mockResolvedValue('ws-test'),
        ...overrides,
    };
}

function makeLoopHandler(deps: LoopToolDeps): (args: any) => Promise<any> {
    const { tool } = createLoopTool(deps);
    return tool.handler as any;
}

function makeWakeupToolDeps(overrides: Partial<WakeupToolDeps> = {}): WakeupToolDeps {
    return {
        executor: { armTimer: vi.fn(), disarmTimer: vi.fn() } as any,
        processId: 'proc-123',
        resolveWorkspaceId: vi.fn().mockResolvedValue('ws-abc'),
        enqueueWakeup: vi.fn(),
        ...overrides,
    };
}

// ============================================================================
// loop tool — action dispatch
// ============================================================================

describe('createLoopTool action dispatch', () => {
    it('returns an error for an unknown action', async () => {
        const handler = makeLoopHandler(makeLoopToolDeps());
        const result = await handler({ action: 'pause' });
        expect(result.error).toContain('Unknown loop action');
        expect(result.error).toContain('create, cancel, list');
    });

    it('create action rejects missing required fields', async () => {
        const handler = makeLoopHandler(makeLoopToolDeps());
        expect((await handler({ action: 'create' })).error).toContain('requires `description`, `interval`, and `prompt`');
        expect((await handler({ action: 'create', description: 'd', interval: '1m' })).error)
            .toContain('requires `description`, `interval`, and `prompt`');
        expect((await handler({ action: 'create', description: '', interval: '1m', prompt: 'p' })).error)
            .toContain('requires `description`, `interval`, and `prompt`');
    });

    it('cancel action rejects missing loopId', async () => {
        const handler = makeLoopHandler(makeLoopToolDeps());
        const result = await handler({ action: 'cancel' });
        expect(result.error).toContain('requires `loopId`');
    });
});

// ============================================================================
// loop tool — create
// ============================================================================

describe('loop tool create action', () => {
    let deps: LoopToolDeps;
    let handler: (args: any) => Promise<any>;

    beforeEach(() => {
        deps = makeLoopToolDeps();
        handler = makeLoopHandler(deps);
    });

    it('creates a loop with valid interval string', async () => {
        const result = await handler({
            action: 'create',
            description: 'Monitor build',
            interval: '30s',
            prompt: 'Check build status',
        });

        expect(result.created).toBe(true);
        expect(result.loopId).toMatch(/^loop_/);
        expect(result.intervalMs).toBe(30000);
        expect(result.nextTickAt).toBeDefined();
        expect(result.expiresAt).toBeDefined();
        expect(deps.executor.armTimer).toHaveBeenCalledOnce();
    });

    it('creates a loop with numeric interval (ms)', async () => {
        const result = await handler({
            action: 'create',
            description: 'Test',
            interval: 60000,
            prompt: 'Check',
        });

        expect(result.created).toBe(true);
        expect(result.intervalMs).toBe(60000);
    });

    it('rejects interval below minimum', async () => {
        const result = await handler({
            action: 'create',
            description: 'Too fast',
            interval: '5s',
            prompt: 'Check',
        });

        expect(result.error).toContain('Minimum loop interval');
    });

    it('rejects invalid interval string', async () => {
        const result = await handler({
            action: 'create',
            description: 'Bad',
            interval: 'invalid',
            prompt: 'Check',
        });

        expect(result.error).toContain('Invalid duration');
    });

    it('persists the loop in the store', async () => {
        await handler({
            action: 'create',
            description: 'Persist test',
            interval: '1m',
            prompt: 'Check',
        });

        const loops = deps.store.getByProcess('proc-123');
        expect(loops).toHaveLength(1);
        expect(loops[0].description).toBe('Persist test');
        expect(loops[0].status).toBe('active');
    });

    it('passes custom TTL', async () => {
        const result = await handler({
            action: 'create',
            description: 'TTL test',
            interval: '1m',
            prompt: 'Check',
            ttl: '12h',
        });

        expect(result.created).toBe(true);
        const loop = deps.store.getByProcess('proc-123')[0];
        const ttlMs = new Date(loop.expiresAt).getTime() - new Date(loop.createdAt).getTime();
        expect(ttlMs).toBe(12 * 60 * 60 * 1000);
    });

    it('passes model override', async () => {
        await handler({
            action: 'create',
            description: 'Model test',
            interval: '1m',
            prompt: 'Check',
            model: 'gpt-4',
        });

        const loop = deps.store.getByProcess('proc-123')[0];
        expect(loop.model).toBe('gpt-4');
    });

    it('resolves and persists workspaceId at creation', async () => {
        const result = await handler({
            action: 'create',
            description: 'Workspace test',
            interval: '1m',
            prompt: 'Check workspace',
        });

        expect(result.created).toBe(true);
        const loop = deps.store.getByProcess('proc-123')[0];
        expect(loop.workspaceId).toBe('ws-test');
        expect(deps.resolveWorkspaceId).toHaveBeenCalledWith('proc-123');
    });

    it('creates loop even if resolveWorkspaceId returns undefined', async () => {
        deps = makeLoopToolDeps({
            resolveWorkspaceId: vi.fn().mockResolvedValue(undefined),
        });
        handler = makeLoopHandler(deps);

        const result = await handler({
            action: 'create',
            description: 'No workspace',
            interval: '1m',
            prompt: 'Check',
        });

        expect(result.created).toBe(true);
        const loop = deps.store.getByProcess('proc-123')[0];
        expect(loop.workspaceId).toBeUndefined();
    });

    it('rejects invalid TTL', async () => {
        const result = await handler({
            action: 'create',
            description: 'Bad TTL',
            interval: '1m',
            prompt: 'Check',
            ttl: 'forever',
        });

        expect(result.error).toContain('Invalid TTL');
    });
});

// ============================================================================
// loop tool — cancel
// ============================================================================

describe('loop tool cancel action', () => {
    let deps: LoopToolDeps;
    let handler: (args: any) => Promise<any>;

    beforeEach(() => {
        deps = makeLoopToolDeps();
        handler = makeLoopHandler(deps);
    });

    it('cancels an active loop', async () => {
        const createResult = await handler({
            action: 'create',
            description: 'To cancel',
            interval: '1m',
            prompt: 'Check',
        });

        const result = await handler({ action: 'cancel', loopId: createResult.loopId });
        expect(result.cancelled).toBe(true);

        const loop = deps.store.getById(createResult.loopId);
        expect(loop!.status).toBe('cancelled');
        expect(loop!.nextTickAt).toBeNull();
    });

    it('returns error for unknown loop', async () => {
        const result = await handler({ action: 'cancel', loopId: 'nonexistent' });
        expect(result.error).toContain('Loop not found');
    });

    it('returns error for loop belonging to different process', async () => {
        // Create a loop with different processId
        const otherDeps = makeLoopToolDeps({ processId: 'other-proc' });
        const otherHandler = makeLoopHandler(otherDeps);
        const createResult = await otherHandler({
            action: 'create',
            description: 'Other proc',
            interval: '1m',
            prompt: 'Check',
        });

        // Now try to cancel from our process — but we need to share the store
        const sharedDeps = makeLoopToolDeps({ store: otherDeps.store });
        const sharedHandler = makeLoopHandler(sharedDeps);
        const result = await sharedHandler({ action: 'cancel', loopId: createResult.loopId });
        expect(result.error).toContain('different conversation');
    });

    it('returns alreadyCancelled for already cancelled loop', async () => {
        const createResult = await handler({
            action: 'create',
            description: 'Cancel twice',
            interval: '1m',
            prompt: 'Check',
        });

        await handler({ action: 'cancel', loopId: createResult.loopId });
        const result = await handler({ action: 'cancel', loopId: createResult.loopId });
        expect(result.alreadyCancelled).toBe(true);
    });
});

// ============================================================================
// loop tool — list
// ============================================================================

describe('loop tool list action', () => {
    let deps: LoopToolDeps;
    let handler: (args: any) => Promise<any>;

    beforeEach(() => {
        deps = makeLoopToolDeps();
        handler = makeLoopHandler(deps);
    });

    it('lists all loops for the process', async () => {
        await handler({ action: 'create', description: 'Loop 1', interval: '1m', prompt: 'P1' });
        await handler({ action: 'create', description: 'Loop 2', interval: '5m', prompt: 'P2' });

        const result = await handler({ action: 'list' });
        expect(result.total).toBe(2);
        expect(result.loops).toHaveLength(2);
        expect(result.loops[0]).toHaveProperty('id');
        expect(result.loops[0]).toHaveProperty('description');
        expect(result.loops[0]).toHaveProperty('status');
    });

    it('filters by status', async () => {
        await handler({ action: 'create', description: 'Active', interval: '1m', prompt: 'P1' });
        await handler({ action: 'create', description: 'To cancel', interval: '5m', prompt: 'P2' });

        // Cancel the second one
        const loops = deps.store.getByProcess('proc-123');
        const secondLoop = loops.find(l => l.description === 'To cancel')!;
        await handler({ action: 'cancel', loopId: secondLoop.id });

        const activeResult = await handler({ action: 'list', status: 'active' });
        expect(activeResult.total).toBe(1);
        expect(activeResult.loops[0].description).toBe('Active');

        const cancelledResult = await handler({ action: 'list', status: 'cancelled' });
        expect(cancelledResult.total).toBe(1);
        expect(cancelledResult.loops[0].description).toBe('To cancel');
    });

    it('returns empty list for process with no loops', async () => {
        const result = await handler({ action: 'list' });
        expect(result.total).toBe(0);
        expect(result.loops).toHaveLength(0);
    });

    it('does not list loops from other processes', async () => {
        // Create a loop on a different process
        const otherDeps = makeLoopToolDeps({ processId: 'other-proc' });
        const otherHandler = makeLoopHandler(otherDeps);
        await otherHandler({ action: 'create', description: 'Other', interval: '1m', prompt: 'P' });

        // Share the store but query from our process
        const sharedDeps: LoopToolDeps = { ...deps, store: otherDeps.store };
        const sharedHandler = makeLoopHandler(sharedDeps);
        const result = await sharedHandler({ action: 'list' });
        expect(result.total).toBe(0);
    });
});

// ============================================================================
// scheduleWakeup tool
// ============================================================================

describe('createScheduleWakeupTool', () => {
    let deps: WakeupToolDeps;
    let handler: (args: any) => Promise<any>;

    beforeEach(() => {
        deps = makeWakeupToolDeps();
        const { tool } = createScheduleWakeupTool(deps);
        handler = tool.handler as any;
    });

    it('schedules a wakeup with valid delay string', async () => {
        const result = await handler({
            prompt: 'Check back on this',
            delay: '30s',
        });

        expect(result.scheduled).toBe(true);
        expect(result.wakeupId).toMatch(/^wakeup_/);
        expect(result.delayMs).toBe(30000);
        expect(result.firesAt).toBeDefined();
        expect(deps.enqueueWakeup).toHaveBeenCalledOnce();
        expect(deps.enqueueWakeup).toHaveBeenCalledWith(expect.objectContaining({
            processId: 'proc-123',
            prompt: 'Check back on this',
            delayMs: 30000,
            workspaceId: 'ws-abc',
        }));
    });

    it('schedules a wakeup with numeric delay', async () => {
        const result = await handler({
            prompt: 'Check',
            delay: 5000,
        });

        expect(result.scheduled).toBe(true);
        expect(result.delayMs).toBe(5000);
    });

    it('rejects delay below minimum', async () => {
        const result = await handler({
            prompt: 'Too fast',
            delay: '500ms',
        });

        expect(result.error).toContain('Minimum wakeup delay');
    });

    it('rejects invalid delay string', async () => {
        const result = await handler({
            prompt: 'Bad',
            delay: 'soon',
        });

        expect(result.error).toContain('Invalid duration');
    });

    it('passes model override to enqueue', async () => {
        await handler({
            prompt: 'Check',
            delay: '5s',
            model: 'gpt-4',
        });

        expect(deps.enqueueWakeup).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-4',
        }));
    });

    it('resolves workspace ID before enqueueing', async () => {
        await handler({ prompt: 'Check', delay: '5s' });
        expect(deps.resolveWorkspaceId).toHaveBeenCalledWith('proc-123');
    });
});

// ============================================================================
// Tool metadata
// ============================================================================

describe('tool metadata', () => {
    it('loop tool has correct name and requires action', () => {
        const deps = makeLoopToolDeps();
        const { tool } = createLoopTool(deps);
        expect(tool.name).toBe('loop');
        const params = tool.parameters as any;
        expect(params.required).toEqual(['action']);
        expect(params.properties.action.enum).toEqual(['create', 'cancel', 'list']);
    });

    it('scheduleWakeup tool has correct name', () => {
        const deps = makeWakeupToolDeps();
        const { tool } = createScheduleWakeupTool(deps);
        expect(tool.name).toBe('scheduleWakeup');
    });
});

describe('loop tool event emission', () => {
    it('create emits loop-created with the new loop', async () => {
        const emit = vi.fn();
        const deps = makeLoopToolDeps({ emit });
        const handler = makeLoopHandler(deps);
        const result: any = await handler({ action: 'create', description: 'd', interval: '30s', prompt: 'p' });
        expect(result.created).toBe(true);
        expect(emit).toHaveBeenCalledTimes(1);
        const evt = emit.mock.calls[0][0];
        expect(evt.type).toBe('loop-created');
        expect(evt.loop.id).toBe(result.loopId);
        expect(evt.loop.processId).toBe('proc-123');
    });

    it('cancel emits loop-cancelled', async () => {
        const emit = vi.fn();
        const deps = makeLoopToolDeps({ emit });
        const handler = makeLoopHandler(deps);
        const createRes: any = await handler({ action: 'create', description: 'd', interval: '30s', prompt: 'p' });
        emit.mockClear();
        const cancelRes: any = await handler({ action: 'cancel', loopId: createRes.loopId });
        expect(cancelRes.cancelled).toBe(true);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0][0].type).toBe('loop-cancelled');
        expect(emit.mock.calls[0][0].loop.status).toBe('cancelled');
    });

    it('does not throw when emit throws', async () => {
        const emit = vi.fn().mockImplementation(() => { throw new Error('boom'); });
        const deps = makeLoopToolDeps({ emit });
        const handler = makeLoopHandler(deps);
        const result: any = await handler({ action: 'create', description: 'd', interval: '30s', prompt: 'p' });
        expect(result.created).toBe(true);
    });

    it('works without emit (backwards compatible)', async () => {
        const deps = makeLoopToolDeps();
        const handler = makeLoopHandler(deps);
        const result: any = await handler({ action: 'create', description: 'd', interval: '30s', prompt: 'p' });
        expect(result.created).toBe(true);
    });
});
