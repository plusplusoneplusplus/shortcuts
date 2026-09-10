/**
 * What the editor's language badge says.
 *
 * Two statuses feed it — the document's own (`detached` / `ready` /
 * `unavailable`) and the host session's (`starting`, `failed`, and so on) —
 * and the point of `describeLanguageStatus` is that the pair is reconciled in
 * exactly one place. These cases pin the wording, the tone, and, most
 * importantly, when a retry is worth offering.
 */

import { describe, it, expect } from 'vitest';
import { describeLanguageStatus } from '../../../../src/server/spa/client/react/features/language-servers/languageStatus';
import { CONTAINER_UNSUPPORTED_REASON } from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';
import type { LanguageDocumentSnapshot } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import type { LanguageServerSessionStateView } from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';

function state(overrides: Partial<LanguageServerSessionStateView> = {}): LanguageServerSessionStateView {
    return {
        status: 'ready',
        definitionId: 'typescript',
        displayName: 'TypeScript',
        generation: 1,
        ...overrides,
    };
}

function snapshot(overrides: Partial<LanguageDocumentSnapshot> = {}): LanguageDocumentSnapshot {
    return {
        uri: 'coc-file://ws-1/src/a.ts',
        path: 'src/a.ts',
        version: 1,
        text: '',
        dirty: false,
        status: 'ready',
        languageId: 'typescript',
        displayName: 'TypeScript',
        unavailable: null,
        state: state(),
        ...overrides,
    };
}

describe('describeLanguageStatus', () => {
    it('names the running server once the document is synchronized', () => {
        const description = describeLanguageStatus(snapshot({
            state: state({ serverName: 'typescript-language-server', serverVersion: '4.3.3' }),
        }));

        expect(description.label).toBe('typescript-language-server');
        expect(description.tone).toBe('ready');
        expect(description.canRestart).toBe(true);
        expect(description.busy).toBe(false);
    });

    it('shows which TypeScript answered, so a workspace version is visible', () => {
        // AC-03: when the workspace copy cannot be used, the user has to be
        // able to see which one is active.
        const description = describeLanguageStatus(snapshot({
            state: state({ serverVersion: '4.3.3', runtime: 'Workspace TypeScript 5.6.2' }),
        }));

        expect(description.title).toBe('TypeScript is ready · Version 4.3.3 · Workspace TypeScript 5.6.2');
    });

    it('falls back to the definition name when the server reported none', () => {
        expect(describeLanguageStatus(snapshot({ state: state({ serverName: undefined }) })).label)
            .toBe('TypeScript');
    });

    it('reports a start in progress and offers no retry while it is running', () => {
        const description = describeLanguageStatus(snapshot({ status: 'detached', state: state({ status: 'starting' }) }));

        expect(description.label).toBe('Starting TypeScript…');
        expect(description.tone).toBe('pending');
        expect(description.busy).toBe(true);
        expect(description.canRestart).toBe(false);
    });

    it('tells a restart apart from a first start', () => {
        const description = describeLanguageStatus(snapshot({
            status: 'detached',
            state: state({ status: 'reconnecting', restarts: 2 }),
        }));

        expect(description.label).toBe('Restarting TypeScript…');
        expect(description.title).toContain('2 restarts');
    });

    it('offers the retry on a failed server and carries the detail into the tooltip', () => {
        const description = describeLanguageStatus(snapshot({
            status: 'detached',
            state: state({ status: 'failed', detail: 'Handshake failed: timed out' }),
        }));

        expect(description.label).toBe('TypeScript failed');
        expect(description.tone).toBe('error');
        expect(description.canRestart).toBe(true);
        expect(description.title).toContain('Handshake failed: timed out');
    });

    it('says the executable is missing rather than blaming the handshake', () => {
        const description = describeLanguageStatus(snapshot({
            status: 'detached',
            state: state({ status: 'unavailable', detail: 'Executable not found: typescript-language-server' }),
        }));

        expect(description.label).toBe('TypeScript not found');
        expect(description.tone).toBe('error');
        expect(description.canRestart).toBe(true);
    });

    it('names the reason the host refused the document, and still offers a retry', () => {
        // Support is turned on in settings, not here — but the retry is what
        // picks that change up, so it stays available.
        const description = describeLanguageStatus(snapshot({
            status: 'unavailable',
            state: null,
            unavailable: { reason: 'disabled', detail: 'Language support is off for this workspace.' },
        }));

        expect(description.label).toBe('Language support off');
        expect(description.title).toBe('Language support is off for this workspace.');
        expect(description.tone).toBe('warning');
        expect(description.canRestart).toBe(true);
    });

    it('has a label for every refusal the host can send', () => {
        const labels = ['no-definition', 'capacity', 'invalid-path', 'something-new'].map((reason) =>
            describeLanguageStatus(snapshot({ status: 'unavailable', state: null, unavailable: { reason, detail: '' } })).label,
        );

        expect(labels).toEqual([
            'No language server',
            'Language servers busy',
            'Language support unavailable',
            'Language support unavailable',
        ]);
    });

    it('says language support cannot reach the host through the container, with no retry', () => {
        // A retry would open the same unreachable socket, so the button is gone.
        const description = describeLanguageStatus(snapshot({
            status: 'unavailable',
            state: null,
            unavailable: {
                reason: CONTAINER_UNSUPPORTED_REASON,
                detail: 'Language support is not available while this workspace is open through the container agent.',
            },
        }));

        expect(description.label).toBe('Unavailable in container');
        expect(description.title)
            .toBe('Language support is not available while this workspace is open through the container agent.');
        expect(description.tone).toBe('warning');
        expect(description.canRestart).toBe(false);
    });

    it('treats a document attached to nothing as connecting, not as broken', () => {
        const description = describeLanguageStatus(snapshot({ status: 'detached', state: null }));

        expect(description.label).toBe('TypeScript connecting…');
        expect(description.tone).toBe('pending');
        // The socket, the session or the process may all be missing; a retry
        // fixes whichever it is.
        expect(description.canRestart).toBe(true);
    });

    it('says language support is off when there is no document at all', () => {
        const description = describeLanguageStatus(null);

        expect(description.label).toBe('Language support off');
        expect(description.canRestart).toBe(false);
    });
});
