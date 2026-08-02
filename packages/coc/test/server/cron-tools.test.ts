/**
 * Tests for Cron & Wakeup LLM Tools
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
    createCronTool,
    createScheduleWakeupTool,
    parseDuration,
} from '../../src/server/llm-tools/cron-tools';
import type { CronToolDeps, WakeupToolDeps } from '../../src/server/llm-tools/cron-tools';
import { CronStore } from '../../src/server/cron/cron-store';
import type { CronExecutor } from '../../src/server/cron/cron-executor';
import { MIN_CRON_INTERVAL_MS, MIN_WAKEUP_DELAY_MS } from '../../src/server/cron/cron-types';

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

function makeCronToolDeps(overrides: Partial<CronToolDeps> = {}): CronToolDeps {
    const db = new Database(':memory:');
    const store = new CronStore(db);
    const executor: Partial<CronExecutor> = {
        armTimer: vi.fn(),
        disarmTimer: vi.fn(),
    };

    return {
        store,
        executor: executor as CronExecutor,
        processId: 'proc-123',
        resolveWorkspaceId: vi.fn().mockResolvedValue('ws-test'),
        ...overrides,
    };
}

function makeCronHandler(deps: CronToolDeps): (args: any) => Promise<any> {
    const { tool } = createCronTool(deps);
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
// cron tool — action dispatch
// ============================================================================

describe('createCronTool action dispatch', () => {
    it('returns an error for an unknown action', async () => {
        const handler = makeCronHandler(makeCronToolDeps());
        const result = await handler({ action: 'pause' });
        expect(result.error).toContain('Unknown cron action');
        expect(result.error).toContain('create, cancel, list');
    });

    it('create action rejects missing required fields', async () => {
        const handler = makeCronHandler(makeCronToolDeps());
        expect((await handler({ action: 'create' })).error).toContain('requires `description`, `interval`, and `prompt`');
        expect((await handler({ action: 'create', description: 'd', interval: '1m' })).error)
            .toContain('requires `description`, `interval`, and `prompt`');
        expect((await handler({ action: 'create', description: '', interval: '1m', prompt: 'p' })).error)
            .toContain('requires `description`, `interval`, and `prompt`');
    });

    it('cancel action rejects missing cronId', async () => {
        const handler = makeCronHandler(makeCronToolDeps());
        const result = await handler({ action: 'cancel' });
        expect(result.error).toContain('requires `cronId`');
    });
});

// ============================================================================
// cron tool — create
// ============================================================================

describe('cron tool create action', () => {
    let deps: CronToolDeps;
    let handler: (args: any) => Promise<any>;

    beforeEach(() => {
        deps = makeCronToolDeps();
        handler = makeCronHandler(deps);
    });

    it('creates a cron with valid interval string', async () => {
        const result = await handler({
            action: 'create',
            description: 'Monitor build',
            interval: '30s',
            prompt: 'Check build status',
        });

        expect(result.created).toBe(true);
        expect(result.cronId).toMatch(/^cron_/);
        expect(result.intervalMs).toBe(30000);
        expect(result.nextTickAt).toBeDefined();
        expect(result.expiresAt).toBeDefined();
        expect(deps.executor.armTimer).toHaveBeenCalledOnce();
    });

    it('creates a cron with numeric interval (ms)', async () => {
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

        expect(result.error).toContain('Minimum cron interval');
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

    it('persists the cron in the store', async () => {
        await handler({
            action: 'create',
            description: 'Persist test',
            interval: '1m',
            prompt: 'Check',
        });

        const crons = deps.store.getByProcess('proc-123');
        expect(crons).toHaveLength(1);
        expect(crons[0].description).toBe('Persist test');
        expect(crons[0].status).toBe('active');
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
        const cron = deps.store.getByProcess('proc-123')[0];
        const ttlMs = new Date(cron.expiresAt).getTime() - new Date(cron.createdAt).getTime();
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

        const cron = deps.store.getByProcess('proc-123')[0];
        expect(cron.model).toBe('gpt-4');
    });

    it('resolves and persists workspaceId at creation', async () => {
        const result = await handler({
            action: 'create',
            description: 'Workspace test',
            interval: '1m',
            prompt: 'Check workspace',
        });

        expect(result.created).toBe(true);
        const cron = deps.store.getByProcess('proc-123')[0];
        expect(cron.workspaceId).toBe('ws-test');
        expect(deps.resolveWorkspaceId).toHaveBeenCalledWith('proc-123');
    });

    it('creates cron even if resolveWorkspaceId returns undefined', async () => {
        deps = makeCronToolDeps({
            resolveWorkspaceId: vi.fn().mockResolvedValue(undefined),
        });
        handler = makeCronHandler(deps);

        const result = await handler({
            action: 'create',
            description: 'No workspace',
            interval: '1m',
            prompt: 'Check',
        });

        expect(result.created).toBe(true);
        const cron = deps.store.getByProcess('proc-123')[0];
        expect(cron.workspaceId).toBeUndefined();
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
// cron tool — cancel
// ============================================================================

describe('cron tool cancel action', () => {
    let deps: CronToolDeps;
    let handler: (args: any) => Promise<any>;

    beforeEach(() => {
        deps = makeCronToolDeps();
        handler = makeCronHandler(deps);
    });

    it('cancels an active cron', async () => {
        const createResult = await handler({
            action: 'create',
            description: 'To cancel',
            interval: '1m',
            prompt: 'Check',
        });

        const result = await handler({ action: 'cancel', cronId: createResult.cronId });
        expect(result.cancelled).toBe(true);

        const cron = deps.store.getById(createResult.cronId);
        expect(cron!.status).toBe('cancelled');
        expect(cron!.nextTickAt).toBeNull();
    });

    it('returns error for unknown cron', async () => {
        const result = await handler({ action: 'cancel', cronId: 'nonexistent' });
        expect(result.error).toContain('Cron not found');
    });

    it('returns error for cron belonging to different process', async () => {
        // Create a cron with different processId
        const otherDeps = makeCronToolDeps({ processId: 'other-proc' });
        const otherHandler = makeCronHandler(otherDeps);
        const createResult = await otherHandler({
            action: 'create',
            description: 'Other proc',
            interval: '1m',
            prompt: 'Check',
        });

        // Now try to cancel from our process — but we need to share the store
        const sharedDeps = makeCronToolDeps({ store: otherDeps.store });
        const sharedHandler = makeCronHandler(sharedDeps);
        const result = await sharedHandler({ action: 'cancel', cronId: createResult.cronId });
        expect(result.error).toContain('different conversation');
    });

    it('returns alreadyCancelled for already cancelled cron', async () => {
        const createResult = await handler({
            action: 'create',
            description: 'Cancel twice',
            interval: '1m',
            prompt: 'Check',
        });

        await handler({ action: 'cancel', cronId: createResult.cronId });
        const result = await handler({ action: 'cancel', cronId: createResult.cronId });
        expect(result.alreadyCancelled).toBe(true);
    });
});

// ============================================================================
// cron tool — list
// ============================================================================

describe('cron tool list action', () => {
    let deps: CronToolDeps;
    let handler: (args: any) => Promise<any>;

    beforeEach(() => {
        deps = makeCronToolDeps();
        handler = makeCronHandler(deps);
    });

    it('lists all crons for the process', async () => {
        await handler({ action: 'create', description: 'Cron 1', interval: '1m', prompt: 'P1' });
        await handler({ action: 'create', description: 'Cron 2', interval: '5m', prompt: 'P2' });

        const result = await handler({ action: 'list' });
        expect(result.total).toBe(2);
        expect(result.crons).toHaveLength(2);
        expect(result.crons[0]).toHaveProperty('id');
        expect(result.crons[0]).toHaveProperty('description');
        expect(result.crons[0]).toHaveProperty('status');
    });

    it('filters by status', async () => {
        await handler({ action: 'create', description: 'Active', interval: '1m', prompt: 'P1' });
        await handler({ action: 'create', description: 'To cancel', interval: '5m', prompt: 'P2' });

        // Cancel the second one
        const crons = deps.store.getByProcess('proc-123');
        const secondCron = crons.find(l => l.description === 'To cancel')!;
        await handler({ action: 'cancel', cronId: secondCron.id });

        const activeResult = await handler({ action: 'list', status: 'active' });
        expect(activeResult.total).toBe(1);
        expect(activeResult.crons[0].description).toBe('Active');

        const cancelledResult = await handler({ action: 'list', status: 'cancelled' });
        expect(cancelledResult.total).toBe(1);
        expect(cancelledResult.crons[0].description).toBe('To cancel');
    });

    it('returns empty list for process with no crons', async () => {
        const result = await handler({ action: 'list' });
        expect(result.total).toBe(0);
        expect(result.crons).toHaveLength(0);
    });

    it('does not list crons from other processes', async () => {
        // Create a cron on a different process
        const otherDeps = makeCronToolDeps({ processId: 'other-proc' });
        const otherHandler = makeCronHandler(otherDeps);
        await otherHandler({ action: 'create', description: 'Other', interval: '1m', prompt: 'P' });

        // Share the store but query from our process
        const sharedDeps: CronToolDeps = { ...deps, store: otherDeps.store };
        const sharedHandler = makeCronHandler(sharedDeps);
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
    it('cron tool has correct name and requires action', () => {
        const deps = makeCronToolDeps();
        const { tool } = createCronTool(deps);
        expect(tool.name).toBe('cron');
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

describe('cron tool event emission', () => {
    it('create emits cron-created with the new cron', async () => {
        const emit = vi.fn();
        const deps = makeCronToolDeps({ emit });
        const handler = makeCronHandler(deps);
        const result: any = await handler({ action: 'create', description: 'd', interval: '30s', prompt: 'p' });
        expect(result.created).toBe(true);
        expect(emit).toHaveBeenCalledTimes(1);
        const evt = emit.mock.calls[0][0];
        expect(evt.type).toBe('cron-created');
        expect(evt.cron.id).toBe(result.cronId);
        expect(evt.cron.processId).toBe('proc-123');
    });

    it('cancel emits cron-cancelled', async () => {
        const emit = vi.fn();
        const deps = makeCronToolDeps({ emit });
        const handler = makeCronHandler(deps);
        const createRes: any = await handler({ action: 'create', description: 'd', interval: '30s', prompt: 'p' });
        emit.mockClear();
        const cancelRes: any = await handler({ action: 'cancel', cronId: createRes.cronId });
        expect(cancelRes.cancelled).toBe(true);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0][0].type).toBe('cron-cancelled');
        expect(emit.mock.calls[0][0].cron.status).toBe('cancelled');
    });

    it('does not throw when emit throws', async () => {
        const emit = vi.fn().mockImplementation(() => { throw new Error('boom'); });
        const deps = makeCronToolDeps({ emit });
        const handler = makeCronHandler(deps);
        const result: any = await handler({ action: 'create', description: 'd', interval: '30s', prompt: 'p' });
        expect(result.created).toBe(true);
    });

    it('works without emit (backwards compatible)', async () => {
        const deps = makeCronToolDeps();
        const handler = makeCronHandler(deps);
        const result: any = await handler({ action: 'create', description: 'd', interval: '30s', prompt: 'p' });
        expect(result.created).toBe(true);
    });
});
