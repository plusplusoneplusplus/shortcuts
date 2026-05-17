/**
 * Shared SDK mock factories for CopilotSDKService tests.
 *
 * Consolidates duplicated mock helpers from:
 *   - test/ai/copilot-sdk-service.test.ts
 *   - test/sdk-session-keep-alive.test.ts
 *   - test/ai/copilot-sdk-service-keep-alive.test.ts
 */

import { vi } from 'vitest';
import type { CopilotSDKService } from '../../src/copilot-sdk-wrapper/copilot-sdk-service';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Shape of a non-streaming mock session */
export interface MockSession {
    sessionId: string;
    sendAndWait: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setModel: ReturnType<typeof vi.fn>;
}

/** Shape of a streaming mock session (extends MockSession with event support) */
export interface MockStreamingSession extends MockSession {
    on: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
}

/** Return type of createStreamingMockSession() */
export interface StreamingMockSessionResult {
    session: MockStreamingSession;
    dispatchEvent: (event: { type: string; data?: any }) => void;
    handlers: Array<(event: any) => void>;
}

/** Return type of createMockSDKModule() / createStreamingMockSDKModule() */
export interface MockSDKModule {
    MockCopilotClient: new (options?: any) => any;
    capturedOptions: any[];
    mockClient: {
        start: ReturnType<typeof vi.fn>;
        createSession: ReturnType<typeof vi.fn>;
        resumeSession: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        listModels: ReturnType<typeof vi.fn>;
    };
}

/** Extended return type for streaming SDK module */
export interface StreamingMockSDKModule extends MockSDKModule {
    sessions: StreamingMockSessionResult[];
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Create a non-streaming mock session.
 *
 * Accepts optional overrides for sessionId, sendAndWaitResponse, and
 * sendAndWaitError.
 */
export function createMockSession(overrides?: Partial<{
    sessionId: string;
    sendAndWaitResponse: any;
    sendAndWaitError: Error;
}>): MockSession {
    const sessionId = overrides?.sessionId ?? 'test-session-' + Math.random().toString(36).substring(7);
    return {
        sessionId,
        sendAndWait: overrides?.sendAndWaitError
            ? vi.fn().mockRejectedValue(overrides.sendAndWaitError)
            : vi.fn().mockResolvedValue(
                overrides?.sendAndWaitResponse ?? { data: { content: 'mock response' } }
            ),
        destroy: vi.fn().mockResolvedValue(undefined),
        setModel: vi.fn().mockResolvedValue(undefined),
    };
}

/**
 * Create a streaming mock session with event dispatch support.
 *
 * @param sessionId - Optional session ID; auto-generated if omitted.
 */
export function createStreamingMockSession(sessionId?: string): StreamingMockSessionResult {
    const handlers: Array<(event: any) => void> = [];
    const sid = sessionId ?? 'streaming-session-' + Math.random().toString(36).substring(7);

    const session: MockStreamingSession = {
        sessionId: sid,
        sendAndWait: vi.fn(),
        destroy: vi.fn().mockResolvedValue(undefined),
        setModel: vi.fn().mockResolvedValue(undefined),
        on: vi.fn().mockImplementation((handler: (event: any) => void) => {
            handlers.push(handler);
            return () => {
                const idx = handlers.indexOf(handler);
                if (idx >= 0) handlers.splice(idx, 1);
            };
        }),
        send: vi.fn().mockResolvedValue(undefined),
    };

    const dispatchEvent = (event: { type: string; data?: any }) => {
        for (const handler of [...handlers]) {
            handler(event);
        }
    };

    return { session, dispatchEvent, handlers };
}

/**
 * Create a mock SDK module with MockCopilotClient class and mockClient.
 *
 * - No arguments: returns a default mock session (matching copilot-sdk-service.test.ts)
 * - With a session object or factory function: delegates to that
 *   (matching the keep-alive test files)
 */
export function createMockSDKModule(sessionOrFactory?: any): MockSDKModule {
    const capturedOptions: any[] = [];

    const mockClient = {
        start: vi.fn().mockResolvedValue(undefined),
        createSession: sessionOrFactory === undefined
            ? vi.fn().mockResolvedValue({
                sessionId: 'test-session',
                sendAndWait: vi.fn().mockResolvedValue('response'),
                destroy: vi.fn().mockResolvedValue(undefined),
                setModel: vi.fn().mockResolvedValue(undefined),
            })
            : typeof sessionOrFactory === 'function'
                ? vi.fn().mockImplementation(() => Promise.resolve(sessionOrFactory()))
                : vi.fn().mockResolvedValue(sessionOrFactory),
        resumeSession: vi.fn().mockRejectedValue(new Error('Session not found')),
        stop: vi.fn().mockResolvedValue(undefined),
        listModels: vi.fn().mockResolvedValue([]),
    };

    class MockCopilotClient {
        constructor(options?: any) {
            capturedOptions.push(options);
            Object.assign(this, mockClient);
        }
    }

    return { MockCopilotClient, capturedOptions, mockClient };
}

/**
 * Create a streaming-capable mock SDK module.
 * Tracks all created sessions in a `sessions` array.
 */
export function createStreamingMockSDKModule(
    sessionFactory?: () => StreamingMockSessionResult,
): StreamingMockSDKModule {
    const capturedOptions: any[] = [];
    const sessions: StreamingMockSessionResult[] = [];

    const createSession = () => {
        const s = sessionFactory ? sessionFactory() : createStreamingMockSession();
        sessions.push(s);
        return s;
    };

    const mockClient = {
        start: vi.fn().mockResolvedValue(undefined),
        createSession: vi.fn().mockImplementation(() => {
            const s = createSession();
            return Promise.resolve(s.session);
        }),
        resumeSession: vi.fn().mockRejectedValue(new Error('Session not found')),
        stop: vi.fn().mockResolvedValue(undefined),
        listModels: vi.fn().mockResolvedValue([]),
    };

    class MockCopilotClient {
        constructor(options?: any) {
            capturedOptions.push(options);
            Object.assign(this, mockClient);
        }
    }

    return { MockCopilotClient, capturedOptions, mockClient, sessions };
}

/**
 * Convenience function that wires a mock SDK module into a CopilotSDKService
 * instance by setting `availabilityCache` on the service internals.
 */
export function setupService(service: CopilotSDKService, session: any): void {
    const serviceAny = service as any;
    serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };
}

/**
 * Wire a MockCopilotClient into a CopilotSDKService so that `createClient()`
 * returns instances of the mock.
 *
 * After the refactoring to static SDK imports, the service no longer has a
 * `sdkModule` field. Instead, `createClient()` calls `createSdkClient()`
 * from `sdk-client-factory.ts`, which does `new CopilotClient(...)`.
 *
 * Tests that mock `../../src/copilot-sdk-wrapper/sdk-client-factory` can use
 * this helper to configure what `createSdkClient` returns.
 *
 * For tests that DON'T mock the factory module, this function falls back to
 * overriding the service's `createClient` method directly.
 */
export function wireServiceMock(
    service: CopilotSDKService,
    MockCopilotClient: new (options?: any) => any,
    createSdkClientMock?: ReturnType<typeof vi.fn>,
): void {
    const serviceAny = service as any;
    serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };

    if (createSdkClientMock) {
        createSdkClientMock.mockImplementation((options: any) => new MockCopilotClient(options));
    }
}

/**
 * Returns the mock factory object for vi.mock() of the trusted-folder module.
 */
export function mockTrustedFolderModule() {
    return {
        ensureFolderTrusted: vi.fn(),
    };
}

/**
 * Returns the mock factory object for vi.mock() of the mcp-config-loader module.
 */
export function mockMcpConfigLoaderModule() {
    return {
        loadDefaultMcpConfig: vi.fn().mockReturnValue({
            success: false,
            fileExists: false,
            mcpServers: {},
        }),
        loadWorkspaceMcpConfig: vi.fn().mockReturnValue({
            success: false,
            fileExists: false,
            mcpServers: {},
        }),
        loadEffectiveMcpConfig: vi.fn().mockReturnValue({
            success: true,
            fileExists: false,
            configPath: '',
            mcpServers: {},
        }),
        mergeMcpConfigs: vi.fn().mockImplementation(
            (base: Record<string, any>, override?: Record<string, any>) => ({
                ...base,
                ...override,
            }),
        ),
        mergeMcpConfigSources: vi.fn().mockImplementation(
            (
                globalConfig: Record<string, any>,
                workspaceConfig: Record<string, any>,
                explicitConfig?: Record<string, any>,
            ) => ({
                ...globalConfig,
                ...workspaceConfig,
                ...explicitConfig,
            }),
        ),
    };
}
