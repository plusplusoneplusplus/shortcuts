/**
 * Smoke tests for the shared SDK mock factories.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createMockSession,
    createStreamingMockSession,
    createMockSDKModule,
    createStreamingMockSDKModule,
    setupService,
    mockTrustedFolderModule,
    mockMcpConfigLoaderModule,
} from './mock-sdk';

describe('mock-sdk helpers', () => {
    describe('createMockSession', () => {
        it('returns object with sessionId, sendAndWait, destroy', () => {
            const s = createMockSession();
            expect(s).toHaveProperty('sessionId');
            expect(s).toHaveProperty('sendAndWait');
            expect(s).toHaveProperty('destroy');
            expect(typeof s.sessionId).toBe('string');
        });

        it('uses provided sessionId', () => {
            const s = createMockSession({ sessionId: 'custom' });
            expect(s.sessionId).toBe('custom');
        });

        it('returns rejecting sendAndWait when sendAndWaitError is provided', async () => {
            const err = new Error('fail');
            const s = createMockSession({ sendAndWaitError: err });
            await expect(s.sendAndWait()).rejects.toThrow('fail');
        });

        it('uses provided sendAndWaitResponse', async () => {
            const s = createMockSession({ sendAndWaitResponse: { data: { content: 'custom' } } });
            const result = await s.sendAndWait();
            expect(result.data.content).toBe('custom');
        });
    });

    describe('createStreamingMockSession', () => {
        it('returns session, dispatchEvent, handlers', () => {
            const result = createStreamingMockSession();
            expect(result).toHaveProperty('session');
            expect(result).toHaveProperty('dispatchEvent');
            expect(result).toHaveProperty('handlers');
        });

        it('dispatchEvent invokes all registered on() handlers', () => {
            const { session, dispatchEvent } = createStreamingMockSession();
            const handler = vi.fn();
            session.on(handler);
            dispatchEvent({ type: 'test', data: { foo: 'bar' } });
            expect(handler).toHaveBeenCalledWith({ type: 'test', data: { foo: 'bar' } });
        });

        it('uses provided sessionId', () => {
            const { session } = createStreamingMockSession('my-session');
            expect(session.sessionId).toBe('my-session');
        });
    });

    describe('createMockSDKModule', () => {
        it('returns MockCopilotClient that captures constructor options', () => {
            const { MockCopilotClient, capturedOptions } = createMockSDKModule();
            new MockCopilotClient({ cwd: '/test' });
            expect(capturedOptions).toHaveLength(1);
            expect(capturedOptions[0].cwd).toBe('/test');
        });

        it('returns default session when called with no arguments', async () => {
            const { mockClient } = createMockSDKModule();
            const session = await mockClient.createSession();
            expect(session.sessionId).toBe('test-session');
        });

        it('uses provided session object', async () => {
            const mock = createMockSession({ sessionId: 'provided' });
            const { mockClient } = createMockSDKModule(mock);
            const session = await mockClient.createSession();
            expect(session.sessionId).toBe('provided');
        });

        it('uses provided factory function', async () => {
            const factory = () => createMockSession({ sessionId: 'from-factory' });
            const { mockClient } = createMockSDKModule(factory);
            const session = await mockClient.createSession();
            expect(session.sessionId).toBe('from-factory');
        });
    });

    describe('createStreamingMockSDKModule', () => {
        it('tracks sessions in sessions array', async () => {
            const { mockClient, sessions } = createStreamingMockSDKModule();
            await mockClient.createSession();
            await mockClient.createSession();
            expect(sessions).toHaveLength(2);
        });
    });

    describe('setupService', () => {
        it('sets sdkModule and availabilityCache on service internals', () => {
            const fakeService = {} as any;
            const session = createMockSession();
            setupService(fakeService, session);
            expect(fakeService.sdkModule).toBeDefined();
            expect(fakeService.availabilityCache).toEqual({ available: true, sdkPath: '/fake/sdk' });
        });
    });

    describe('mockTrustedFolderModule', () => {
        it('returns object with ensureFolderTrusted as vi.fn', () => {
            const mod = mockTrustedFolderModule();
            expect(mod.ensureFolderTrusted).toBeDefined();
            expect(vi.isMockFunction(mod.ensureFolderTrusted)).toBe(true);
        });
    });

    describe('mockMcpConfigLoaderModule', () => {
        it('returns object with loadDefaultMcpConfig and mergeMcpConfigs', () => {
            const mod = mockMcpConfigLoaderModule();
            expect(mod.loadDefaultMcpConfig).toBeDefined();
            expect(mod.mergeMcpConfigs).toBeDefined();
            expect(vi.isMockFunction(mod.loadDefaultMcpConfig)).toBe(true);
            expect(vi.isMockFunction(mod.mergeMcpConfigs)).toBe(true);
        });
    });
});
