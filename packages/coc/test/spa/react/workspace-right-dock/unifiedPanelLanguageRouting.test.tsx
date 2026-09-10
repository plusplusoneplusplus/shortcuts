// @vitest-environment jsdom
/**
 * AC-04: a repo group's panel keeps asking the file's own host.
 *
 * A group's dock target is a moving thing — the user points it at another
 * member and the panel keeps every tab that was already open. The tab carries
 * its owner, and this is the test that the language document follows that owner
 * rather than the dock: after the target changes, a previously opened file's
 * buffer, requests and diagnostics still belong to the workspace it came from.
 *
 * The real `PreviewPane`, the real document store and the real hook run here;
 * only the socket under each workspace's client is faked, one per owner.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { UnifiedTabView } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTabView';
import type { UnifiedPanelTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { resetLanguageDocumentStoresForTests } from '../../../../src/server/spa/client/react/features/language-servers/documentStore';
import { FakeClient, readyState, diagnostic } from '../language-servers/fakeLanguageTransport';

const MEMBER_A = 'member-a';
const MEMBER_B = 'member-b';
/** Both members of the group have a file at this path. */
const PATH = 'src/index.ts';

const mockExplorerApi = vi.hoisted(() => ({
    readBlob: vi.fn(),
    writeBlob: vi.fn(),
    readTrustedBlob: vi.fn(),
}));

// A plain object, not a module import: a mock factory that reached for the
// helper would pull in `documentStore`, which imports the module being mocked.
const transport = vi.hoisted(() => ({ clients: new Map<string, any>() }));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mockExplorerApi,
}));

vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient', () => ({
    getLanguageServerClient: (workspaceId: string) => {
        const client = transport.clients.get(workspaceId);
        if (!client) {
            throw new Error(`No fake client for ${workspaceId}`);
        }
        return client.asClient();
    },
}));

// jsdom cannot run Monaco. The stub renders the value and records the markers
// it was handed, which is where a diagnostic ends up once the store has filtered
// it by document URI.
const editor = vi.hoisted(() => ({ markers: undefined as any }));

vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, markers }: any) => {
        editor.markers = markers;
        return <textarea data-testid="mock-monaco-textarea" value={value} readOnly />;
    },
    getMonacoLanguage: () => 'typescript',
    LANGUAGE_MARKER_OWNER: 'coc-language-server',
}));

function fileTab(ownerWorkspaceId: string): UnifiedPanelTab {
    return {
        id: `file|${ownerWorkspaceId}|chat-1|${PATH}`,
        kind: 'file',
        ownerWorkspaceId,
        chatId: 'chat-1',
        resourceId: PATH,
        label: 'index.ts',
    } as UnifiedPanelTab;
}

function renderTab(ownerWorkspaceId: string, scopeWorkspaceId: string) {
    return render(
        <UnifiedTabView
            tab={fileTab(ownerWorkspaceId)}
            scopeWorkspaceId={scopeWorkspaceId}
            onClose={() => undefined}
        />,
    );
}

/** The attachment `workspaceId`'s client opened for `PATH`, once it exists. */
async function attachmentFor(workspaceId: string) {
    const client = transport.clients.get(workspaceId);
    await waitFor(() => expect(client.attachments.has(PATH)).toBe(true));
    return client.get(PATH);
}

beforeEach(() => {
    vi.clearAllMocks();
    resetLanguageDocumentStoresForTests();
    transport.clients = new Map([
        [MEMBER_A, new FakeClient(MEMBER_A)],
        [MEMBER_B, new FakeClient(MEMBER_B)],
    ]);
    editor.markers = undefined;
    mockExplorerApi.readBlob.mockResolvedValue({ content: 'export const a = 1;', encoding: 'utf-8', mimeType: 'text/plain' });
    mockExplorerApi.writeBlob.mockResolvedValue(undefined);
});

afterEach(() => {
    resetLanguageDocumentStoresForTests();
});

describe('right panel — language routing by tab owner (AC-04)', () => {
    it('reads and opens the document on the tab’s owner, not the dock target', async () => {
        renderTab(MEMBER_B, 'group-1');
        const attachment = await attachmentFor(MEMBER_B);

        act(() => { attachment.attach({ state: readyState() }); });

        expect(mockExplorerApi.readBlob).toHaveBeenCalledWith(MEMBER_B, PATH, expect.anything());
        expect(transport.clients.get(MEMBER_A).attachments.size).toBe(0);
        const opened = attachment.lastOf('textDocument/didOpen') as any;
        expect(opened.textDocument.uri).toBe(`coc-file://${MEMBER_B}/${PATH}`);
    });

    it('keeps the document on its original owner after the dock target changes', async () => {
        const view = renderTab(MEMBER_B, 'group-1');
        const attachment = await attachmentFor(MEMBER_B);
        act(() => { attachment.attach({ state: readyState() }); });

        // The user points the group's dock at another member. The tab stays.
        view.rerender(
            <UnifiedTabView
                tab={fileTab(MEMBER_B)}
                scopeWorkspaceId={MEMBER_A}
                onClose={() => undefined}
            />,
        );
        await waitFor(() => expect(attachment.methods()).toContain('textDocument/didOpen'));

        expect(transport.clients.get(MEMBER_A).attachments.size).toBe(0);
        expect(attachment.released).toBe(false);
        expect(mockExplorerApi.readBlob.mock.calls.every((call: unknown[]) => call[0] === MEMBER_B)).toBe(true);
    });

    it('marks the tab with a diagnostic addressed to its owner, and no other', async () => {
        renderTab(MEMBER_B, MEMBER_A);
        const attachment = await attachmentFor(MEMBER_B);
        act(() => { attachment.attach({ state: readyState() }); });

        act(() => {
            attachment.notify('textDocument/publishDiagnostics', {
                uri: `coc-file://${MEMBER_B}/${PATH}`,
                diagnostics: [diagnostic('owner reported this')],
            });
        });
        await waitFor(() => expect(editor.markers).toHaveLength(1));
        expect(editor.markers[0].message).toBe('owner reported this');

        // The dock target's copy of the same relative path is a different
        // document, and its URI is what the filter runs on.
        act(() => {
            attachment.notify('textDocument/publishDiagnostics', {
                uri: `coc-file://${MEMBER_A}/${PATH}`,
                diagnostics: [diagnostic('another member’s file')],
            });
        });
        await waitFor(() => expect(editor.markers).toHaveLength(1));
        expect(editor.markers[0].message).toBe('owner reported this');
        expect(transport.clients.get(MEMBER_A).attachments.size).toBe(0);
    });

    it('gives two members’ copies of the same path separate documents', async () => {
        const first = renderTab(MEMBER_A, 'group-1');
        const second = renderTab(MEMBER_B, 'group-1');
        const attachmentA = await attachmentFor(MEMBER_A);
        const attachmentB = await attachmentFor(MEMBER_B);

        act(() => {
            attachmentA.attach({ state: readyState() });
            attachmentB.attach({ state: readyState() });
        });

        expect((attachmentA.lastOf('textDocument/didOpen') as any).textDocument.uri)
            .toBe(`coc-file://${MEMBER_A}/${PATH}`);
        expect((attachmentB.lastOf('textDocument/didOpen') as any).textDocument.uri)
            .toBe(`coc-file://${MEMBER_B}/${PATH}`);

        // Closing one member's tab leaves the other member's document open.
        first.unmount();
        await waitFor(() => expect(attachmentA.released).toBe(true));
        expect(attachmentB.released).toBe(false);
        second.unmount();
    });
});
