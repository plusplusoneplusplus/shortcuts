import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTaskInput } from '@plusplusoneplusplus/forge';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { ScrubberCommands } from '../../../src/server/sentinel-scrubber/scrubber-commands';
import { ScrubberEngine } from '../../../src/server/sentinel-scrubber/scrubber-engine';
import { ScrubberRunService } from '../../../src/server/sentinel-scrubber/scrubber-runs';
import { ScrubberStore } from '../../../src/server/sentinel-scrubber/scrubber-store';
import { createTodoTestDatabase, createTodoTestDirectory } from '../sentinel-todos/test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_s1' };
const other = { workspaceId: 'ws-a', processId: 'queue_s2' };
const processes: Record<string, { workspaceId: string; mode: string }> = {
    queue_s1: { workspaceId: 'ws-a', mode: 'sentinel' },
    queue_s2: { workspaceId: 'ws-a', mode: 'sentinel' },
    queue_ask: { workspaceId: 'ws-a', mode: 'ask' },
};

let todos: SentinelTodoStore;
let scrubber: ScrubberStore;
let runs: ScrubberRunService;
let enabled: boolean;
let onChange: ReturnType<typeof vi.fn>;
let commands: ScrubberCommands;

beforeEach(() => {
    const fixture = createTodoTestDatabase(createTodoTestDirectory());
    todos = new SentinelTodoStore(fixture.db);
    scrubber = new ScrubberStore(fixture.db);
    const engine = new ScrubberEngine({ todos, scrubber });
    const service = new SentinelTodoService({ todos, store: {
        getProcess: async id => processes[id] ? { id, metadata: processes[id] } as never : undefined,
    } });
    runs = new ScrubberRunService({ dataDir: fixture.dataDir, todos: service, scrubber, engine,
        enqueue: vi.fn(async (input: CreateTaskInput) => input.id!), cancelTask: vi.fn(() => true) });
    enabled = true;
    onChange = vi.fn();
    commands = new ScrubberCommands({ todos: service, scrubber, runs, getEnabled: () => enabled, onChange });
});

describe('ScrubberCommands', () => {
    it('rejects every command while the scrubber flag is off', async () => {
        enabled = false;
        await expect(commands.view(owner)).rejects.toMatchObject({ code: 'not_found' });
        await expect(commands.putConfig(owner, { enabled: true, cron: '0 9 * * *' }, 0)).rejects.toMatchObject({ code: 'not_found' });
        await expect(commands.start(owner)).rejects.toMatchObject({ code: 'not_found' });
        await expect(commands.cancel(owner, 'run')).rejects.toMatchObject({ code: 'not_found' });
        expect(scrubber.getConfig(owner).revision).toBe(0);
    });

    it('rejects non-Sentinel owners before any read', async () => {
        await expect(commands.view({ workspaceId: 'ws-a', processId: 'queue_ask' })).rejects.toMatchObject({ code: 'not_found' });
        await expect(commands.view({ workspaceId: 'ws-b', processId: 'queue_s1' })).rejects.toMatchObject({ code: 'not_found' });
    });

    it('saves schedules with validation, revisions and resume semantics', async () => {
        await expect(commands.putConfig(owner, { enabled: true, cron: 'nope' }, 0)).rejects.toMatchObject({ code: 'invalid' });
        const saved = await commands.putConfig(owner, { enabled: true, cron: '0 9 * * *' }, 0);
        expect(saved).toMatchObject({ enabled: true, cron: '0 9 * * *', revision: 1, paused: false });
        expect(saved.nextRunAt).toBeDefined();
        expect(onChange).toHaveBeenCalledWith(owner, { configChanged: true });
        await expect(commands.putConfig(owner, { enabled: false, cron: '0 9 * * *' }, 0)).rejects.toMatchObject({ code: 'conflict' });
        const paused = await commands.putConfig(owner, { enabled: false, cron: '0 9 * * *' }, 1);
        expect(paused).toMatchObject({ enabled: false, revision: 2 });
        expect(paused.nextRunAt).toBeUndefined();
        expect((await commands.view(other)).config.revision).toBe(0);
    });

    it('starts one manual scrub at a time and cancels it', async () => {
        todos.create(owner, { title: 'Ship' }, { actor: 'sentinel' });
        const run = await commands.start(owner);
        expect(run).toMatchObject({ status: 'queued', trigger: 'manual' });
        await expect(commands.start(owner)).rejects.toMatchObject({ code: 'conflict' });
        expect((await commands.view(owner)).activeRun?.id).toBe(run.id);
        expect(await commands.cancel(owner, run.id)).toMatchObject({ status: 'cancelled' });
        await expect(commands.cancel(owner, 'missing')).rejects.toMatchObject({ code: 'not_found' });
        await expect(commands.cancel(other, run.id)).rejects.toMatchObject({ code: 'not_found' });
    });
});
