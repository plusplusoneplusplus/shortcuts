import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { CopilotSDKService } from '@plusplusoneplusplus/forge';
import { TeamsIc3Session } from '@plusplusoneplusplus/coc-native';
import { createExecutionServer } from '../../src/server/index';
import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import * as reactionRuntime from '../../src/server/messaging/teams-reaction-runtime';
import * as reactionExecution from '../../src/server/messaging/teams-reaction-execution';
import * as ownCommands from '../../src/server/messaging/teams-ic3-own-commands-runtime';

it.each([false, true])('server shutdown drains reaction observers before releasing queue infrastructure (drain: %s)', async drain => {
    const dir = await mkdtemp(join(tmpdir(), 'teams-reaction-shutdown-'));
    const service = new CopilotSDKService();
    vi.spyOn(service, 'listModels').mockResolvedValue([]);
    vi.spyOn(service, 'isAvailable').mockResolvedValue({ available: false });
    const connect = vi.spyOn(TeamsIc3Session.prototype, 'connect');
    const runtimeFactory = vi.spyOn(reactionRuntime, 'createTeamsReactionRuntime');
    const executionFactory = vi.spyOn(reactionExecution, 'createTeamsReactionExecution');
    const commandsFactory = vi.spyOn(ownCommands, 'createTeamsIc3OwnCommandsRuntime');
    const queueShutdown = vi.spyOn(MultiRepoQueueRouter.prototype, drain ? 'drainAll' : 'dispose');
    let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
    try {
        server = await createExecutionServer({
            port: 0, host: '127.0.0.1', dataDir: dir, configPath: join(dir, 'config.yaml'), aiService: service,
        });
        expect(runtimeFactory).toHaveBeenCalledOnce();
        expect(executionFactory).toHaveBeenCalledOnce();
        const runtime: ReturnType<typeof reactionRuntime.createTeamsReactionRuntime> = runtimeFactory.mock.results[0].value;
        const execution: ReturnType<typeof reactionExecution.createTeamsReactionExecution> = executionFactory.mock.results[0].value;
        const commands: ReturnType<typeof ownCommands.createTeamsIc3OwnCommandsRuntime> = commandsFactory.mock.results[0].value;
        expect(runtime.getStatus().state).toBe('disabled');
        expect(connect).not.toHaveBeenCalled();
        const stopRuntime = vi.spyOn(runtime, 'dispose');
        const stopExecution = vi.spyOn(execution, 'dispose');
        const stopCommands = vi.spyOn(commands, 'dispose');
        await server.close(drain ? { drain: true } : undefined);
        server = undefined;
        expect(stopRuntime).toHaveBeenCalledOnce();
        expect(stopExecution).toHaveBeenCalledOnce();
        expect(stopCommands).toHaveBeenCalledOnce();
        expect(queueShutdown).toHaveBeenCalledOnce();
        expect(stopRuntime.mock.invocationCallOrder[0]).toBeLessThan(stopExecution.mock.invocationCallOrder[0]);
        expect(stopExecution.mock.invocationCallOrder[0]).toBeLessThan(stopCommands.mock.invocationCallOrder[0]);
        expect(stopExecution.mock.invocationCallOrder[0]).toBeLessThan(queueShutdown.mock.invocationCallOrder[0]);
        expect(connect).not.toHaveBeenCalled();
    } finally {
        await server?.close();
        service.dispose();
        vi.restoreAllMocks();
        await rm(dir, { recursive: true, force: true });
    }
});
