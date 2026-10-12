import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
const mocks = vi.hoisted(() => ({ credentials: [] as any[] }));
vi.mock('@plusplusoneplusplus/coc-connector/teams', async original => ({
    ...await original<typeof import('@plusplusoneplusplus/coc-connector/teams')>(),
    TeamsOAuthCredential: class {
        dispose = vi.fn();
        constructor(public options: any) { mocks.credentials.push(this); }
    },
}));
import { ContainerRuntime } from '../../src/server/runtime';

describe('container runtime Teams credential ownership', () => {
    function runtime(dataDir = path.resolve('fixture-container-data')): ContainerRuntime {
        const instance = Object.create(ContainerRuntime.prototype);
        instance.config = { serve: { dataDir }, messaging: { teams: {
            mode: 'mcp', mcpServerUrl: 'https://teams.example/resource',
        } } };
        return instance;
    }
    beforeEach(() => { mocks.credentials = []; });
    it('shares one host owner between controller and bridge config clones', () => {
        const instance = runtime();
        const first = instance.getTeamsCredential();
        expect(instance.getTeamsCredential({ ...instance.config.messaging.teams })).toBe(first);
        expect(mocks.credentials).toHaveLength(1);
        expect(mocks.credentials[0].options.dataDir).toBe(instance.config.serve.dataDir);
    });
    it.each(['mode', 'mcpServerUrl', 'clientId', 'scope'])('disposes the previous credential on %s changes', key => {
        const instance = runtime();
        instance.getTeamsCredential();
        const teams: any = { ...instance.config.messaging.teams };
        teams[key] = key === 'mode' ? 'graph' : 'changed-fixture';
        expect(instance.getTeamsCredential(teams)).toBe(mocks.credentials[1]);
        expect(mocks.credentials[0].dispose).toHaveBeenCalledOnce();
    });
    it('isolates independent host runtimes and explicitly invalidates configured owners', () => {
        const first = runtime();
        const second = runtime(path.resolve('other-fixture-host'));
        expect(first.getTeamsCredential()).not.toBe(second.getTeamsCredential());
        first.invalidateTeamsCredential();
        expect(mocks.credentials[0].dispose).toHaveBeenCalledOnce();
        expect(mocks.credentials[1].dispose).not.toHaveBeenCalled();
    });
    it('shutdown disposes the owner and forbids resurrection', () => {
        const instance: any = runtime();
        instance.getTeamsCredential();
        for (const name of ['healthMonitor', 'tunnelBridge', 'sshBridge', 'sseRelay', 'agentManager', 'agentStore']) {
            instance[name] = { stop: vi.fn(), stopAll: vi.fn(), dispose: vi.fn(), disconnectAll: vi.fn(),
                disconnectAllOutbound: vi.fn(), close: vi.fn() };
        }
        instance.cleanup();
        expect(mocks.credentials[0].dispose).toHaveBeenCalledOnce();
        expect(() => instance.getTeamsCredential()).toThrow('disposed');
    });
});
