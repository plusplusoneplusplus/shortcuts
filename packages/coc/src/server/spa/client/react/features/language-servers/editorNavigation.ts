/**
 * Surface-aware navigation — where "go to definition" lands (AC-03).
 *
 * Monaco resolves a definition or a reference to a URI plus a range. When that
 * URI names the model the user is already in, Monaco moves the cursor itself
 * and this module never runs. When it names another file, Monaco asks its
 * editor service to open it, and a standalone Monaco has nowhere to put it: the
 * default behaviour is to do nothing at all.
 *
 * `monaco.editor.registerEditorOpener` is the supported seam for that, and it
 * hands the callback the code editor that STARTED the navigation. That is the
 * whole reason this module exists: the Explorer sub-tab and the right panel
 * both render the same preview pane, so the target has to open in the strip the
 * user was looking at, not in whichever surface mounted last. Each pane
 * registers its own handler against its own model, and the opener dispatches on
 * the source editor's model.
 *
 * Like its neighbours, this module carries no runtime Monaco dependency: the
 * namespace and the editor are structurally typed arguments, so the registry
 * and the dispatch are testable without a bundle.
 */

import { parseBrowserDocumentUri } from './documentStore';

export const SYMBOL_CANDIDATE_FRAGMENT = 'symbol-index-candidate';

/** Where a navigation wants to land: a repo file and a one-based position. */
export interface LanguageNavigationTarget {
    workspaceId: string;
    /** Repo-relative path, decoded from the document URI. */
    path: string;
    /** One-based line of the target range's start. */
    line: number;
    /** One-based column of the target range's start. */
    column: number;
    /** Present only when the repository symbol index supplied this target. */
    symbolCandidate?: true;
}

/**
 * Opens `target` in the surface that owns the initiating editor. Returning
 * `false` declines the navigation, which lets Monaco fall through to any other
 * opener rather than silently swallowing it.
 */
export type LanguageNavigationHandler = (target: LanguageNavigationTarget) => boolean | void;

export interface NavigationDisposable {
    dispose(): void;
}

/** The slice of a text model this module uses for identity and same-file checks. */
export interface NavigationModel {
    uri?: { toString(): string };
}

/** The slice of a code editor Monaco hands the opener. */
export interface NavigationSourceEditor {
    getModel(): NavigationModel | null;
}

/** Monaco's `IPosition` or `IRange`, whichever the caller supplied. */
export interface NavigationSelection {
    lineNumber?: number;
    column?: number;
    startLineNumber?: number;
    startColumn?: number;
}

/** The slice of the Monaco namespace this module uses. */
export interface NavigationMonaco {
    editor: {
        registerEditorOpener(opener: {
            openCodeEditor(
                source: NavigationSourceEditor,
                resource: { toString(): string },
                selectionOrPosition?: NavigationSelection,
            ): boolean | Promise<boolean>;
        }): NavigationDisposable;
    };
}

const navigators = new Map<NavigationModel, LanguageNavigationHandler>();

let installed: NavigationDisposable | null = null;

/**
 * Claim navigations that start in `model`. One model, one handler: a second
 * registration for the same model replaces the first, and disposing only clears
 * the entry it made, so a late unmount cannot unregister a fresh pane.
 */
export function registerEditorNavigator(
    model: NavigationModel,
    handler: LanguageNavigationHandler,
): NavigationDisposable {
    navigators.set(model, handler);
    return {
        dispose: () => {
            if (navigators.get(model) === handler) navigators.delete(model);
        },
    };
}

/** One-based start of `selection`, defaulting to the top of the file. */
export function toRevealPosition(
    selection: NavigationSelection | null | undefined,
): { line: number; column: number } {
    const line = selection?.startLineNumber ?? selection?.lineNumber;
    const column = selection?.startColumn ?? selection?.column;
    return {
        line: typeof line === 'number' && Number.isFinite(line) && line >= 1 ? line : 1,
        column: typeof column === 'number' && Number.isFinite(column) && column >= 1 ? column : 1,
    };
}

/**
 * Install the single global opener. Idempotent, because the module that owns
 * the Monaco bundle imports it once but a test may not: a second call returns
 * the first registration rather than stacking a second opener that would answer
 * the same navigation twice.
 */
export function installLanguageEditorOpener(monaco: NavigationMonaco): NavigationDisposable {
    if (installed) return installed;
    const registration = monaco.editor.registerEditorOpener({
        openCodeEditor: (source, resource, selectionOrPosition) => {
            const model = source?.getModel?.();
            if (!model) return false;
            const handler = navigators.get(model);
            if (!handler) return false;
            const resourceUri = resource.toString();
            const document = parseBrowserDocumentUri(resourceUri);
            if (!document) return false;
            const sourceDocument = model.uri
                ? parseBrowserDocumentUri(model.uri.toString())
                : null;
            if (
                sourceDocument
                && sourceDocument.workspaceId === document.workspaceId
                && sourceDocument.path === document.path
            ) {
                return false;
            }
            const { line, column } = toRevealPosition(selectionOrPosition);
            return handler({
                ...document,
                line,
                column,
                ...(resourceUri.endsWith(`#${SYMBOL_CANDIDATE_FRAGMENT}`) ? { symbolCandidate: true } : {}),
            }) !== false;
        },
    });
    const disposable: NavigationDisposable = {
        dispose: () => {
            if (installed === disposable) installed = null;
            registration.dispose();
        },
    };
    installed = disposable;
    return disposable;
}

/** Drop the registry and the installed opener, so a test starts clean. */
export function resetEditorNavigationForTests(): void {
    navigators.clear();
    installed = null;
}
