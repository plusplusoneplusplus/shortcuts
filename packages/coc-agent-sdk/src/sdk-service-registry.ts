/**
 * SDKServiceRegistry — named-provider registry for ISDKService instances.
 *
 * Replaces the singleton access pattern (`CopilotSDKService.getInstance()`)
 * with a name-keyed registry so multiple providers (Copilot, Codex, Claude, …)
 * can coexist and callers can look up a provider by name.
 *
 * The module also exports the `COPILOT_PROVIDER` constant used as the
 * well-known registry key for the Copilot SDK provider.
 */

import type { ISDKService } from './sdk-service-interface';

// Well-known provider name for the Copilot SDK implementation.
export const COPILOT_PROVIDER = 'copilot';

// Well-known provider name for the Codex SDK implementation.
export const CODEX_PROVIDER = 'codex';

// Well-known provider name for the Claude SDK implementation.
export const CLAUDE_PROVIDER = 'claude';

/**
 * Alias for `COPILOT_PROVIDER` — use this constant at call sites so the
 * name clearly communicates its role as the registry key for the Copilot
 * SDK provider.
 *
 * Usage: `sdkServiceRegistry.getOrThrow(SDK_PROVIDER_COPILOT)`
 */
export const SDK_PROVIDER_COPILOT = COPILOT_PROVIDER;

/**
 * Alias for `CODEX_PROVIDER` — use this constant at call sites so the
 * name clearly communicates its role as the registry key for the Codex
 * SDK provider.
 *
 * Usage: `sdkServiceRegistry.getOrThrow(SDK_PROVIDER_CODEX)`
 */
export const SDK_PROVIDER_CODEX = CODEX_PROVIDER;

/**
 * Alias for `CLAUDE_PROVIDER` — use this constant at call sites so the
 * name clearly communicates its role as the registry key for the Claude
 * SDK provider.
 *
 * Usage: `sdkServiceRegistry.getOrThrow(SDK_PROVIDER_CLAUDE)`
 */
export const SDK_PROVIDER_CLAUDE = CLAUDE_PROVIDER;

/**
 * Registry that maps provider names to `ISDKService` instances.
 *
 * Usage:
 * ```ts
 * // Registration (done once, typically during provider init):
 * sdkServiceRegistry.register('copilot', new CopilotSDKService());
 *
 * // Lookup:
 * const svc = sdkServiceRegistry.getOrThrow('copilot');
 * ```
 */
export class SDKServiceRegistry {
    private readonly providers = new Map<string, ISDKService>();

    /**
     * Register a provider under the given name.
     * Overwrites any previously registered provider with the same name.
     */
    register(name: string, provider: ISDKService): void {
        this.providers.set(name, provider);
    }

    /**
     * Look up a provider by name.
     * Returns `undefined` when no provider is registered under that name.
     */
    get(name: string): ISDKService | undefined {
        return this.providers.get(name);
    }

    /**
     * Look up a provider by name, throwing when none is found.
     */
    getOrThrow(name: string): ISDKService {
        const provider = this.providers.get(name);
        if (!provider) {
            throw new Error(
                `SDK service provider '${name}' is not registered. ` +
                `Registered providers: [${[...this.providers.keys()].join(', ')}]`,
            );
        }
        return provider;
    }

    /**
     * Remove the provider registered under the given name.
     * No-ops silently when the name is not found.
     */
    unregister(name: string): void {
        this.providers.delete(name);
    }

    /** Returns `true` when a provider is registered under the given name. */
    has(name: string): boolean {
        return this.providers.has(name);
    }

    /** Returns the names of all currently registered providers. */
    getProviderNames(): string[] {
        return [...this.providers.keys()];
    }

    /** Returns the count of registered providers. */
    get size(): number {
        return this.providers.size;
    }
}

/**
 * Module-level registry singleton.
 * The public Forge entrypoint registers the default Copilot SDK provider on
 * load, and `CopilotSDKService.getInstance()` re-registers it if absent.
 */
export const sdkServiceRegistry = new SDKServiceRegistry();
