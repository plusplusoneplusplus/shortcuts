/**
 * Tests for SDKServiceRegistry and ISDKService interface.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    SDKServiceRegistry,
    sdkServiceRegistry,
    COPILOT_PROVIDER,
} from '../../src/copilot-sdk-wrapper/sdk-service-registry';
import type { ISDKService } from '../../src/copilot-sdk-wrapper/sdk-service-interface';

// ---------------------------------------------------------------------------
// Minimal stub that satisfies ISDKService structurally
// ---------------------------------------------------------------------------
function makeMockProvider(id = 'mock'): ISDKService {
    return {
        isAvailable: async () => ({ available: true }),
        clearAvailabilityCache: () => {},
        listModels: async () => [{ id, name: `Model ${id}` }],
        sendMessage: async () => ({ success: true, response: 'ok' }),
        transform: async <T = string>(prompt: string, parse?: (raw: string) => T) => {
            const raw = `transformed: ${prompt}`;
            return (parse ? parse(raw) : raw) as T;
        },
        forkSession: async (sid: string) => `${sid}-fork`,
        abortSession: async () => true,
        softAbortSession: async () => true,
        steerSession: async () => true,
        hasActiveSession: () => false,
        getActiveSessionCount: () => 0,
        cleanup: async () => {},
        dispose: () => {},
    };
}

// ---------------------------------------------------------------------------
// SDKServiceRegistry unit tests
// ---------------------------------------------------------------------------

describe('SDKServiceRegistry', () => {
    let registry: SDKServiceRegistry;

    beforeEach(() => {
        registry = new SDKServiceRegistry();
    });

    it('starts empty', () => {
        expect(registry.size).toBe(0);
        expect(registry.getProviderNames()).toEqual([]);
    });

    it('registers and retrieves a provider', () => {
        const mock = makeMockProvider('a');
        registry.register('a', mock);
        expect(registry.get('a')).toBe(mock);
        expect(registry.has('a')).toBe(true);
    });

    it('returns undefined for unknown provider', () => {
        expect(registry.get('unknown')).toBeUndefined();
    });

    it('getOrThrow returns provider when registered', () => {
        const mock = makeMockProvider('b');
        registry.register('b', mock);
        expect(registry.getOrThrow('b')).toBe(mock);
    });

    it('getOrThrow throws for unknown provider', () => {
        expect(() => registry.getOrThrow('missing')).toThrow("SDK service provider 'missing' is not registered");
    });

    it('getOrThrow error message lists registered providers', () => {
        registry.register('alpha', makeMockProvider('alpha'));
        registry.register('beta', makeMockProvider('beta'));
        expect(() => registry.getOrThrow('gamma')).toThrow('alpha');
        expect(() => registry.getOrThrow('gamma')).toThrow('beta');
    });

    it('unregister removes a provider', () => {
        registry.register('c', makeMockProvider('c'));
        expect(registry.has('c')).toBe(true);
        registry.unregister('c');
        expect(registry.has('c')).toBe(false);
        expect(registry.get('c')).toBeUndefined();
    });

    it('unregister is a no-op when provider does not exist', () => {
        expect(() => registry.unregister('nonexistent')).not.toThrow();
    });

    it('overwrite: re-registering same name replaces provider', () => {
        const first = makeMockProvider('first');
        const second = makeMockProvider('second');
        registry.register('slot', first);
        registry.register('slot', second);
        expect(registry.get('slot')).toBe(second);
        expect(registry.size).toBe(1);
    });

    it('getProviderNames returns all registered names', () => {
        registry.register('x', makeMockProvider('x'));
        registry.register('y', makeMockProvider('y'));
        const names = registry.getProviderNames();
        expect(names).toContain('x');
        expect(names).toContain('y');
        expect(names).toHaveLength(2);
    });

    it('size tracks provider count correctly', () => {
        expect(registry.size).toBe(0);
        registry.register('one', makeMockProvider('one'));
        expect(registry.size).toBe(1);
        registry.register('two', makeMockProvider('two'));
        expect(registry.size).toBe(2);
        registry.unregister('one');
        expect(registry.size).toBe(1);
    });

    it('multiple independent registries do not share state', () => {
        const r1 = new SDKServiceRegistry();
        const r2 = new SDKServiceRegistry();
        r1.register('shared', makeMockProvider('r1'));
        expect(r2.has('shared')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Module-level singleton & COPILOT_PROVIDER constant
// ---------------------------------------------------------------------------

describe('sdkServiceRegistry module singleton', () => {
    it('exports a singleton SDKServiceRegistry instance', () => {
        expect(sdkServiceRegistry).toBeInstanceOf(SDKServiceRegistry);
    });

    it('COPILOT_PROVIDER constant equals "copilot"', () => {
        expect(COPILOT_PROVIDER).toBe('copilot');
    });
});

// ---------------------------------------------------------------------------
// ISDKService structural contract
// ---------------------------------------------------------------------------

describe('ISDKService structural contract', () => {
    it('mock provider satisfies ISDKService shape', async () => {
        const svc: ISDKService = makeMockProvider('test');

        const avail = await svc.isAvailable();
        expect(avail.available).toBe(true);

        const models = await svc.listModels();
        expect(models[0].id).toBe('test');
        expect(models[0].name).toContain('test');

        const result = await svc.sendMessage({ prompt: 'hello' });
        expect(result.success).toBe(true);

        const text = await svc.transform('x');
        expect(typeof text).toBe('string');

        const forked = await svc.forkSession('s1');
        expect(forked).toBe('s1-fork');

        expect(await svc.abortSession('s1')).toBe(true);
        expect(await svc.softAbortSession('s1')).toBe(true);
        expect(await svc.steerSession('s1', 'steer')).toBe(true);
        expect(svc.hasActiveSession('s1')).toBe(false);
        expect(svc.getActiveSessionCount()).toBe(0);

        await expect(svc.cleanup()).resolves.toBeUndefined();
        expect(() => svc.dispose()).not.toThrow();
        expect(() => svc.clearAvailabilityCache()).not.toThrow();
    });

    it('transform with parse function returns parsed result', async () => {
        const svc: ISDKService = makeMockProvider('p');
        const result = await svc.transform<number>('prompt', (raw) => raw.length);
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThan(0);
    });
});
