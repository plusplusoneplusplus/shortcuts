/**
 * The provider registry is the single gate on which native CLI session
 * providers exist. These tests lock the invariant that a provider offered by
 * the dashboard is always one the server can actually serve — the drift that
 * previously let `opencode` be selected and deep-linked with no backing
 * provider registered.
 */

import { describe, expect, it } from 'vitest';
import {
    AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS,
    NATIVE_CLI_PROVIDER_DESCRIPTORS,
    NATIVE_CLI_PROVIDER_IDS,
    getNativeCliProviderDescriptor,
    isNativeCliProviderAvailable,
    isNativeCliSessionProviderId,
} from '../../src/server/native-copilot-sessions/types';
import {
    createNativeCliSessionProviders,
    hasNativeCliProviderFactory,
} from '../../src/server/native-copilot-sessions/native-cli-provider-registry';
import { NativeCopilotSessionService } from '../../src/server/native-copilot-sessions/native-copilot-session-service';

function makeProviders() {
    // A missing db path is fine: construction never touches the store, and the
    // registry only needs a service instance to build the Copilot provider.
    const copilotService = new NativeCopilotSessionService({ dbPath: '/nonexistent/session-store.db' });
    return createNativeCliSessionProviders({ copilotService });
}

describe('native CLI provider descriptor contract', () => {
    it('exposes a unique descriptor per known provider id', () => {
        const ids = NATIVE_CLI_PROVIDER_DESCRIPTORS.map(d => d.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toEqual([...NATIVE_CLI_PROVIDER_IDS]);
    });

    it('gives every descriptor complete display and store metadata', () => {
        for (const descriptor of NATIVE_CLI_PROVIDER_DESCRIPTORS) {
            expect(descriptor.label.length).toBeGreaterThan(0);
            expect(descriptor.externalLabel.length).toBeGreaterThan(0);
            expect(descriptor.storeHint.length).toBeGreaterThan(0);
            expect(['native-index', 'on-demand-scan', 'unavailable']).toContain(descriptor.searchStrategy);
        }
    });

    it('requires a planned descriptor to explain why it is not servable', () => {
        for (const descriptor of NATIVE_CLI_PROVIDER_DESCRIPTORS) {
            if (descriptor.status === 'planned') {
                expect(descriptor.plannedNote).toBeTruthy();
            }
        }
    });

    it('recognises only known provider ids', () => {
        expect(isNativeCliSessionProviderId('copilot')).toBe(true);
        expect(isNativeCliSessionProviderId('codex')).toBe(true);
        expect(isNativeCliSessionProviderId('claude')).toBe(true);
        expect(isNativeCliSessionProviderId('opencode')).toBe(true);
        expect(isNativeCliSessionProviderId('gemini')).toBe(false);
        expect(isNativeCliSessionProviderId(undefined)).toBe(false);
    });

    it('stages opencode as planned rather than servable', () => {
        // Regression: `opencode` was accepted by the type, route parser, and UI
        // tab list while the server registry had no provider for it, so the
        // request failed as an internal "not registered" error.
        expect(isNativeCliProviderAvailable('opencode')).toBe(false);
        expect(getNativeCliProviderDescriptor('opencode').status).toBe('planned');
        expect(AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS.map(d => d.id)).not.toContain('opencode');
    });

    it('throws for an unknown descriptor lookup', () => {
        expect(() => getNativeCliProviderDescriptor('gemini' as never)).toThrow(/Unknown native CLI session provider/);
    });
});

describe('createNativeCliSessionProviders', () => {
    it('registers exactly the available descriptors', () => {
        const providers = makeProviders();
        expect([...providers.keys()].sort()).toEqual(
            AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS.map(d => d.id).sort(),
        );
    });

    it('registers a provider for every UI-visible descriptor', () => {
        const providers = makeProviders();
        for (const descriptor of AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS) {
            const provider = providers.get(descriptor.id);
            expect(provider, `no provider registered for ${descriptor.id}`).toBeDefined();
            expect(provider!.provider).toBe(descriptor.id);
            expect(provider!.storePath.length).toBeGreaterThan(0);
            expect(typeof provider!.listSessions).toBe('function');
            expect(typeof provider!.getSession).toBe('function');
        }
    });

    it('makes each provider agree with its descriptor search strategy', () => {
        const providers = makeProviders();
        for (const descriptor of AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS) {
            expect(providers.get(descriptor.id)!.searchStrategy).toBe(descriptor.searchStrategy);
        }
    });

    it('does not register a planned provider', () => {
        expect(makeProviders().has('opencode')).toBe(false);
        expect(hasNativeCliProviderFactory('opencode')).toBe(false);
    });

    it('reports a factory for every available provider', () => {
        for (const descriptor of AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS) {
            expect(hasNativeCliProviderFactory(descriptor.id)).toBe(true);
        }
    });

    it('declares Copilot as natively indexed and file-backed providers as on-demand', () => {
        const providers = makeProviders();
        expect(providers.get('copilot')!.searchStrategy).toBe('native-index');
        expect(providers.get('codex')!.searchStrategy).toBe('on-demand-scan');
        expect(providers.get('claude')!.searchStrategy).toBe('on-demand-scan');
    });
});
