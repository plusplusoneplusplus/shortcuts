/**
 * monacoDiffModelRegistry — reference-counted text models for diff editors.
 *
 * Monaco allows one model per URI. Two diff viewers can show the same file
 * (the right panel and a pop-out), and a file switch disposes the old pair
 * while the new pair is created. The registry hands out a model per URI,
 * counts holders, and disposes a model only when its last holder releases it.
 *
 * A URI that is already taken by a model with different text — our own from
 * another stage, or one created elsewhere in the page — gets a private
 * `#coc-diff-<n>` variant instead of overwriting the other model's text.
 * Models created outside the registry are never disposed by it.
 */

export interface RegistryModel {
    getValue(): string;
    dispose(): void;
}

/** The two Monaco calls the registry needs; `uri` is a URI string. */
export interface ModelHost<M extends RegistryModel> {
    getModel(uri: string): M | null;
    createModel(text: string, language: string, uri: string): M;
}

export interface ModelLease<M extends RegistryModel> {
    model: M;
    /** URI the model actually lives at (differs from the request on conflict). */
    uri: string;
    /** Idempotent. */
    release(): void;
}

export interface ModelRegistry<M extends RegistryModel> {
    acquire(uri: string, text: string, language: string): ModelLease<M>;
    /** Number of registry-owned models still alive (for tests/diagnostics). */
    size(): number;
}

export function createModelRegistry<M extends RegistryModel>(host: ModelHost<M>): ModelRegistry<M> {
    const owned = new Map<string, { model: M; refs: number }>();
    let variant = 0;

    const lease = (uri: string, model: M, onRelease: () => void): ModelLease<M> => {
        let released = false;
        return {
            model,
            uri,
            release() {
                if (released) return;
                released = true;
                onRelease();
            },
        };
    };

    const leaseOwned = (uri: string, entry: { model: M; refs: number }): ModelLease<M> =>
        lease(uri, entry.model, () => {
            entry.refs--;
            if (entry.refs > 0) return;
            owned.delete(uri);
            entry.model.dispose();
        });

    const own = (uri: string, text: string, language: string): ModelLease<M> => {
        const entry = { model: host.createModel(text, language, uri), refs: 1 };
        owned.set(uri, entry);
        return leaseOwned(uri, entry);
    };

    return {
        acquire(uri, text, language) {
            const entry = owned.get(uri);
            if (entry && entry.model.getValue() === text) {
                entry.refs++;
                return leaseOwned(uri, entry);
            }
            if (!entry) {
                const foreign = host.getModel(uri);
                if (!foreign) return own(uri, text, language);
                if (foreign.getValue() === text) return lease(uri, foreign, () => { /* not ours */ });
            }
            variant++;
            return own(`${uri}#coc-diff-${variant}`, text, language);
        },
        size: () => owned.size,
    };
}
