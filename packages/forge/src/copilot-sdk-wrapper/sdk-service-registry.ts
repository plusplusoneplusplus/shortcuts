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
 * The Copilot SDK provider is automatically registered when
 * `CopilotSDKService.getInstance()` is first called.
 */
export const sdkServiceRegistry = new SDKServiceRegistry();
