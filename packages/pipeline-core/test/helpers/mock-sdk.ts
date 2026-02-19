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
        createSession: ReturnType<typeof vi.fn>;
        resumeSession: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
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
        createSession: sessionOrFactory === undefined
            ? vi.fn().mockResolvedValue({
                sessionId: 'test-session',
                sendAndWait: vi.fn().mockResolvedValue('response'),
                destroy: vi.fn().mockResolvedValue(undefined),
            })
            : typeof sessionOrFactory === 'function'
                ? vi.fn().mockImplementation(() => Promise.resolve(sessionOrFactory()))
                : vi.fn().mockResolvedValue(sessionOrFactory),
        resumeSession: vi.fn().mockRejectedValue(new Error('Session not found')),
        stop: vi.fn().mockResolvedValue(undefined),
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
        createSession: vi.fn().mockImplementation(() => {
            const s = createSession();
            return Promise.resolve(s.session);
        }),
        resumeSession: vi.fn().mockRejectedValue(new Error('Session not found')),
        stop: vi.fn().mockResolvedValue(undefined),
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
 * instance by setting `sdkModule` and `availabilityCache` on the service
 * internals.
 */
export function setupService(service: CopilotSDKService, session: any): void {
    const { MockCopilotClient } = createMockSDKModule(session);
    const serviceAny = service as any;
    serviceAny.sdkModule = { CopilotClient: MockCopilotClient };
    serviceAny.availabilityCache = { available: true, sdkPath: '/fake/sdk' };
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
        mergeMcpConfigs: vi.fn().mockImplementation(
            (base: Record<string, any>, override?: Record<string, any>) => ({
                ...base,
                ...override,
            }),
        ),
    };
}
