/**
 * WarmStatusBridge — relays WarmClientRegistry transitions to process SSE streams.
 *
 * The SDK services own a `WarmClientRegistry` keyed by `(provider, workingDirectory)`
 * and expose `onWarmStatusChange((key, status) => …)`. A conversation process maps
 * to such a key via its `metadata.provider` + `workingDirectory`. This bridge keeps
 * a `warmKey → interested-process` map: when an SSE stream opens for a process it
 * registers interest; on every registry transition for that key the bridge emits a
 * `warm-status` process event, which `handleProcessStream` relays to the SPA as a
 * `warm_status` SSE event (AC-01).
 *
 * One subscription per provider service is shared across every interested process
 * (the registry already namespaces keys by provider). Providers that can never stay
 * warm (e.g. Claude) omit `onWarmStatusChange`, so their processes register no
 * subscription and the indicator stays cold/invisible.
 */

import type { ProcessStore, ProcessOutputEvent } from '@plusplusoneplusplus/forge';
import { sdkServiceRegistry } from '@plusplusoneplusplus/forge';
import { makeWarmKey, type WarmStatus } from '@plusplusoneplusplus/coc-agent-sdk';

/**
 * Minimal registry surface the bridge depends on. Mirrors `SDKServiceRegistry.get`
 * but is narrowed to just the warm hook so tests can inject a fake without building
 * a full service.
 */
export interface WarmStatusServiceLookup {
    get(name: string): {
        onWarmStatusChange?(listener: (key: string, status: WarmStatus) => void): () => void;
    } | undefined;
}

export interface RegisterWarmInterestOptions {
    /** Store on which the relayed `warm-status` event is emitted. */
    store: ProcessStore;
    /** Conversation process whose warm state should be streamed. */
    processId: string;
    /** Provider id ('copilot' | 'codex' | 'claude' | …) — one half of the warm key. */
    provider: string;
    /** Working directory — the other half of the warm key. */
    workingDirectory?: string;
}

export class WarmStatusBridge {
    /** warmKey → (processId → store) for every open stream interested in that key. */
    private readonly interests = new Map<string, Map<string, ProcessStore>>();
    /** provider → unsubscribe for the single onWarmStatusChange subscription. */
    private readonly subscriptions = new Map<string, () => void>();

    constructor(private readonly registry: WarmStatusServiceLookup = sdkServiceRegistry) {}

    /**
     * Register interest in warm-status transitions for a process's `(provider, cwd)`
     * key. Returns an idempotent unregister function to call when the stream closes.
     */
    register(options: RegisterWarmInterestOptions): () => void {
        const { store, processId, provider, workingDirectory } = options;
        this.ensureSubscribed(provider);

        const key = makeWarmKey(provider, workingDirectory);
        let byProcess = this.interests.get(key);
        if (!byProcess) {
            byProcess = new Map();
            this.interests.set(key, byProcess);
        }
        byProcess.set(processId, store);

        let active = true;
        return () => {
            if (!active) { return; }
            active = false;
            const current = this.interests.get(key);
            if (!current) { return; }
            current.delete(processId);
            if (current.size === 0) { this.interests.delete(key); }
        };
    }

    /**
     * Subscribe to a provider service's warm transitions exactly once. Providers
     * without `onWarmStatusChange` (e.g. Claude) — or not registered yet — are
     * skipped, so their processes simply never receive a warm push and a later
     * registration re-attempts the lookup.
     *
     * Warming is a best-effort latency signal, never a hard dependency: a missing
     * or malformed registry must never surface as an error on the SSE stream, so
     * every step is guarded.
     */
    private ensureSubscribed(provider: string): void {
        if (this.subscriptions.has(provider)) { return; }
        let service: ReturnType<WarmStatusServiceLookup['get']>;
        try {
            service = this.registry?.get?.(provider);
        } catch {
            return;
        }
        if (!service || typeof service.onWarmStatusChange !== 'function') { return; }

        const unsubscribe = service.onWarmStatusChange((key, status) => {
            const byProcess = this.interests.get(key);
            if (!byProcess || byProcess.size === 0) { return; }
            // Snapshot so a re-entrant unregister during emit cannot mutate the
            // map we are iterating.
            for (const [processId, store] of [...byProcess]) {
                try {
                    store.emitProcessEvent(processId, {
                        type: 'warm-status',
                        warmStatus: status,
                    } as unknown as ProcessOutputEvent);
                } catch {
                    // Best-effort: a single bad store must not break the fan-out.
                }
            }
        });
        this.subscriptions.set(provider, unsubscribe);
    }

    /** Tear down all provider subscriptions and interests. Test/shutdown helper. */
    dispose(): void {
        for (const unsubscribe of this.subscriptions.values()) {
            try { unsubscribe(); } catch { /* best-effort */ }
        }
        this.subscriptions.clear();
        this.interests.clear();
    }
}

/** Process-wide singleton wired into the SSE stream handler. */
export const warmStatusBridge = new WarmStatusBridge();
