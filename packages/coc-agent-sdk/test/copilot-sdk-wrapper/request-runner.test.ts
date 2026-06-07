/**
 * RequestRunner Tests
 *
 * Unit tests for RequestRunner.send() and RequestRunner.transform().
 * Tests are isolated from CopilotSDKService by injecting mock dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestRunner } from '../../src/request-runner';
import { denyAllPermissions } from '../../src/types';
import { SessionManager } from '../../src/session-manager';
import { createMockSession, createStreamingMockSession } from '../helpers/mock-sdk';
const DEFAULT_AI_TIMEOUT_MS = 6 * 60 * 60 * 1000;
import { loadEffectiveMcpConfig } from '../../src/mcp-config-loader';



vi.mock('../../src/mcp-config-loader', () => ({
    loadEffectiveMcpConfig: vi.fn().mockReturnValue({ success: true, fileExists: false, mcpServers: {}, configPath: '' }),
}));

beforeEach(() => {
    vi.mocked(loadEffectiveMcpConfig).mockReset();
    vi.mocked(loadEffectiveMcpConfig).mockReturnValue({ success: true, fileExists: false, mcpServers: {}, configPath: '' });
});

// ============================================================================
// Helpers
// ============================================================================

function makeRunner(overrides?: {
    isAvailable?: () => Promise<any>;
    createClient?: (cwd?: string) => Promise<any>;
}) {
    const sessionManager = new SessionManager();
    const mockSession = createMockSession();
    const mockClient = {
        start: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockResolvedValue(mockSession),
        resumeSession: vi.fn().mockResolvedValue(mockSession),
        stop: vi.fn().mockResolvedValue(undefined),
    };

    const isAvailable = overrides?.isAvailable ?? vi.fn().mockResolvedValue({ available: true, sdkPath: '/fake/sdk' });
    const createClient = overrides?.createClient ?? vi.fn().mockResolvedValue(mockClient);

    const runner = new RequestRunner(isAvailable, createClient, sessionManager, DEFAULT_AI_TIMEOUT_MS, 3_600_000);
    return { runner, sessionManager, mockClient, mockSession, isAvailable, createClient };
}

// ============================================================================
// send() — availability check
// ============================================================================

describe('RequestRunner.send() — availability', () => {
    it('returns failure when SDK is not available', async () => {
        const { runner } = makeRunner({
            isAvailable: vi.fn().mockResolvedValue({ available: false, error: 'SDK not found' }),
        });

        const result = await runner.send({ prompt: 'test', loadDefaultMcpConfig: false });

        expect(result.success).toBe(false);
        expect(result.error).toContain('SDK not found');
    });

    it('uses default "Copilot SDK is not available" when availability has no error field', async () => {
        const { runner } = makeRunner({
            isAvailable: vi.fn().mockResolvedValue({ available: false }),
        });

        const result = await runner.send({ prompt: 'test', loadDefaultMcpConfig: false });
        expect(result.success).toBe(false);
        expect(result.error).toContain('not available');
    });
});

// ============================================================================
// send() — happy path (non-streaming)
// ============================================================================

describe('RequestRunner.send() — non-streaming path', () => {
    it('returns successful result with response text', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'hello' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            resumeSession: vi.fn(),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        const result = await runner.send({ prompt: 'hi', timeoutMs: 5000, loadDefaultMcpConfig: false });

        expect(result.success).toBe(true);
        expect(result.response).toBe('hello');
    });

    it('returns the requested model as the effective Copilot model', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'hello' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            resumeSession: vi.fn(),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        const result = await runner.send({ prompt: 'hi', model: 'claude-sonnet-4.6', timeoutMs: 5000, loadDefaultMcpConfig: false });

        expect(result.success).toBe(true);
        expect(result.effectiveModel).toBe('claude-sonnet-4.6');
    });

    it('invokes onSessionCreated with the session ID', async () => {
        const mockSession = createMockSession({ sessionId: 'my-session' });
        const mockClient = { createSession: vi.fn().mockResolvedValue(mockSession), stop: vi.fn().mockResolvedValue(undefined) };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        const receivedIds: string[] = [];
        await runner.send({
            prompt: 'test', timeoutMs: 5000, loadDefaultMcpConfig: false,
            onSessionCreated: (id) => receivedIds.push(id),
        });

        expect(receivedIds).toEqual(['my-session']);
    });

    it('returns failure when no response content', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: {} } });
        const mockClient = { createSession: vi.fn().mockResolvedValue(mockSession), stop: vi.fn().mockResolvedValue(undefined) };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        const result = await runner.send({ prompt: 'test', timeoutMs: 5000, loadDefaultMcpConfig: false });

        expect(result.success).toBe(false);
        expect(result.error).toContain('No response received');
    });

    it('destroys the active session when the abort signal fires', async () => {
        const controller = new AbortController();
        let rejectSend: ((error: Error) => void) | undefined;
        const mockSession = {
            sessionId: 'abort-session',
            sendAndWait: vi.fn().mockImplementation(() => new Promise((_resolve, reject) => {
                rejectSend = reject;
            })),
            abort: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn().mockImplementation(() => {
                rejectSend?.(new Error('destroyed'));
                return Promise.resolve();
            }),
        };
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        const resultPromise = runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
            signal: controller.signal,
        });
        await vi.waitFor(() => expect(mockSession.sendAndWait).toHaveBeenCalled(), { timeout: 1000 });
        controller.abort();

        const result = await resultPromise;
        expect(result.success).toBe(false);
        expect(result.error).toContain('destroyed');
        expect(mockSession.abort).toHaveBeenCalledTimes(1);
        expect(mockSession.destroy).toHaveBeenCalled();
    });

    it('translates WSL attachment paths before sending', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'hello' } } });
        const mockClient = { createSession: vi.fn().mockResolvedValue(mockSession), stop: vi.fn().mockResolvedValue(undefined) };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });
        const workingDirectory = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        const attachmentPath = String.raw`\\wsl$\Ubuntu\home\tester\repo\README.md`;

        await runner.send({
            prompt: 'hi',
            workingDirectory,
            attachments: [{ type: 'file', path: attachmentPath, displayName: 'README.md' }],
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
        });

        expect(mockSession.sendAndWait).toHaveBeenCalledWith(
            {
                prompt: 'hi',
                attachments: [{ type: 'file', path: '/home/tester/repo/README.md', displayName: 'README.md' }],
            },
            5000,
        );
    });

    it('rejects WSL attachments outside the working directory', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'hello' } } });
        const mockClient = { createSession: vi.fn().mockResolvedValue(mockSession), stop: vi.fn().mockResolvedValue(undefined) };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });
        const workingDirectory = String.raw`\\wsl$\Ubuntu\home\tester\repo`;

        const result = await runner.send({
            prompt: 'hi',
            workingDirectory,
            attachments: [{ type: 'file', path: 'C:\\temp\\outside.txt', displayName: 'outside.txt' }],
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain('only supports attachments inside the working directory');
    });
});

// ============================================================================
// send() — streaming path
// ============================================================================

describe('RequestRunner.send() — streaming path', () => {
    it('uses streaming when timeoutMs > 120000', async () => {
        const { session, dispatchEvent } = createStreamingMockSession();
        const mockClient = { createSession: vi.fn().mockResolvedValue(session), stop: vi.fn().mockResolvedValue(undefined) };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        const resultPromise = runner.send({
            prompt: 'stream test',
            timeoutMs: 200_000,
            loadDefaultMcpConfig: false,
        });

        await vi.waitFor(() => expect(session.on).toHaveBeenCalled(), { timeout: 1000 });
        dispatchEvent({ type: 'assistant.message', data: { content: 'streamed', messageId: 'msg-1' } });
        dispatchEvent({ type: 'session.idle', data: {} });

        const result = await resultPromise;
        expect(result.success).toBe(true);
        expect(result.response).toBe('streamed');
    });
});

// ============================================================================
// send() — error handling
// ============================================================================

describe('RequestRunner.send() — error handling', () => {
    it('wraps unexpected errors as failure result', async () => {
        const { runner } = makeRunner({
            createClient: vi.fn().mockRejectedValue(new Error('spawn failed')),
        });

        const result = await runner.send({ prompt: 'test', loadDefaultMcpConfig: false });

        expect(result.success).toBe(false);
        expect(result.error).toContain('spawn failed');
    });
});

// ============================================================================
// send() — onUserInputRequest threading
// ============================================================================

describe('RequestRunner.send() — onUserInputRequest', () => {
    it('threads onUserInputRequest into session config when provided', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'ok' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        const handler = vi.fn().mockResolvedValue({ answer: 'yes', wasFreeform: false });
        await runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
            onUserInputRequest: handler,
        });

        const sessionConfig = mockClient.createSession.mock.calls[0][0];
        expect(sessionConfig.onUserInputRequest).toBe(handler);
    });

    it('omits onUserInputRequest from session config when not provided', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'ok' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        await runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
        });

        const sessionConfig = mockClient.createSession.mock.calls[0][0];
        expect(sessionConfig.onUserInputRequest).toBeUndefined();
    });
});

// ============================================================================
// send() — infiniteSessions threading
// ============================================================================

describe('RequestRunner.send() — infiniteSessions', () => {
    it('threads infiniteSessions into session config when provided', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'ok' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        await runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
            infiniteSessions: { enabled: true },
        });

        const sessionConfig = mockClient.createSession.mock.calls[0][0];
        expect(sessionConfig.infiniteSessions).toEqual({ enabled: true });
    });

    it('forwards custom thresholds to session config', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'ok' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        await runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
            infiniteSessions: { enabled: true, backgroundCompactionThreshold: 0.7, bufferExhaustionThreshold: 0.9 },
        });

        const sessionConfig = mockClient.createSession.mock.calls[0][0];
        expect(sessionConfig.infiniteSessions).toEqual({
            enabled: true,
            backgroundCompactionThreshold: 0.7,
            bufferExhaustionThreshold: 0.9,
        });
    });

    it('omits infiniteSessions from session config when not provided', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'ok' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        await runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
        });

        const sessionConfig = mockClient.createSession.mock.calls[0][0];
        expect(sessionConfig.infiniteSessions).toBeUndefined();
    });
});

// ============================================================================
// send() — MCP config loading
// ============================================================================

describe('RequestRunner.send() — MCP config loading', () => {
    it('loads effective MCP config using the request working directory', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'ok' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(loadEffectiveMcpConfig).mockReturnValue({
            success: true,
            fileExists: true,
            configPath: 'workspace-config',
            mcpServers: {
                workspace: {
                    type: 'local',
                    command: 'workspace-server',
                    tools: ['*'],
                },
            },
        });
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        await runner.send({
            prompt: 'test',
            workingDirectory: 'workspace-dir',
            timeoutMs: 5000,
        });

        expect(loadEffectiveMcpConfig).toHaveBeenCalledWith({
            workingDirectory: 'workspace-dir',
            explicitMcpServers: undefined,
            loadDefaultMcpConfig: undefined,
        });
        const sessionConfig = mockClient.createSession.mock.calls[0][0];
        expect(sessionConfig.mcpServers).toEqual({
            workspace: {
                type: 'local',
                command: 'workspace-server',
                tools: ['*'],
            },
        });
    });

    it('does not load workspace MCP config when default MCP loading is disabled', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'ok' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        await runner.send({
            prompt: 'test',
            workingDirectory: 'workspace-dir',
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
        });

        expect(loadEffectiveMcpConfig).not.toHaveBeenCalled();
        const sessionConfig = mockClient.createSession.mock.calls[0][0];
        expect(sessionConfig.mcpServers).toBeUndefined();
    });

    it('passes an explicit empty MCP config through to disable all MCP servers', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'ok' } } });
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        vi.mocked(loadEffectiveMcpConfig).mockReturnValue({
            success: true,
            fileExists: true,
            configPath: 'workspace-config',
            mcpServers: {},
        });
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        await runner.send({
            prompt: 'test',
            workingDirectory: 'workspace-dir',
            timeoutMs: 5000,
            mcpServers: {},
        });

        const sessionConfig = mockClient.createSession.mock.calls[0][0];
        expect(sessionConfig.mcpServers).toEqual({});
    });
});

// ============================================================================
// transform()
// ============================================================================

describe('RequestRunner.transform()', () => {
    it('returns a structured success result with response text and metadata', async () => {
        const { runner } = makeRunner();
        const sendSpy = vi.spyOn(runner, 'send').mockResolvedValue({ success: true, response: 'raw result', effectiveModel: 'gpt-5.4-mini' });

        const result = await runner.transform('prompt');
        expect(result.success).toBe(true);
        expect(result.text).toBe('raw result');
        expect(result.effectiveModel).toBe('gpt-5.4-mini');
        sendSpy.mockRestore();
    });

    it('owns no model default — passes the caller model through', async () => {
        const { runner } = makeRunner();
        const sendSpy = vi.spyOn(runner, 'send').mockResolvedValue({ success: true, response: 'ok' });

        await runner.transform('prompt', { model: 'gpt-5.4-mini' });
        expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.4-mini' }));
    });

    it('does not inject a model when none is supplied', async () => {
        const { runner } = makeRunner();
        const sendSpy = vi.spyOn(runner, 'send').mockResolvedValue({ success: true, response: 'ok' });

        await runner.transform('prompt');
        expect(sendSpy.mock.calls[0][0].model).toBeUndefined();
    });

    it('defaults to no MCP and denied permissions', async () => {
        const { runner } = makeRunner();
        const sendSpy = vi.spyOn(runner, 'send').mockResolvedValue({ success: true, response: 'ok' });

        await runner.transform('prompt');
        const opts = sendSpy.mock.calls[0][0];
        expect(opts.loadDefaultMcpConfig).toBe(false);
        expect(opts.onPermissionRequest).toBe(denyAllPermissions);
    });

    it('allows overriding MCP and permission defaults', async () => {
        const { runner } = makeRunner();
        const handler = vi.fn();
        const sendSpy = vi.spyOn(runner, 'send').mockResolvedValue({ success: true, response: 'ok' });

        await runner.transform('prompt', { loadDefaultMcpConfig: true, onPermissionRequest: handler as never });
        const opts = sendSpy.mock.calls[0][0];
        expect(opts.loadDefaultMcpConfig).toBe(true);
        expect(opts.onPermissionRequest).toBe(handler);
    });

    it('uses custom sendFn when provided (allows spy on service.sendMessage)', async () => {
        const { runner } = makeRunner();
        const customSend = vi.fn().mockResolvedValue({ success: true, response: 'custom' });

        const result = await runner.transform('prompt', undefined, customSend);
        expect(result.text).toBe('custom');
        expect(customSend).toHaveBeenCalled();
    });

    it('returns a failure result (does not throw) when sendMessage fails', async () => {
        const { runner } = makeRunner();
        vi.spyOn(runner, 'send').mockResolvedValue({ success: false, error: 'AI error' });

        const result = await runner.transform('prompt');
        expect(result.success).toBe(false);
        expect(result.text).toBe('');
        expect(result.error).toBe('AI error');
    });
});

// ============================================================================
// send() — external client (keepalive)
// ============================================================================

describe('RequestRunner.send() — external client (keepalive)', () => {
    it('uses provided client instead of creating a new one', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'hello' } } });
        const externalClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            resumeSession: vi.fn(),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const createClient = vi.fn();
        const { runner } = makeRunner({ createClient });

        const result = await runner.send({
            prompt: 'test',
            client: externalClient as any,
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(true);
        expect(result.response).toBe('hello');
        expect(createClient).not.toHaveBeenCalled();
    });

    it('does NOT call client.stop() when client is externally provided', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'hello' } } });
        const externalClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner();

        await runner.send({
            prompt: 'test',
            client: externalClient as any,
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
        });

        expect(externalClient.stop).not.toHaveBeenCalled();
    });

    it('still calls session.destroy() even when client is externally provided', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'hello' } } });
        const externalClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner();

        await runner.send({
            prompt: 'test',
            client: externalClient as any,
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
        });

        expect(mockSession.destroy).toHaveBeenCalled();
    });

    it('DOES call client.stop() when client is internally created', async () => {
        const mockSession = createMockSession({ sendAndWaitResponse: { data: { content: 'hello' } } });
        const internalClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(internalClient) });

        await runner.send({ prompt: 'test', timeoutMs: 5000, loadDefaultMcpConfig: false });

        expect(internalClient.stop).toHaveBeenCalled();
    });

    it('does not stop external client on error', async () => {
        const externalClient = {
            createSession: vi.fn().mockRejectedValue(new Error('session failed')),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner();

        const result = await runner.send({
            prompt: 'test',
            client: externalClient as any,
            timeoutMs: 5000,
            loadDefaultMcpConfig: false,
        });

        expect(result.success).toBe(false);
        expect(externalClient.stop).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Proactive MCP OAuth probe
// ============================================================================

describe('RequestRunner.send() — proactive MCP OAuth probe', () => {
    it('calls onMcpOAuthRequired when proactive login returns authorizationUrl', async () => {
        const loginFn = vi.fn().mockResolvedValue({ authorizationUrl: 'https://auth.example.com/authorize' });
        const mockSession = {
            ...createMockSession({ sessionId: 'probe-session' }),
            on: vi.fn().mockReturnValue(() => {}),
            rpc: { mcp: { oauth: { login: loginFn } } },
        };
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        const oauthEvents: any[] = [];
        vi.mocked(loadEffectiveMcpConfig).mockReturnValue({
            success: true,
            fileExists: true,
            mcpServers: { 'remote-server': { type: 'http', url: 'https://mcp.example.com' } },
            configPath: '/fake/mcp.json',
        });

        await runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: true,
            onMcpOAuthRequired: (event) => oauthEvents.push(event),
        });

        // Give the fire-and-forget promise time to resolve
        await new Promise(r => setTimeout(r, 50));

        expect(loginFn).toHaveBeenCalledWith({ serverName: 'remote-server' });
        expect(oauthEvents).toHaveLength(1);
        expect(oauthEvents[0]).toMatchObject({
            serverName: 'remote-server',
            serverUrl: 'https://mcp.example.com',
            authorizationUrl: 'https://auth.example.com/authorize',
            sessionId: 'probe-session',
        });
        expect(oauthEvents[0].requestId).toMatch(/^proactive-remote-server-/);
    });

    it('does not call onMcpOAuthRequired when login returns no authorizationUrl', async () => {
        const loginFn = vi.fn().mockResolvedValue({});
        const mockSession = {
            ...createMockSession({ sessionId: 'no-auth-session' }),
            on: vi.fn().mockReturnValue(() => {}),
            rpc: { mcp: { oauth: { login: loginFn } } },
        };
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        const oauthEvents: any[] = [];
        vi.mocked(loadEffectiveMcpConfig).mockReturnValue({
            success: true,
            fileExists: true,
            mcpServers: { 'remote-server': { type: 'sse', url: 'https://mcp.example.com/sse' } },
            configPath: '/fake/mcp.json',
        });

        await runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: true,
            onMcpOAuthRequired: (event) => oauthEvents.push(event),
        });

        await new Promise(r => setTimeout(r, 50));

        expect(loginFn).toHaveBeenCalledWith({ serverName: 'remote-server' });
        expect(oauthEvents).toHaveLength(0);
    });

    it('does not probe local (stdio) servers', async () => {
        const loginFn = vi.fn().mockResolvedValue({ authorizationUrl: 'https://auth.example.com' });
        const mockSession = {
            ...createMockSession({ sessionId: 'local-session' }),
            on: vi.fn().mockReturnValue(() => {}),
            rpc: { mcp: { oauth: { login: loginFn } } },
        };
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        vi.mocked(loadEffectiveMcpConfig).mockReturnValue({
            success: true,
            fileExists: true,
            mcpServers: { 'local-tool': { command: 'node', args: ['server.js'] } },
            configPath: '/fake/mcp.json',
        });

        await runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: true,
            onMcpOAuthRequired: () => {},
        });

        await new Promise(r => setTimeout(r, 50));

        expect(loginFn).not.toHaveBeenCalled();
    });

    it('handles login probe errors gracefully without blocking', async () => {
        const loginFn = vi.fn().mockRejectedValue(new Error('probe network error'));
        const mockSession = {
            ...createMockSession({ sessionId: 'error-session' }),
            on: vi.fn().mockReturnValue(() => {}),
            rpc: { mcp: { oauth: { login: loginFn } } },
        };
        const mockClient = {
            createSession: vi.fn().mockResolvedValue(mockSession),
            stop: vi.fn().mockResolvedValue(undefined),
        };
        const { runner } = makeRunner({ createClient: vi.fn().mockResolvedValue(mockClient) });

        vi.mocked(loadEffectiveMcpConfig).mockReturnValue({
            success: true,
            fileExists: true,
            mcpServers: { 'failing-server': { type: 'http', url: 'https://down.example.com' } },
            configPath: '/fake/mcp.json',
        });

        // Should not throw despite probe failure
        const result = await runner.send({
            prompt: 'test',
            timeoutMs: 5000,
            loadDefaultMcpConfig: true,
            onMcpOAuthRequired: () => {},
        });

        await new Promise(r => setTimeout(r, 50));

        expect(result.success).toBe(true);
        expect(loginFn).toHaveBeenCalledWith({ serverName: 'failing-server' });
    });
});
