/**
 * The server-side native CLI session provider registry.
 *
 * Every provider the dashboard can select is constructed here from the shared
 * {@link NATIVE_CLI_PROVIDER_DESCRIPTORS} contract. Because the descriptor list
 * is also what the dashboard renders its tab list from, a provider cannot be
 * offered in the UI without a factory here — the partial-wiring failure that
 * previously let `opencode` be selected and deep-linked while the server had no
 * provider to serve it.
 */

import {
    AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS,
    getNativeCliProviderDescriptor,
} from './types';
import type { NativeCliSessionProviderId, NativeSessionProvider } from './types';
import {
    ClaudeNativeSessionProvider,
    CodexNativeSessionProvider,
    CopilotNativeSessionProvider,
} from './native-cli-session-service';
import type { NativeCopilotSessionService } from './native-copilot-session-service';

export interface NativeCliProviderRegistryOptions {
    /** Backing service for the SQLite-indexed Copilot store. */
    copilotService: NativeCopilotSessionService;
}

/** Factory per servable provider id. Keys must cover every `available` descriptor. */
type ProviderFactories = Record<
    NativeCliSessionProviderId,
    ((options: NativeCliProviderRegistryOptions) => NativeSessionProvider) | undefined
>;

const PROVIDER_FACTORIES: ProviderFactories = {
    copilot: ({ copilotService }) => new CopilotNativeSessionProvider(copilotService),
    codex: () => new CodexNativeSessionProvider(),
    claude: () => new ClaudeNativeSessionProvider(),
    // `opencode` is a `planned` descriptor: CoC has no reader for its store, so
    // it is deliberately absent here and hidden from the dashboard tab list.
    opencode: undefined,
};

/**
 * Builds the provider map served by the native CLI session routes.
 *
 * Throws when an `available` descriptor has no factory, so a half-wired
 * provider fails at server construction instead of surfacing as a runtime
 * "provider is not registered" error to a user who selected it in the UI.
 */
export function createNativeCliSessionProviders(
    options: NativeCliProviderRegistryOptions,
): Map<NativeCliSessionProviderId, NativeSessionProvider> {
    const providers = new Map<NativeCliSessionProviderId, NativeSessionProvider>();
    for (const descriptor of AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS) {
        const factory = PROVIDER_FACTORIES[descriptor.id];
        if (!factory) {
            throw new Error(
                `Native CLI session provider "${descriptor.id}" is declared available but has no server factory.`,
            );
        }
        const provider = factory(options);
        if (provider.searchStrategy !== descriptor.searchStrategy) {
            throw new Error(
                `Native CLI session provider "${descriptor.id}" reports search strategy `
                + `"${provider.searchStrategy}" but its descriptor declares `
                + `"${descriptor.searchStrategy}".`,
            );
        }
        providers.set(descriptor.id, provider);
    }
    return providers;
}

/** True when the id is declared servable and has a registered factory. */
export function hasNativeCliProviderFactory(id: NativeCliSessionProviderId): boolean {
    return getNativeCliProviderDescriptor(id).status === 'available'
        && PROVIDER_FACTORIES[id] !== undefined;
}
