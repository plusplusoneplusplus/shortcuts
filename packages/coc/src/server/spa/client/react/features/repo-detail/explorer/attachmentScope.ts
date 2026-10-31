/**
 * attachmentScope — one lifetime for everything attached to a mounted Monaco
 * model: registrations, providers, listeners and asynchronous work.
 *
 * `dispose()` aborts `signal` first, so any request still running sees the
 * attachment as gone before its resources are released, then runs each
 * release once, in reverse registration order. It is idempotent, and a
 * release added after disposal runs immediately: nothing outlives the scope.
 */

export interface AttachmentScope {
    /** Aborted when the scope is disposed. */
    readonly signal: AbortSignal;
    /** Registers a release to run on disposal. */
    add(release: () => void): void;
    dispose(): void;
}

export function createAttachmentScope(): AttachmentScope {
    const controller = new AbortController();
    const releases: (() => void)[] = [];
    return {
        signal: controller.signal,
        add(release) {
            if (controller.signal.aborted) release();
            else releases.push(release);
        },
        dispose() {
            if (controller.signal.aborted) return;
            controller.abort();
            let failure: { error: unknown } | null = null;
            while (releases.length > 0) {
                try {
                    releases.pop()!();
                } catch (error) {
                    failure ??= { error };
                }
            }
            if (failure) throw failure.error;
        },
    };
}
