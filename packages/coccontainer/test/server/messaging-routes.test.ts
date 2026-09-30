import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { createTransport } from '@plusplusoneplusplus/coc-connector/teams';
import { resolveConfig, type ResolvedTeamsConfig } from '../../src/config';
import { TeamsBridge, type TeamsBridgeOptions } from '../../src/messaging/teams-bridge';
import { RouteTable } from '../../src/server/http-util';
import { MessagingConfigService } from '../../src/server/messaging-config';
import { installMessagingRoutes } from '../../src/server/routes/messaging-routes';
import type { ContainerRuntime } from '../../src/server/runtime';
import { TeamsAuthController } from '../../src/server/teams-auth-controller';

const io = vi.hoisted(() => ({ savedConfig: '' }));

vi.mock('fs', async importOriginal => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn((file: string) => path.basename(String(file)) === 'config.yaml'),
        readFileSync: vi.fn((file: string, ...args: any[]) => {
            if (path.basename(String(file)) === 'config.yaml') return io.savedConfig;
            return (actual.readFileSync as any)(file, ...args);
        }),
        writeFileSync: vi.fn((file: string, content: string) => {
            if (path.basename(String(file)) !== 'config.yaml') throw new Error('Unexpected write');
            io.savedConfig = content;
        }),
    };
});

vi.mock('@plusplusoneplusplus/coc-connector/teams', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-connector/teams')>();
    return {
        ...actual,
        exchangeCodeForToken: vi.fn().mockResolvedValue('mock-token'),
        createTransport: vi.fn((mode, options) => {
            // Keep the real constructor validation; transport IO is never started.
            return actual.createTransport(mode, options);
        }),
    };
});

describe('Teams config routes and OAuth bridge lifecycle (mock IO)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        io.savedConfig = yaml.dump({ messaging: { teams: { enabled: false, ic3Region: 'amer' } } });
    });

    function setup() {
        const config = resolveConfig();
        const runtime = {
            config,
            teamsBridge: undefined as TeamsBridge | undefined,
            startTeamsBridge: vi.fn(async (teams: ResolvedTeamsConfig) => {
                const bridge = new TeamsBridge({ config: teams, dataDir: config.serve.dataDir } as TeamsBridgeOptions);
                runtime.teamsBridge = bridge;
                return bridge;
            }),
        };
        const messagingConfig = new MessagingConfigService(config.serve.dataDir);
        const table = new RouteTable();
        installMessagingRoutes(table, runtime as unknown as ContainerRuntime, messagingConfig);
        const auth = new TeamsAuthController({
            config, runtime: runtime as unknown as ContainerRuntime, messagingConfig,
            oauthConfigDir: path.join('mock-data', 'oauth'),
        });
        return { config, runtime, table, auth };
    }

    async function update(table: RouteTable, patch: Record<string, unknown>) {
        const response = { writeHead: vi.fn(), end: vi.fn() };
        const url = new URL('http://localhost/api/container/messaging/teams/config');
        await table.dispatch({
            req: Readable.from([Buffer.from(JSON.stringify(patch))]) as IncomingMessage,
            res: response as unknown as ServerResponse, url, method: 'POST',
        });
        return { status: response.writeHead.mock.calls[0][0], body: JSON.parse(response.end.mock.calls[0][0]) };
    }

    async function login(auth: TeamsAuthController) {
        expect(await auth.exchange({
            code: 'mock-code', codeVerifier: 'mock-verifier', redirectUri: 'http://localhost/callback',
        })).toMatchObject({ ok: true });
    }

    it.each(['AMER', 'auto', ''])('invalid saved region %j cannot reach the transport constructor', region => {
        io.savedConfig = yaml.dump({ messaging: { teams: { enabled: true, ic3Region: region } } });
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const { config, runtime } = setup();
            expect(config.messaging.teams.ic3Region).toBeNull();
            expect(() => new TeamsBridge({ config: config.messaging.teams } as TeamsBridgeOptions)).not.toThrow();
            expect(createTransport).toHaveBeenLastCalledWith('mcp', expect.objectContaining({
                ic3DirectMessageOptions: { region: undefined },
            }));
            expect(warning).toHaveBeenCalledWith(expect.stringContaining('then reconnect'));
            expect(runtime.teamsBridge).toBeUndefined();
        } finally {
            warning.mockRestore();
        }
    });

    it.each([null, 'emea', 'apac'] as const)('region %s survives updating an OAuth-created clone, logout, and login', async ic3Region => {
        const { config, runtime, table, auth } = setup();
        await login(auth);
        expect(runtime.startTeamsBridge.mock.calls[0][0]).not.toBe(config.messaging.teams);
        expect(await update(table, { ic3Region, botName: 'Updated' })).toMatchObject({ status: 200, body: { ok: true } });
        expect(config.messaging.teams.ic3Region).toBe(ic3Region);
        expect(config.messaging.teams.botName).toBe('Updated');
        expect((yaml.load(io.savedConfig) as any).messaging.teams.ic3Region).toBe(ic3Region);

        expect(await update(table, { channelName: 'Selected' })).toMatchObject({ status: 200 });
        expect(config.messaging.teams.ic3Region).toBe(ic3Region);
        expect(await auth.logout()).toMatchObject({ ok: true });
        expect(runtime.teamsBridge).toBeUndefined();
        await login(auth);
        expect(runtime.teamsBridge?.getTeamsStatus()).toMatchObject({ ic3Region, botName: 'Updated', channelName: 'Selected' });
        expect(createTransport).toHaveBeenLastCalledWith('mcp', expect.objectContaining({
            ic3DirectMessageOptions: { region: ic3Region ?? undefined },
        }));
    });

    it('rejected active bridge updates leave canonical config and saved settings untouched', async () => {
        const { config, runtime, table, auth } = setup();
        await login(auth);
        const before = io.savedConfig;
        vi.spyOn(runtime.teamsBridge!, 'updateConfig').mockRejectedValueOnce(new Error('Update failed'));
        await expect(update(table, { ic3Region: null, botName: 'Rejected' })).rejects.toThrow('Update failed');
        expect(config.messaging.teams.ic3Region).toBe('amer');
        expect(config.messaging.teams.botName).toBe('CoC');
        expect(io.savedConfig).toBe(before);
        await auth.logout();
        await login(auth);
        expect(runtime.teamsBridge?.getTeamsStatus().ic3Region).toBe('amer');
    });

    it.each(['AMER', 'auto', ''])('invalid API region %j returns 400 without mutating the active bridge or canonical config', async ic3Region => {
        const { config, runtime, table, auth } = setup();
        await login(auth);
        const updateBridge = vi.spyOn(runtime.teamsBridge!, 'updateConfig');
        const before = io.savedConfig;
        expect(await update(table, { ic3Region, botName: 'Rejected' })).toMatchObject({ status: 400, body: { ok: false } });
        expect(updateBridge).not.toHaveBeenCalled();
        expect(config.messaging.teams.ic3Region).toBe('amer');
        expect(io.savedConfig).toBe(before);
    });
});
