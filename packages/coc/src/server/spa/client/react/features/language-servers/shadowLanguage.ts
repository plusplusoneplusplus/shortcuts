/**
 * Shadow languages — how an LSP-managed model escapes Monaco's own TypeScript
 * providers without disabling them for everyone else (AC-03).
 *
 * Monaco registers providers per LANGUAGE, and its bundled TypeScript worker
 * claims the `typescript` and `javascript` ids globally. A model left on those
 * ids would answer every hover, completion and diagnostic twice: once from the
 * worker, which sees only the models open in this page and no tsconfig, and
 * once from the real language server. The global switches
 * (`typescriptDefaults.setModeConfiguration`) would silence the worker for every
 * Monaco instance in the page, including chat source canvases and diffs that
 * have no language server behind them.
 *
 * So a live repo document is moved onto a private language id that mirrors the
 * base language's tokenizer and configuration but that nothing else registers
 * providers for. Highlighting, brackets and comments are unchanged; the only
 * thing the model loses is the built-in worker, which is exactly the duplicate.
 *
 * This module stays free of a runtime Monaco dependency, like its neighbours:
 * the namespace is a structurally typed argument and the Monarch definitions
 * are handed in by whoever owns the real Monaco bundle (`monaco-setup.ts`).
 */

/** Prefix of every shadow id, so one is recognizable on sight and in a test. */
export const SHADOW_LANGUAGE_PREFIX = 'coc-lsp-';

/**
 * Base Monaco languages whose bundled workers would duplicate a language
 * server. Everything else (python, go, rust, …) has no built-in provider in
 * this bundle, so its models stay on the base id and need no shadow.
 */
export const SHADOWED_BASE_LANGUAGES: readonly string[] = ['typescript', 'javascript'];

/** The shadow id for `base`, or `null` when the base language needs no shadow. */
export function shadowLanguageId(base: string | null | undefined): string | null {
    if (!base || !SHADOWED_BASE_LANGUAGES.includes(base)) return null;
    return `${SHADOW_LANGUAGE_PREFIX}${base}`;
}

/** The base language a shadow id was made from, or `null` for anything else. */
export function baseLanguageId(languageId: string | null | undefined): string | null {
    if (!languageId || !languageId.startsWith(SHADOW_LANGUAGE_PREFIX)) return null;
    return languageId.slice(SHADOW_LANGUAGE_PREFIX.length);
}

/** A base language's Monarch tokenizer and editor configuration, copied as-is. */
export interface BaseLanguageDefinition {
    conf: unknown;
    language: unknown;
}

/** The slice of the Monaco namespace this module uses. */
export interface ShadowMonaco {
    languages: {
        register(definition: { id: string }): void;
        setLanguageConfiguration(languageId: string, configuration: never): unknown;
        setMonarchTokensProvider(languageId: string, definition: never): unknown;
    };
    editor: {
        setModelLanguage(model: never, languageId: string): void;
        setModelMarkers(model: never, owner: string, markers: never[]): void;
    };
}

/** The slice of a text model this module uses. */
export interface ShadowModel {
    getLanguageId(): string;
}

const registered = new Set<string>();

/**
 * Register the shadow language for each base id in `definitions`, copying that
 * base language's configuration and tokenizer. Idempotent: Monaco keeps one
 * registration per id and re-registering would stack tokenizers.
 */
export function registerShadowLanguages(
    monaco: ShadowMonaco,
    definitions: Record<string, BaseLanguageDefinition>,
): void {
    for (const [base, definition] of Object.entries(definitions)) {
        const id = shadowLanguageId(base);
        if (!id || registered.has(id)) continue;
        registered.add(id);
        monaco.languages.register({ id });
        monaco.languages.setLanguageConfiguration(id, definition.conf as never);
        monaco.languages.setMonarchTokensProvider(id, definition.language as never);
    }
}

/** Forget the registrations, so a test can observe them again. */
export function resetShadowLanguagesForTests(): void {
    registered.clear();
}

/**
 * Move `model` onto the shadow id for its current language, and clear the
 * markers the built-in worker already published on it — those belong to the
 * provider being replaced and nothing else will remove them.
 *
 * Returns the id the model now carries plus a `revert` that puts it back, or
 * `null` when the model needs no shadow (an unshadowed language, an id that was
 * never registered, or a model already on a shadow id).
 */
export function applyShadowLanguage(
    monaco: ShadowMonaco,
    model: ShadowModel,
): { languageId: string; revert: () => void } | null {
    const base = model.getLanguageId();
    const id = shadowLanguageId(base);
    if (!id || !registered.has(id)) return null;

    monaco.editor.setModelLanguage(model as never, id);
    monaco.editor.setModelMarkers(model as never, base, []);
    return {
        languageId: id,
        revert: () => { monaco.editor.setModelLanguage(model as never, base); },
    };
}
