/**
 * @vitest-environment jsdom
 *
 * Regression tests: the notes PDF/annotation layers must route their
 * workspace-scoped REST calls through the clone's OWN server, not the local
 * origin.
 *
 * Two bugs, two severities:
 *   (A) The paper-annotations routes all begin with resolveWorkspaceOrFail, so a
 *       local-origin request for a REMOTE clone hard-404s — annotations silently
 *       never loaded or saved.
 *   (B) POST /api/quick-ask/answer?workspace= only validates the id SHAPE, then
 *       resolves the model config and runs the AI invocation against the LOCAL
 *       dataDir. A local-origin request for a remote clone answered 200 from the
 *       WRONG host with the wrong workspace's model config.
 *
 * The PDF bytes themselves are the prerequisite: the notes image / local-image /
 * paper-ingest URLs are handed to `<img src>` / `data-pdf-url` / a raw fetch, so
 * on a remote clone the PDF 404'd and there was nothing to annotate.
 *
 * These tests register a remote baseUrl, spy `fetch`, and assert every URL
 * carries the remote origin — while an unregistered LOCAL id stays relative
 * (byte-for-byte unchanged).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';

const { captureMock, enabledMock } = vi.hoisted(() => ({
    captureMock: vi.fn(),
    enabledMock: vi.fn(() => true),
}));

// Only the DOM-geometry crop helper and the feature flag are mocked — the clone
// registry and the transport stay REAL so the URLs under test are the real ones.
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/extensions/paperRegionCapture', () => ({
    captureRegion: (...args: unknown[]) => captureMock(...(args as [])),
    MIN_REGION_PX: 8,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled', () => ({
    useQuickAskSidenotesEnabled: () => enabledMock(),
}));

import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { PdfRegionAskLayer }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/PdfRegionAskLayer';
import { usePaperAnnotations }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/usePaperAnnotations';
import { defaultNoteEditorIO }
    from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorIO';

const REMOTE_WS = 'ws-47v03z';
const REMOTE_BASE = 'http://127.0.0.1:4001';
const LOCAL_WS = 'ws-local';
const NOTE_PATH = 'papers/attention.md';

const CAPTURE = {
    region: { page: 2, rect: { x: 0.1, y: 0.2, width: 0.3, height: 0.15 } },
    image: 'data:image/png;base64,ABC',
    pageText: 'Figure 1: throughput vs nodes',
    rect: { top: 300, left: 120, bottom: 460, right: 320 },
};

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

let urls: string[];

function Harness({ workspaceId }: { workspaceId: string }) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={ref} data-testid="pdf-container" />
            <PdfRegionAskLayer
                containerRef={ref as unknown as React.RefObject<HTMLElement | null>}
                workspaceId={workspaceId}
                pdfUrl=".papers/1706.03762.pdf"
                getNotePath={() => NOTE_PATH}
                getNoteRoot={() => 'default'}
            />
        </div>
    );
}

/** Arm region mode and drag a box; the mocked captureRegion decides the result. */
function armAndDrag() {
    fireEvent.click(screen.getByTestId('pdf-region-ask-toggle'));
    const surface = screen.getByTestId('pdf-region-ask-surface');
    fireEvent.mouseDown(surface, { clientX: 120, clientY: 300 });
    fireEvent.mouseMove(document, { clientX: 320, clientY: 460 });
    fireEvent.mouseUp(document, { clientX: 320, clientY: 460 });
}

/** Drive arm → drag → ask, so both the quick-ask POST and the persist POST fire. */
async function askAboutARegion(workspaceId: string) {
    render(<Harness workspaceId={workspaceId} />);
    armAndDrag();
    await waitFor(() => expect(screen.getByTestId('quick-ask-input')).toBeInTheDocument());
    const field = screen.getByTestId('quick-ask-input-field') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'what does this show?' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(urls.some(u => u.includes('/notes/paper-annotations/annotation'))).toBe(true));
}

const find = (fragment: string) => urls.find(u => u.includes(fragment));

beforeEach(() => {
    urls = [];
    resetCloneRegistryForTests();
    captureMock.mockReset();
    captureMock.mockReturnValue(CAPTURE);
    enabledMock.mockReset();
    enabledMock.mockReturnValue(true);
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/quick-ask/answer')) {
            return Promise.resolve(jsonResponse({ answer: 'A throughput chart.', model: 'm1' }));
        }
        if (url.includes('/notes/paper-annotations/annotation')) {
            return Promise.resolve(jsonResponse({ annotation: { id: 'a1' } }));
        }
        return Promise.resolve(jsonResponse({ annotations: {} }));
    }));
});

afterEach(() => {
    cleanup();
    resetCloneRegistryForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('paper annotations — remote-clone request routing', () => {
    it('regression: the sidecar GET goes to the remote clone server, never the local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        renderHook(() => usePaperAnnotations(REMOTE_WS, () => NOTE_PATH, () => 'default', true));

        await waitFor(() => expect(find('/notes/paper-annotations?')).toBeTruthy());
        const get = find('/notes/paper-annotations?')!;
        expect(get.startsWith(`${REMOTE_BASE}/api/workspaces/${REMOTE_WS}/`)).toBe(true);
        expect(get).toContain(`path=${encodeURIComponent(NOTE_PATH)}`);
    });

    it('the sidecar GET for a local (unregistered) workspace stays on the local origin', async () => {
        renderHook(() => usePaperAnnotations(LOCAL_WS, () => NOTE_PATH, () => 'default', true));

        await waitFor(() => expect(find('/notes/paper-annotations?')).toBeTruthy());
        expect(find('/notes/paper-annotations?')!)
            .toBe(`/api/workspaces/${LOCAL_WS}/notes/paper-annotations?path=${encodeURIComponent(NOTE_PATH)}&root=default`);
    });

    it('regression: the resolve/reopen PATCH goes to the remote clone server', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        const { result } = renderHook(
            () => usePaperAnnotations(REMOTE_WS, () => NOTE_PATH, () => 'default', true));
        await waitFor(() => expect(find('/notes/paper-annotations?')).toBeTruthy());

        result.current.setResolved('a1', true);

        await waitFor(() => expect(find('/paper-annotations/annotation/a1')).toBeTruthy());
        expect(find('/paper-annotations/annotation/a1')!.startsWith(REMOTE_BASE)).toBe(true);
    });

    it('regression: the follow-up turns PATCH goes to the remote clone server', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        const { result } = renderHook(
            () => usePaperAnnotations(REMOTE_WS, () => NOTE_PATH, () => 'default', true));
        await waitFor(() => expect(find('/notes/paper-annotations?')).toBeTruthy());

        result.current.setTurns('a1', [{ question: 'q', answer: 'a' }]);

        await waitFor(() => expect(find('/paper-annotations/annotation/a1')).toBeTruthy());
        expect(find('/paper-annotations/annotation/a1')!.startsWith(REMOTE_BASE)).toBe(true);
    });
});

describe('quick-ask + annotation writes — remote-clone request routing', () => {
    it('regression: the quick-ask answer and the annotation POST both hit the remote clone', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        await askAboutARegion(REMOTE_WS);

        // (B) The AI invocation must run on the workspace's OWN host — a
        // local-origin POST answers 200 from the wrong machine.
        const answer = find('/quick-ask/answer')!;
        expect(answer).toBe(`${REMOTE_BASE}/api/quick-ask/answer?workspace=${REMOTE_WS}`);
        // (A) The persist POST must reach the server that owns the note.
        const persist = find('/notes/paper-annotations/annotation')!;
        expect(persist).toBe(`${REMOTE_BASE}/api/workspaces/${REMOTE_WS}/notes/paper-annotations/annotation`);
        // No local fallthrough anywhere in the flow.
        expect(urls.every(u => u.startsWith(REMOTE_BASE))).toBe(true);
    });

    it('a local (unregistered) workspace keeps posting to relative local-origin URLs', async () => {
        await askAboutARegion(LOCAL_WS);

        expect(find('/quick-ask/answer')!).toBe(`/api/quick-ask/answer?workspace=${LOCAL_WS}`);
        expect(find('/notes/paper-annotations/annotation')!)
            .toBe(`/api/workspaces/${LOCAL_WS}/notes/paper-annotations/annotation`);
    });
});

describe('PDF bytes — remote-clone URL building', () => {
    it('regression: image / local-image URLs are absolute against the remote clone', () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);

        expect(defaultNoteEditorIO.imageApiUrl(REMOTE_WS, '.papers/1706.03762.pdf', 'default'))
            .toBe(`${REMOTE_BASE}/api/workspaces/${REMOTE_WS}/notes/image`
                + `?path=${encodeURIComponent('.papers/1706.03762.pdf')}&root=default`);
        expect(defaultNoteEditorIO.localImageApiUrl(REMOTE_WS, '/home/u/chart.png'))
            .toBe(`${REMOTE_BASE}/api/workspaces/${REMOTE_WS}/notes/local-image`
                + `?path=${encodeURIComponent('/home/u/chart.png')}`);
    });

    it('image / local-image URLs for a local workspace stay the exact relative paths', () => {
        expect(defaultNoteEditorIO.imageApiUrl(LOCAL_WS, '.attachments/a.png'))
            .toBe(`/api/workspaces/${LOCAL_WS}/notes/image?path=${encodeURIComponent('.attachments/a.png')}`);
        expect(defaultNoteEditorIO.localImageApiUrl(LOCAL_WS, 'C:\\src\\chart.png'))
            .toBe(`/api/workspaces/${LOCAL_WS}/notes/local-image?path=${encodeURIComponent('C:\\src\\chart.png')}`);
    });

    it('regression: paper ingest POSTs to the remote clone, and stays relative for a local one', async () => {
        registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_BASE }]);
        await defaultNoteEditorIO.ingestPaper!(REMOTE_WS, 'https://arxiv.org/abs/1706.03762', 'default');
        expect(find('/notes/paper-ingest')!)
            .toBe(`${REMOTE_BASE}/api/workspaces/${REMOTE_WS}/notes/paper-ingest`);

        urls = [];
        resetCloneRegistryForTests();
        await defaultNoteEditorIO.ingestPaper!(LOCAL_WS, 'https://arxiv.org/abs/1706.03762');
        expect(find('/notes/paper-ingest')!)
            .toBe(`/api/workspaces/${LOCAL_WS}/notes/paper-ingest`);
    });
});
