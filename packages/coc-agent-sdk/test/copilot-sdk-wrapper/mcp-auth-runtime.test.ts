/**
 * Inference-free pinned CLI verification: COC_COPILOT_MCP_AUTH_RUNTIME=1.
 * COC_COPILOT_MCP_AUTH_CLI can select a separate pinned executable.
 */
import { describe, it, expect, vi } from 'vitest';
import { CopilotClient, RuntimeConnection, type CopilotSession, type SessionConfig } from '@github/copilot-sdk';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { findCopilotNativeCliPath } from '../../src/sdk-client-factory';
import { RequestRunner } from '../../src/request-runner';
import { SessionManager } from '../../src/session-manager';

interface NativeOAuthStore {
    mcpOauthStoreCreate(directory: string, name: string, sessionId?: string): number;
    mcpOauthStoreGetTokens(handle: number, key: string): Promise<string | null>;
    mcpOauthStoreDeleteTokens(handle: number, key: string): Promise<void>;
    mcpOauthStoreDeleteClientRegistration(handle: number, key: string): Promise<void>;
    mcpOauthStoreClearCodeVerifier(handle: number, key: string): Promise<void>;
    mcpOauthStoreDispose(handle: number): void;
    mcpOauthStoreKey(url: string, clientId?: string): string;
}

describe.skipIf(process.env.COC_COPILOT_MCP_AUTH_RUNTIME !== '1')('Copilot MCP host auth runtime', () => {
    it.each([
        { clientMode: 'copilot-cli', sessionMode: 'create' },
        { clientMode: 'copilot-cli', sessionMode: 'resume' },
        { clientMode: 'copilot-cli', sessionMode: 'fallback' },
        { clientMode: 'empty', sessionMode: 'create' },
    ] as const)('preserves mixed OAuth ownership in $clientMode mode on $sessionMode', async ({ clientMode, sessionMode }) => {
        const require = createRequire(import.meta.url);
        const sdkManifest = path.resolve(path.dirname(require.resolve('@github/copilot-sdk')), '..', '..', 'package.json');
        expect(JSON.parse(await fs.readFile(sdkManifest, 'utf8')).version).toBe('1.0.9');
        const cliPath = process.env.COC_COPILOT_MCP_AUTH_CLI ?? findCopilotNativeCliPath();
        if (!cliPath) throw new Error('Installed Copilot CLI executable not found');
        const native: NativeOAuthStore = require(path.join(
            path.dirname(cliPath), 'prebuilds', `${process.platform}-${process.arch}`, 'runtime.node',
        ));
        const root = await fs.mkdtemp(path.join(tmpdir(), 'coc-mcp-auth-runtime-'));
        const identity = randomUUID();
        const nativeTokens = [`native-fixture-${randomUUID()}`, `native-fixture-${randomUUID()}`];
        const genericToken = `generic-fixture-${randomUUID()}`;
        const refreshToken = `refresh-fixture-${randomUUID()}`;
        let genericTokenExchanges = 0;
        let genericRefreshes = 0;
        let genericToolCalls = 0;
        let unexpectedToken = false;
        let serverError: unknown;
        let baseUrl = '';
        const genericPath = `/generic/${identity}`;
        const managedPaths = [`/managed/${identity}`, `/managed-other/${identity}`];
        const server = createServer((request, response) => {
            void (async () => {
                const url = new URL(request.url ?? '/', baseUrl);
                const json = (value: unknown) => {
                    response.writeHead(200, { 'Content-Type': 'application/json' });
                    response.end(JSON.stringify(value));
                };
                if (url.pathname === '/.well-known/oauth-authorization-server' || url.pathname === '/.well-known/openid-configuration') {
                    json({
                        issuer: baseUrl, authorization_endpoint: `${baseUrl}/authorize`, token_endpoint: `${baseUrl}/token`,
                        registration_endpoint: `${baseUrl}/register`, response_types_supported: ['code'],
                        grant_types_supported: ['authorization_code', 'refresh_token'],
                        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
                    });
                    return;
                }
                if (url.pathname === '/register') {
                    json({ client_id: 'generic-fixture-client', token_endpoint_auth_method: 'none' });
                    return;
                }
                if (url.pathname === '/authorize') {
                    const redirect = new URL(url.searchParams.get('redirect_uri')!);
                    redirect.searchParams.set('code', 'generic-fixture-code');
                    redirect.searchParams.set('state', url.searchParams.get('state')!);
                    response.writeHead(302, { Location: redirect.href });
                    response.end();
                    return;
                }
                if (url.pathname === '/token') {
                    const chunks: Buffer[] = [];
                    for await (const chunk of request) chunks.push(Buffer.from(chunk));
                    const form = new URLSearchParams(Buffer.concat(chunks).toString());
                    if (form.get('grant_type') === 'refresh_token') {
                        expect(form.get('refresh_token')).toBe(refreshToken);
                        genericRefreshes++;
                    } else {
                        expect(form.get('grant_type')).toBe('authorization_code');
                    }
                    genericTokenExchanges++;
                    json({
                        access_token: genericToken, token_type: 'Bearer',
                        expires_in: genericTokenExchanges === 1 ? 1 : 3600, refresh_token: refreshToken,
                    });
                    return;
                }
                if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
                    json({
                        resource: `${baseUrl}${url.pathname.slice('/.well-known/oauth-protected-resource'.length)}`,
                        authorization_servers: [baseUrl],
                    });
                    return;
                }
                const managedIndex = managedPaths.indexOf(url.pathname);
                if (url.pathname !== genericPath && managedIndex < 0) {
                    response.writeHead(404);
                    response.end();
                    return;
                }
                const expectedToken = managedIndex < 0 ? genericToken : nativeTokens[managedIndex];
                if (request.headers.authorization && request.headers.authorization !== `Bearer ${expectedToken}`) unexpectedToken = true;
                if (request.headers.authorization !== `Bearer ${expectedToken}`) {
                    response.writeHead(401, {
                        'WWW-Authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource${url.pathname}"`,
                    });
                    response.end();
                    return;
                }
                if (request.method !== 'POST') {
                    response.writeHead(405);
                    response.end();
                    return;
                }
                const chunks: Buffer[] = [];
                for await (const chunk of request) chunks.push(Buffer.from(chunk));
                const message = JSON.parse(Buffer.concat(chunks).toString());
                if (message.id === undefined) {
                    response.writeHead(202);
                    response.end();
                    return;
                }
                if (message.method === 'tools/call' && managedIndex < 0) genericToolCalls++;
                const result = message.method === 'initialize'
                    ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
                    : message.method === 'tools/list'
                        ? { tools: [{
                            name: 'fixture_tool', description: 'Local auth fixture', inputSchema: { type: 'object' },
                            _meta: { ui: { visibility: ['model', 'app'] } },
                        }] }
                        : message.method === 'tools/call'
                            ? { content: [{ type: 'text', text: 'fixture-tool-success' }] }
                            : {};
                json({ jsonrpc: '2.0', id: message.id, result });
            })().catch(error => {
                serverError = error;
                response.writeHead(500);
                response.end();
            });
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Fixture server did not bind TCP');
        baseUrl = `http://127.0.0.1:${address.port}`;
        const config = path.join(root, 'config');
        await fs.mkdir(config);
        const store = native.mcpOauthStoreCreate(path.join(config, 'mcp-oauth-config'), 'fixture-inspector');
        const keys = [...managedPaths, genericPath].map(resource => native.mcpOauthStoreKey(`${baseUrl}${resource}`));
        const env = {
            ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] =>
                entry[1] !== undefined && !/^(COPILOT_|GITHUB_|GH_|HOME$|USERPROFILE$|APPDATA$|LOCALAPPDATA$|XDG_)/.test(entry[0]))),
            COPILOT_AUTO_UPDATE: 'false', COPILOT_HOME: path.join(root, 'home'),
            HOME: root, USERPROFILE: root, APPDATA: path.join(root, 'appdata'), LOCALAPPDATA: path.join(root, 'localappdata'),
            XDG_CONFIG_HOME: config, XDG_CACHE_HOME: path.join(root, 'cache'),
            COPILOT_CACHE_HOME: path.join(root, 'cache'), COPILOT_PKG_CACHE_HOME: path.join(root, 'cache'),
            COPILOT_MCP_APPS: 'true',
        };
        const createClient = (workspace: number) => new CopilotClient({
            mode: clientMode, baseDirectory: path.join(root, `workspace-${workspace}`, 'sessions'),
            connection: RuntimeConnection.forStdio({ path: cliPath, args: ['--prefer-version', '1.0.78'], env }),
        });
        let client = createClient(0);
        const handlers = nativeTokens.map((accessToken, workspace) => vi.fn((request: Parameters<NonNullable<SessionConfig['onMcpAuthRequest']>>[0]) => {
            expect(request.serverName).toBe('managed');
            expect(request.serverUrl).toBe(`${baseUrl}${managedPaths[workspace]}`);
            return { kind: 'token' as const, accessToken, expiresIn: 3600 };
        }));
        const loginCalls: string[] = [];
        const browserFlows: Promise<void>[] = [];
        let browserError: unknown;
        const completeOAuth = async (authorizationUrl: string) => {
            const url = new URL(authorizationUrl);
            expect(url.origin).toBe(baseUrl);
            const authorization = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
            const callback = new URL(authorization.headers.get('location')!);
            expect(['127.0.0.1', 'localhost']).toContain(callback.hostname);
            await fetch(callback, { signal: AbortSignal.timeout(10000) });
        };
        const waitTools = async (session: CopilotSession, serverName: string) => {
            await vi.waitFor(async () => {
                if (serverError) throw serverError;
                const tools = await session.rpc.mcp.listTools({ serverName });
                expect(JSON.stringify(tools)).toContain('fixture_tool');
            }, { timeout: 15000, interval: 100 });
        };
        const assertHostIsolation = async (directory: string = root): Promise<void> => {
            if (directory === root) {
                for (const key of keys.slice(0, 2)) expect(await native.mcpOauthStoreGetTokens(store, key)).toBeNull();
            }
            for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
                const filename = path.join(directory, entry.name);
                if (entry.isDirectory()) await assertHostIsolation(filename);
                else {
                    const content = await fs.readFile(filename);
                    for (const token of nativeTokens) expect(content.includes(Buffer.from(token)), entry.name).toBe(false);
                }
            }
        };
        const configureClient = (currentClient: CopilotClient, refresh: boolean) => {
            const instrument = (session: CopilotSession) => {
                // Exercise RequestRunner without sending an inference request.
                Object.defineProperty(session, 'send', { value: undefined, configurable: true });
                const originalLogin = session.rpc.mcp.oauth.login.bind(session.rpc.mcp.oauth);
                vi.spyOn(session.rpc.mcp.oauth, 'login').mockImplementation(params => {
                    loginCalls.push(params.serverName);
                    return originalLogin(params);
                });
                vi.spyOn(session, 'sendAndWait').mockImplementation(async () => {
                    await session.rpc.tools.initializeAndValidate();
                    await waitTools(session, 'managed');
                    await waitTools(session, 'generic');
                    if (refresh) {
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        expect((await session.rpc.mcp.oauth.login({ serverName: 'generic' })).authorizationUrl).toBeUndefined();
                        await waitTools(session, 'generic');
                    }
                    const result = await session.rpc.mcp.apps.callTool({
                        serverName: 'generic', originServerName: 'generic', toolName: 'fixture_tool', arguments: {},
                    });
                    expect(JSON.stringify(result)).toContain('fixture-tool-success');
                    return { data: { content: 'fixture-success' } } as never;
                });
                return session;
            };
            const create = currentClient.createSession.bind(currentClient);
            vi.spyOn(currentClient, 'createSession').mockImplementation(async options => {
                expect(options).not.toHaveProperty('mcpOAuthTokenStorage');
                return instrument(await create({ ...options, configDirectory: config, enableMcpApps: true }));
            });
            const resume = currentClient.resumeSession.bind(currentClient);
            vi.spyOn(currentClient, 'resumeSession').mockImplementation(async (id, options) => {
                expect(options).not.toHaveProperty('mcpOAuthTokenStorage');
                return instrument(await resume(id, { ...options, configDirectory: config, enableMcpApps: true }));
            });
        };
        const run = async (workspace: number, sessionId?: string) => {
            const runner = new RequestRunner(
                async () => ({ available: true }), async () => client, new SessionManager(), 60000, 60000,
            );
            return runner.send({
                prompt: 'fixture', client, sessionId, workingDirectory: path.join(root, `workspace-${workspace}`),
                timeoutMs: 60000, availableTools: [], loadDefaultMcpConfig: false,
                mcpServers: {
                    managed: { type: 'http', url: `${baseUrl}${managedPaths[workspace]}`, tools: ['*'] },
                    generic: { type: 'http', url: `${baseUrl}${genericPath}`, tools: ['*'] },
                },
                managedMcpAuthServers: { managed: `${baseUrl}${managedPaths[workspace]}` },
                onMcpAuthRequest: handlers[workspace],
                onMcpOAuthRequired: event => {
                    expect(event.serverName).toBe('generic');
                    if (event.authorizationUrl) browserFlows.push(completeOAuth(event.authorizationUrl).catch(error => { browserError = error; }));
                },
            });
        };
        try {
            expect(execFileSync(cliPath, ['--prefer-version', '1.0.78', '--version'], {
                env, encoding: 'utf8', timeout: 10000,
            })).toContain('GitHub Copilot CLI 1.0.78.');
            let sessionId: string | undefined;
            if (sessionMode === 'resume') {
                const seed = await client.createSession({
                    availableTools: [], onPermissionRequest: () => ({ kind: 'reject' }), mcpServers: {},
                    configDirectory: config,
                });
                sessionId = seed.sessionId;
                await seed.disconnect();
            } else if (sessionMode === 'fallback') {
                sessionId = randomUUID();
            }
            configureClient(client, true);
            const first = await run(0, sessionId);
            expect(first).toEqual(expect.objectContaining({ success: true, response: 'fixture-success' }));
            expect(handlers[0]).toHaveBeenCalledOnce();
            expect(genericTokenExchanges).toBe(2);
            expect(genericRefreshes).toBe(1);
            expect(browserFlows).toHaveLength(1);
            if (sessionMode === 'fallback') {
                expect(client.resumeSession).toHaveBeenCalledOnce();
                expect(client.createSession).toHaveBeenCalledOnce();
                expect(first.sessionId).not.toBe(sessionId);
            }
            expect(await client.stop()).toEqual([]);
            const persisted = await native.mcpOauthStoreGetTokens(store, keys[2]);
            if (clientMode === 'copilot-cli') {
                expect(persisted).not.toBeNull();
                expect(JSON.parse(persisted!)).toEqual(expect.objectContaining({
                    accessToken: genericToken, refreshToken,
                }));
            } else {
                expect(persisted).toBeNull();
            }
            await assertHostIsolation();
            for (const workspace of [0, 1]) {
                client = createClient(workspace);
                configureClient(client, false);
                const next = await run(workspace, workspace === 0 && sessionMode === 'resume' ? first.sessionId : undefined);
                expect(next).toEqual(expect.objectContaining({ success: true, response: 'fixture-success' }));
                expect(await client.stop()).toEqual([]);
                expect(browserFlows).toHaveLength(clientMode === 'copilot-cli' ? 1 : workspace + 2);
                expect(genericTokenExchanges).toBe(clientMode === 'copilot-cli' ? 2 : workspace + 3);
            }
            expect(handlers[0]).toHaveBeenCalledTimes(2);
            expect(handlers[1]).toHaveBeenCalledOnce();
            expect(genericToolCalls).toBe(3);
            expect(loginCalls.every(name => name === 'generic')).toBe(true);
            expect(loginCalls.length).toBeGreaterThanOrEqual(3);
            expect(unexpectedToken).toBe(false);
            expect(serverError).toBeUndefined();
            await Promise.all(browserFlows);
            expect(browserError).toBeUndefined();
        } finally {
            await client.stop();
            await Promise.all(browserFlows);
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
            try {
                await assertHostIsolation();
            } finally {
                // Vault keys can outlive COPILOT_HOME. Delete only this fixture's unique resources.
                try {
                    for (const key of keys) {
                        await native.mcpOauthStoreDeleteTokens(store, key);
                        await native.mcpOauthStoreDeleteClientRegistration(store, key);
                        await native.mcpOauthStoreClearCodeVerifier(store, key);
                    }
                } finally {
                    native.mcpOauthStoreDispose(store);
                    await fs.rm(root, { recursive: true, force: true });
                }
            }
        }
    }, 90000);
});
