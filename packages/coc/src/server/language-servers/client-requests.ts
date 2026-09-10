/**
 * Built-in answers to the requests a language server sends back to the client.
 *
 * A standard server assumes the client answers a small set of requests during
 * and after initialization. Replying `-32601` to those is legal but degrades
 * the server: `tsserver`, for one, falls back to defaults when nobody answers
 * `workspace/configuration`, and cannot register dynamic capabilities at all.
 *
 * Everything here is language-neutral. The only data it uses is the
 * definition's own `settings` object and the session's workspace folders, so
 * no server-specific branch ever reaches this module.
 */

import type { ServerRequestHandler } from './connection';
import type { JsonValue } from './types';

/** A capability the server registered after initialization. */
export interface DynamicRegistration {
    id: string;
    method: string;
    registerOptions?: unknown;
}

export interface WorkspaceFolder {
    uri: string;
    name: string;
}

export interface ClientRequestOptions {
    /** The definition's `settings`, used to answer `workspace/configuration`. */
    settings?: JsonValue;
    /** Current folders, read at request time so a reconnect stays correct. */
    workspaceFolders: () => WorkspaceFolder[];
    /** Called when the registration set changes, for status reporting. */
    onRegistrationsChanged?: (registrations: DynamicRegistration[]) => void;
}

/**
 * Resolves one `workspace/configuration` item against a settings object.
 *
 * `section` is a dotted path (`typescript.inlayHints`). A missing path is
 * `null`, which the specification defines as "no value", not an error.
 */
export function resolveConfigurationSection(settings: JsonValue | undefined, section?: unknown): JsonValue | null {
    if (settings === undefined) {
        return null;
    }
    if (typeof section !== 'string' || section.length === 0) {
        return settings ?? null;
    }
    let current: JsonValue = settings;
    for (const key of section.split('.')) {
        if (current === null || typeof current !== 'object' || Array.isArray(current)) {
            return null;
        }
        const next: JsonValue | undefined = (current as { [k: string]: JsonValue })[key];
        if (next === undefined) {
            return null;
        }
        current = next;
    }
    return current;
}

/**
 * The client half of the protocol: the handlers a session installs on every
 * connection, plus the dynamic registrations collected from the server.
 *
 * Registrations are per connection. `reset()` runs before each handshake so a
 * restarted server never inherits the previous process's registrations.
 */
export class LanguageServerClientRequests {
    private readonly options: ClientRequestOptions;
    private readonly registrations = new Map<string, DynamicRegistration>();

    constructor(options: ClientRequestOptions) {
        this.options = options;
    }

    /** Capabilities registered by the running server, in registration order. */
    getRegistrations(): DynamicRegistration[] {
        return [...this.registrations.values()];
    }

    /** True when the server registered `method` dynamically. */
    hasRegistration(method: string): boolean {
        for (const registration of this.registrations.values()) {
            if (registration.method === method) {
                return true;
            }
        }
        return false;
    }

    /** Drops registrations from a previous connection. */
    reset(): void {
        if (this.registrations.size === 0) {
            return;
        }
        this.registrations.clear();
        this.options.onRegistrationsChanged?.([]);
    }

    /**
     * Handlers keyed by LSP method. A caller's own `onRequest` for the same
     * method is installed after these and wins, so nothing here is a ceiling.
     */
    handlers(): Map<string, ServerRequestHandler> {
        const handlers = new Map<string, ServerRequestHandler>();
        handlers.set('workspace/configuration', (params) => this.configuration(params));
        handlers.set('workspace/workspaceFolders', () => this.options.workspaceFolders());
        handlers.set('client/registerCapability', (params) => this.register(params));
        handlers.set('client/unregisterCapability', (params) => this.unregister(params));
        // Progress reporting is accepted and ignored: the server may report,
        // but CoC has no progress surface for it yet. Refusing the create
        // request makes some servers withhold results entirely.
        handlers.set('window/workDoneProgress/create', () => null);
        return handlers;
    }

    private configuration(params: unknown): JsonValue[] {
        const items = (params as { items?: unknown } | undefined)?.items;
        if (!Array.isArray(items)) {
            return [];
        }
        return items.map((item) => resolveConfigurationSection(this.options.settings, (item as { section?: unknown })?.section));
    }

    private register(params: unknown): null {
        const entries = (params as { registrations?: unknown } | undefined)?.registrations;
        if (!Array.isArray(entries)) {
            return null;
        }
        let changed = false;
        for (const entry of entries) {
            const registration = asRegistration(entry);
            if (registration) {
                this.registrations.set(registration.id, registration);
                changed = true;
            }
        }
        if (changed) {
            this.options.onRegistrationsChanged?.(this.getRegistrations());
        }
        return null;
    }

    private unregister(params: unknown): null {
        // The specification spells this field `unregisterations`; some servers
        // send the corrected spelling, so both are accepted.
        const source = params as { unregisterations?: unknown; unregistrations?: unknown } | undefined;
        const entries = Array.isArray(source?.unregisterations) ? source?.unregisterations : source?.unregistrations;
        if (!Array.isArray(entries)) {
            return null;
        }
        let changed = false;
        for (const entry of entries) {
            const id = (entry as { id?: unknown })?.id;
            if (typeof id === 'string' && this.registrations.delete(id)) {
                changed = true;
            }
        }
        if (changed) {
            this.options.onRegistrationsChanged?.(this.getRegistrations());
        }
        return null;
    }
}

function asRegistration(entry: unknown): DynamicRegistration | undefined {
    const candidate = entry as { id?: unknown; method?: unknown; registerOptions?: unknown } | undefined;
    if (typeof candidate?.id !== 'string' || typeof candidate.method !== 'string') {
        return undefined;
    }
    return { id: candidate.id, method: candidate.method, registerOptions: candidate.registerOptions };
}

/**
 * Client capabilities sent when a caller does not supply its own.
 *
 * They advertise exactly what the runtime can honor: the handlers above, the
 * document synchronization the document layer performs, and the language
 * features selected for the first release. Advertising more would invite a
 * server to send requests nothing answers.
 */
export const DEFAULT_CLIENT_CAPABILITIES: JsonValue = {
    general: {
        positionEncodings: ['utf-16'],
    },
    workspace: {
        configuration: true,
        workspaceFolders: true,
        didChangeConfiguration: { dynamicRegistration: true },
        didChangeWatchedFiles: { dynamicRegistration: true },
    },
    window: {
        workDoneProgress: true,
    },
    textDocument: {
        synchronization: { dynamicRegistration: true, didSave: true, willSave: false, willSaveWaitUntil: false },
        publishDiagnostics: { relatedInformation: true, versionSupport: true },
        hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
        definition: { dynamicRegistration: true, linkSupport: true },
        references: { dynamicRegistration: true },
        completion: {
            dynamicRegistration: true,
            contextSupport: true,
            completionItem: {
                snippetSupport: false,
                documentationFormat: ['markdown', 'plaintext'],
                resolveSupport: { properties: ['documentation', 'detail'] },
            },
        },
        signatureHelp: {
            dynamicRegistration: true,
            signatureInformation: { documentationFormat: ['markdown', 'plaintext'] },
        },
    },
};
