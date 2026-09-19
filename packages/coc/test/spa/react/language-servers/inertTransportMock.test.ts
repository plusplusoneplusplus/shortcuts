/**
 * The inert transport stub has to keep up with `LanguageServerAttachment`.
 *
 * A dozen panel suites mock the whole transport module with it, and the
 * document store calls the attachment straight through on `open()`. When the
 * real handle grew `getInfos()` for multi-server attach, this stub still only
 * had the old single-server `getInfo()`, and every one of those suites died
 * with `attachment.getInfos is not a function` — a render-time throw far away
 * from anything they test. These two tests catch that drift at the source.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    LanguageServerClient,
} from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';
import { LanguageDocumentStore } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import { FakeSocket } from './fakeLanguageTransport';
import { getLanguageServerClient, inertAttachment } from './inertTransportMock';

afterEach(() => {
    FakeSocket.instances.length = 0;
    vi.restoreAllMocks();
});

/** A handle from the real client, which is the surface the stub must cover. */
function realAttachment() {
    const client = new LanguageServerClient({
        workspaceId: 'ws-1',
        editingSessionId: 'session-a',
        createSocket: (url: string) => new FakeSocket(url),
        attachTimeoutMs: 50,
    });
    return client.attach('src/a.ts');
}

describe('inert transport mock', () => {
    it('covers every member of a real attachment handle', () => {
        const real = realAttachment() as unknown as Record<string, unknown>;
        const inert = inertAttachment('src/a.ts') as unknown as Record<string, unknown>;

        const missing = Object.keys(real).filter((key) => !(key in inert));
        expect(missing).toEqual([]);
        for (const key of Object.keys(real)) {
            expect(typeof inert[key], `${key} has the wrong kind of value`).toBe(typeof real[key]);
        }
    });

    it('opens a document through the real store without throwing', () => {
        const store = new LanguageDocumentStore({
            workspaceId: 'ws-1',
            client: getLanguageServerClient() as never,
        });

        const view = store.open({ path: 'src/a.ts', text: 'const a = 1;\n' });

        expect(view.getServerInfos()).toEqual([]);
        expect(view.getStatus()).toBe('detached');
        expect(view.getSnapshot().unavailable).toBe(null);
        store.dispose();
    });
});
