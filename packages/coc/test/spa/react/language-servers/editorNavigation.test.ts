// @vitest-environment jsdom
/**
 * AC-03: where a cross-file "go to definition" lands.
 *
 * Monaco resolves the target and then asks its editor service to open it. This
 * suite drives the real opener with a stand-in Monaco namespace and pins the
 * two things the surfaces depend on: the navigation goes to the pane whose
 * model STARTED it, and anything that is not a live repo document in this
 * workspace is declined so Monaco can fall through instead of opening the wrong
 * thing.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    installLanguageEditorOpener,
    registerEditorNavigator,
    resetEditorNavigationForTests,
    toRevealPosition,
    type LanguageNavigationTarget,
} from '../../../../src/server/spa/client/react/features/language-servers/editorNavigation';
import {
    browserDocumentUri,
    parseBrowserDocumentUri,
} from '../../../../src/server/spa/client/react/features/language-servers/documentStore';

/** The one opener Monaco would hold, captured so the test can call it. */
interface Installed {
    open(
        model: object | null,
        uri: string,
        selection?: Record<string, number>,
    ): boolean | Promise<boolean>;
    disposed(): number;
}

function installOpener(): Installed {
    let opener: any = null;
    let disposals = 0;
    installLanguageEditorOpener({
        editor: {
            registerEditorOpener: (registered: any) => {
                opener = registered;
                return { dispose: () => { disposals += 1; } };
            },
        },
    } as never);
    return {
        open: (model, uri, selection) => opener.openCodeEditor(
            { getModel: () => model },
            { toString: () => uri },
            selection,
        ),
        disposed: () => disposals,
    };
}

beforeEach(() => {
    resetEditorNavigationForTests();
});

afterEach(() => {
    resetEditorNavigationForTests();
});

describe('parseBrowserDocumentUri', () => {
    it('round-trips a path with spaces and non-ASCII characters', () => {
        const uri = browserDocumentUri('ws-1', 'src/nested dir/héllo.ts');
        expect(uri).toBe('coc-file://ws-1/src/nested%20dir/h%C3%A9llo.ts');
        expect(parseBrowserDocumentUri(uri)).toEqual({
            workspaceId: 'ws-1',
            path: 'src/nested dir/héllo.ts',
        });
    });

    it('decodes a workspace id that needed encoding', () => {
        const uri = browserDocumentUri('ws/one', 'a.ts');
        expect(parseBrowserDocumentUri(uri)).toEqual({ workspaceId: 'ws/one', path: 'a.ts' });
    });

    it('refuses anything that is not a live repo document', () => {
        // A dependency outside the workspace: routing it through the repo's own
        // file endpoint is exactly what must not happen.
        expect(parseBrowserDocumentUri('file:///home/me/node_modules/x/index.d.ts')).toBeNull();
        expect(parseBrowserDocumentUri('inmemory://model/1')).toBeNull();
        expect(parseBrowserDocumentUri('coc-file://ws-1/')).toBeNull();
        expect(parseBrowserDocumentUri('coc-file://ws-1')).toBeNull();
        // Percent-encoding that will not decode must not throw.
        expect(parseBrowserDocumentUri('coc-file://ws-1/a%ZZ.ts')).toBeNull();
    });
});

describe('toRevealPosition', () => {
    it('takes the start of a range', () => {
        expect(toRevealPosition({ startLineNumber: 12, startColumn: 5, endLineNumber: 12, endColumn: 9 }))
            .toEqual({ line: 12, column: 5 });
    });

    it('takes a bare position', () => {
        expect(toRevealPosition({ lineNumber: 3, column: 7 })).toEqual({ line: 3, column: 7 });
    });

    it('falls back to the top of the file', () => {
        expect(toRevealPosition(undefined)).toEqual({ line: 1, column: 1 });
        expect(toRevealPosition({ lineNumber: 0, column: -4 })).toEqual({ line: 1, column: 1 });
        expect(toRevealPosition({ lineNumber: Number.NaN, column: Number.NaN }))
            .toEqual({ line: 1, column: 1 });
    });
});

describe('editor opener', () => {
    it('routes a navigation to the surface whose model started it', async () => {
        const opener = installOpener();
        const explorerModel = { id: 'explorer' };
        const panelModel = { id: 'panel' };
        const explorerTargets: LanguageNavigationTarget[] = [];
        const panelTargets: LanguageNavigationTarget[] = [];
        registerEditorNavigator(explorerModel, target => { explorerTargets.push(target); });
        registerEditorNavigator(panelModel, target => { panelTargets.push(target); });

        const handled = await opener.open(
            panelModel,
            browserDocumentUri('ws-1', 'src/types.ts'),
            { startLineNumber: 8, startColumn: 14, endLineNumber: 8, endColumn: 20 },
        );

        expect(handled).toBe(true);
        expect(panelTargets).toEqual([
            { workspaceId: 'ws-1', path: 'src/types.ts', line: 8, column: 14 },
        ]);
        // The Explorer pane also had a live registration; a navigation that did
        // not start there must not open a tab in its strip.
        expect(explorerTargets).toEqual([]);
    });

    it('declines a model with no navigator and a source with no model', async () => {
        const opener = installOpener();
        const uri = browserDocumentUri('ws-1', 'src/types.ts');

        expect(await opener.open({ id: 'unregistered' }, uri)).toBe(false);
        expect(await opener.open(null, uri)).toBe(false);
    });

    it('declines a target outside the document scheme', async () => {
        const opener = installOpener();
        const model = { id: 'explorer' };
        let calls = 0;
        registerEditorNavigator(model, () => { calls += 1; });

        expect(await opener.open(model, 'file:///usr/lib/node_modules/x/index.d.ts')).toBe(false);
        expect(calls).toBe(0);
    });

    it('declines when the surface itself refuses the target', async () => {
        const opener = installOpener();
        const model = { id: 'explorer' };
        // A pane showing another workspace refuses, so Monaco stays free to fall
        // through rather than having the navigation silently swallowed.
        registerEditorNavigator(model, () => false);

        expect(await opener.open(model, browserDocumentUri('ws-2', 'src/types.ts'))).toBe(false);
    });

    it('treats a handler that returns nothing as handled', async () => {
        const opener = installOpener();
        const model = { id: 'explorer' };
        registerEditorNavigator(model, () => undefined);

        expect(await opener.open(model, browserDocumentUri('ws-1', 'a.ts'))).toBe(true);
    });

    it('stops routing to a pane that has gone away', async () => {
        const opener = installOpener();
        const model = { id: 'explorer' };
        let calls = 0;
        const registration = registerEditorNavigator(model, () => { calls += 1; });

        registration.dispose();

        expect(await opener.open(model, browserDocumentUri('ws-1', 'a.ts'))).toBe(false);
        expect(calls).toBe(0);
    });

    it('leaves a replacement registration alone when the old one disposes late', async () => {
        const opener = installOpener();
        const model = { id: 'explorer' };
        const seen: string[] = [];
        const first = registerEditorNavigator(model, () => { seen.push('first'); });
        registerEditorNavigator(model, () => { seen.push('second'); });

        // React can run the outgoing cleanup after the incoming effect: a blind
        // delete here would leave the live pane unreachable.
        first.dispose();

        expect(await opener.open(model, browserDocumentUri('ws-1', 'a.ts'))).toBe(true);
        expect(seen).toEqual(['second']);
    });

    it('installs exactly one opener however many times it is called', () => {
        let installs = 0;
        const monaco = {
            editor: {
                registerEditorOpener: () => {
                    installs += 1;
                    return { dispose: () => undefined };
                },
            },
        } as never;

        const first = installLanguageEditorOpener(monaco);
        const second = installLanguageEditorOpener(monaco);

        expect(installs).toBe(1);
        expect(second).toBe(first);
    });
});
