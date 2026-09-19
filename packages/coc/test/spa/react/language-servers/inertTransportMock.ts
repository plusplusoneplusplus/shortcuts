/**
 * A drop-in replacement for the browser's `languageServerClient` module whose
 * attachments never go live: nothing is sent, no socket is opened, and no
 * status ever arrives.
 *
 * `PreviewPane` opens a language document for every live repo file, so suites
 * about tab or panel behaviour would otherwise drag the real transport in.
 * Point `vi.mock` straight at this module:
 *
 *     vi.mock('<path>/features/language-servers/languageServerClient',
 *         async () => await import('<path>/language-servers/inertTransportMock'));
 *
 * It deliberately imports no value. It is loaded from inside the mock factory
 * for the very module that the other language-server test helpers reach
 * through, and importing them here would deadlock the module graph. The type
 * import below is erased before the module ever runs, so it is safe — and it
 * pins this stub to the real attachment surface, which the document store
 * calls straight through on `open()`.
 */

import type { LanguageServerAttachment } from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';

const subscribe = () => () => {};

/** One attachment that reports no session and swallows everything sent to it. */
export function inertAttachment(path: string): LanguageServerAttachment {
    return {
        path,
        getInfo: () => null,
        getInfos: () => [],
        getUnavailable: () => null,
        onAttached: subscribe,
        onDetached: subscribe,
        onUnavailable: subscribe,
        onNotification: subscribe,
        onStatus: subscribe,
        sendRequest: async () => undefined as never,
        sendRequestTo: async () => undefined as never,
        readExternalSource: () => Promise.reject(new Error('inert attachment: no language server is attached')),
        sendNotification: () => {},
        sendNotificationTo: () => {},
        restart: () => {},
        release: () => {},
    };
}

export function getLanguageServerClient() {
    return { attach: inertAttachment };
}

export function resetLanguageServerClientsForTests(): void {}
