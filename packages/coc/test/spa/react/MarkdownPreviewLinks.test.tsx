// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CanvasBodyRenderer } from '../../../src/server/spa/client/react/features/canvas/components/CanvasBodyRenderer';
import { PreviewPane } from '../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';
import { MarkdownView } from '../../../src/server/spa/client/react/shared/MarkdownView';
import { MarkdownFileLinkScope } from '../../../src/server/spa/client/react/shared/file-path/MarkdownFileLinkScope';
import { chatMarkdownToHtml } from '../../../src/server/spa/client/react/features/chat/conversation/markdownHtml';
import { UnifiedPanelHostProvider } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
import { readUnifiedPanelState } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { registerCloneBaseUrls } from '../../../src/server/spa/client/react/repos/cloneRegistry';
import '../../../src/server/spa/client/react/shared/file-path/file-path-preview';

const mocks = vi.hoisted(() => ({
    readBlob: vi.fn(),
    readPreview: vi.fn(),
    list: vi.fn(),
    request: vi.fn(),
    clientFor: vi.fn(),
}));
vi.mock('@plusplusoneplusplus/forge/editor/rendering', () => import('../../../../forge/src/editor/rendering'));
vi.mock('../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: { readBlob: mocks.readBlob, writeBlob: vi.fn() },
}));
vi.mock('../../../src/server/spa/client/react/shared/file-viewer/workspacePreview', async importOriginal => ({
    ...await importOriginal<object>(),
    workspacePreviewClient: mocks.clientFor,
    readWorkspacePreview: mocks.readPreview,
}));
vi.mock('../../../src/server/spa/client/react/features/language-servers/useLanguageDocument', () => ({
    useLanguageDocument: () => ({ status: 'detached', markers: [], ready: false }),
}));
vi.mock('../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, revealLine, highlightRange, onChange }: any) => (
        <textarea data-testid="source-editor" value={value} data-line={revealLine}
            data-range={JSON.stringify(highlightRange)} onChange={e => onChange?.(e.target.value)} />
    ),
    getMonacoLanguage: () => 'typescript',
}));

const client = { request: (path: string, options: unknown) => path === '/workspaces' ? mocks.list(options) : mocks.request(path, options) };
const host = { workspaceId: 'panel', chatId: 'chat' };
function hosted(children: React.ReactNode) {
    return <UnifiedPanelHostProvider host={host}>{children}</UnifiedPanelHostProvider>;
}
function click(element: Element, init: MouseEventInit = {}) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
    element.dispatchEvent(event);
    return event;
}

beforeEach(() => {
    localStorage.clear();
    mocks.readBlob.mockReset().mockResolvedValue({
        content: '[Source](../src/a%20file.ts:42-58)', encoding: 'utf-8', mimeType: 'text/markdown',
    });
    mocks.list.mockReset().mockResolvedValue({ workspaces: [{ id: 'ws', rootPath: '/repo' }] });
    mocks.clientFor.mockReset().mockReturnValue(client);
    mocks.request.mockReset();
    mocks.readPreview.mockReset().mockResolvedValue({ content: '1\n2\n3\n4\n5', encoding: 'utf-8', mimeType: 'text/plain' });
    registerCloneBaseUrls([]);
});

describe('Markdown preview source links', () => {


    it('aborts owner discovery and ignores late results after the preview unmounts', async () => {
        let finish!: (value: unknown) => void;
        mocks.list.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const view = render(hosted(<MarkdownFileLinkScope workspaceId="ws" routingRef={null}>
            <MarkdownView html={chatMarkdownToHtml('[Code](src/main.ts:42)')} />
        </MarkdownFileLinkScope>));
        expect(click(screen.getByText('Code')).defaultPrevented).toBe(true);
        const signal = mocks.list.mock.calls[0][0].signal as AbortSignal;
        view.unmount();
        expect(signal.aborted).toBe(true);
        finish({ workspaces: [{ id: 'ws', rootPath: '/repo' }] });
        await Promise.resolve();
        expect(readUnifiedPanelState('panel').chatTabs.chat).toBeUndefined();
    });

    it.each([
        ['repo/path.ts:42', '/repo', 'repo/path.ts', 42, undefined],
        ['path.ts:42-58', '/repo', 'path.ts', 42, 58],
        ['file:///C:/repo/src/a%20file.ts#L42-L58', 'C:/repo', 'src/a file.ts', 42, 58],
        ['C:/repo/src/main.ts:42', 'C:/repo', 'src/main.ts', 42, undefined],
    ])('opens supported reference %s through the shared parser', async (href, rootPath, resourceId, line, endLine) => {
        mocks.list.mockResolvedValue({ workspaces: [{ id: 'ws', rootPath }] });
        render(hosted(<MarkdownFileLinkScope workspaceId="ws" routingRef={null}>
            <MarkdownView html={chatMarkdownToHtml(`[Code](${href})`)} />
        </MarkdownFileLinkScope>));
        expect(click(screen.getByText('Code')).defaultPrevented).toBe(true);
        await waitFor(() => expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])).toHaveLength(1));
        expect(readUnifiedPanelState('panel').chatTabs.chat[0]).toMatchObject({ resourceId, line });
        expect(readUnifiedPanelState('panel').chatTabs.chat[0].endLine).toBe(endLine);
    });

    it('retains the existing file error when the standalone source cannot be read', async () => {
        mocks.readPreview.mockRejectedValue(new Error('File not found'));
        render(<MarkdownFileLinkScope workspaceId="ws" routingRef={null}>
            <MarkdownView html={chatMarkdownToHtml('[Missing](src/missing.ts:3)')} />
        </MarkdownFileLinkScope>);
        expect(click(screen.getByText('Missing')).defaultPrevented).toBe(true);
        expect(await screen.findByTestId('preview-error')).toHaveTextContent('File not found');
    });

    it('opens from the actual rendered file preview, activates the source tab and keeps one tab on repeat ranges', async () => {
        const url = location.href;
        localStorage.setItem('split-workspace:panel:dock-open', '0');
        render(hosted(<PreviewPane repoId="ws" routingRef={null} filePath="docs/plan.md" fileName="plan.md" markdownPreview />));
        const preview = await screen.findByTestId('preview-markdown');
        expect(preview.innerHTML).toContain('md-link');
        const first = click(preview.querySelector('.md-link')!);
        expect(first.defaultPrevented).toBe(true);
        await waitFor(() => expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])).toHaveLength(1));
        const initial = readUnifiedPanelState('panel');
        expect((initial.chatTabs.chat ?? [])[0]).toMatchObject({
            kind: 'file', resourceId: 'src/a file.ts', ownerWorkspaceId: 'ws', ownerRoutingRef: null,
            chatId: 'chat', line: 42, endLine: 58,
        });
        expect(localStorage.getItem('split-workspace:panel:dock-open')).toBe('1');
        expect(Object.values(initial.activeByScope)).toContain((initial.chatTabs.chat ?? [])[0].id);
        // The renderer can update while the file's mounted buffer remains alive.
        const link = preview.querySelector('.md-link')!;
        link.setAttribute('data-href', '../src/a%20file.ts#L7-L9');
        click(link);
        await waitFor(() => expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])[0].line).toBe(7));
        expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])).toHaveLength(1);
        expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])[0].id).toBe((initial.chatTabs.chat ?? [])[0].id);
        expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])[0].endLine).toBe(9);
        expect(screen.getByTestId('preview-markdown')).toBe(preview);
        expect(location.href).toBe(url);
    });

    it('claims marked canvas-preview anchors and pins the exact remote owner even with equal workspace ids', async () => {
        const route = 'remote:server-b:ws';
        registerCloneBaseUrls([{ workspaceId: 'ws', cloneKey: route, baseUrl: 'https://b.example' }]);
        const content = '[Code](src/main.ts#L12-15)';
        render(hosted(<CanvasBodyRenderer workspaceId="ws" routingRef={route} canvasId="plan"
            canvas={{ id: 'plan', type: 'markdown', content } as any}
            kind={{ isCode: false, isSvg: false, isExtension: false, isExcalidraw: false, isKusto: false }}
            loading={false} loadError={null} viewingVersion={null} viewingRevision={1}
            displayedContent={content} draft={content} mode="preview"
            onDraftChange={vi.fn()} onCanvasSaved={vi.fn()} onSelectionChange={vi.fn()}
            onImageMenu={vi.fn()} notify={vi.fn()} />));
        expect(click(screen.getByText('Code')).defaultPrevented).toBe(true);
        await waitFor(() => expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])).toHaveLength(1));
        expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])[0]).toMatchObject({
            resourceId: 'src/main.ts', ownerWorkspaceId: 'ws', ownerRoutingRef: route, line: 12, endLine: 15,
        });
        expect(mocks.clientFor).toHaveBeenCalledWith('ws', route);
        expect(mocks.clientFor.mock.calls.every(([, owner]) => owner === route)).toBe(true);
    });


    it('keeps outside-root links on the workspace-authorized read-only transport', async () => {
        render(hosted(<MarkdownFileLinkScope workspaceId="ws" routingRef={null}>
            <MarkdownView html={chatMarkdownToHtml('[Outside](/tmp/output.ts:42)')} />
        </MarkdownFileLinkScope>));
        expect(click(screen.getByText('Outside')).defaultPrevented).toBe(true);
        await waitFor(() => expect(readUnifiedPanelState('panel').chatTabs.chat?.[0]).toMatchObject({
            ownerWorkspaceId: 'ws', ownerRoutingRef: null, resourceId: '__workspace_preview__:/tmp/output.ts', line: 42,
        }));
    });

    it('uses the existing source-dock navigation callback when no panel is hosted', () => {
        const navigate = vi.fn();
        render(<MarkdownFileLinkScope workspaceId="ws" routingRef={null} sourceFilePath="/repo/docs/plan.md" onNavigate={navigate}>
            <MarkdownView html={chatMarkdownToHtml('[Code](../src/main.ts:3-5)')} />
        </MarkdownFileLinkScope>);
        expect(click(screen.getByText('Code')).defaultPrevented).toBe(true);
        expect(navigate).toHaveBeenCalledWith({ fullPath: '../src/main.ts', wsId: 'ws', sourceFilePath: '/repo/docs/plan.md', line: 3, endLine: 5, kind: 'code' });
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it('reports a missing owner without selecting a local workspace', async () => {
        render(<MarkdownFileLinkScope workspaceId="">
            <MarkdownView html={chatMarkdownToHtml('[Code](src/main.ts:42)')} />
        </MarkdownFileLinkScope>);
        expect(click(screen.getByText('Code')).defaultPrevented).toBe(true);
        expect(await screen.findByRole('alert')).toHaveTextContent('No workspace is available');
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it('shows owner failures without navigation or local fallback', async () => {
        mocks.clientFor.mockImplementation(() => { throw new Error('The owning remote server is unavailable.'); });
        render(hosted(<MarkdownFileLinkScope workspaceId="ws" routingRef="remote:offline:ws">
            <MarkdownView html={chatMarkdownToHtml('[Missing](src/missing.ts:42)')} />
        </MarkdownFileLinkScope>));
        const url = location.href;
        expect(click(screen.getByText('Missing')).defaultPrevented).toBe(true);
        expect(await screen.findByRole('alert')).toHaveTextContent('owning remote server is unavailable');
        expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])).toHaveLength(0);
        expect(mocks.list).not.toHaveBeenCalled();
        expect(mocks.clientFor.mock.calls.every(([, route]) => route === 'remote:offline:ws')).toBe(true);
        expect(location.href).toBe(url);
    });

    it('leaves document anchors, app links, downloads, external links and modified clicks to existing handlers', () => {
        render(hosted(<MarkdownFileLinkScope workspaceId="ws" routingRef={null}>
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html:
                '<a href="#heading">Anchor</a><a href="#repos/ws/activity/chat">App</a>' +
                '<a href="https://example.com" target="_blank">Web</a><a href="//example.com" target="_blank">Protocol</a>' +
                '<a href="src/a.ts" download>Download</a><a href="src/a.ts" target="_blank">Modified</a>',
            }} />
        </MarkdownFileLinkScope>));
        for (const label of ['Anchor', 'App', 'Web', 'Protocol', 'Download']) {
            const node = screen.getByText(label);
            // Prevent jsdom's navigation after observing the delegation result.
            let prevented = false;
            const observe = (event: Event) => { prevented = event.defaultPrevented; event.preventDefault(); };
            document.addEventListener('click', observe, { once: true });
            click(node);
            expect(prevented, label).toBe(false);
        }
        for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
            const event = click(screen.getByText('Modified'), init);
            expect(event.defaultPrevented).toBe(false);
        }
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it('opens a read-only source viewer in a standalone preview without page navigation', async () => {
        render(<MarkdownFileLinkScope workspaceId="ws" routingRef={null} sourceFilePath="docs/plan.md">
            <MarkdownView html={chatMarkdownToHtml('[Code](../src/main.ts:3-5)')} />
        </MarkdownFileLinkScope>);
        const url = location.href;
        expect(click(screen.getByText('Code')).defaultPrevented).toBe(true);
        // Workspace preview transport owns the standalone file read.
        mocks.request.mockResolvedValue({ path: '/repo/src/main.ts', fileName: 'main.ts', lines: ['1','2','3','4','5'], totalLines: 5 });
        const editor = await screen.findByTestId('source-editor');
        expect(editor).toHaveAttribute('data-line', '3');
        expect(editor).toHaveAttribute('data-range', JSON.stringify({ start: 3, end: 5 }));
        expect(location.href).toBe(url);
        expect((readUnifiedPanelState('panel').chatTabs.chat ?? [])).toHaveLength(0);
    });
});
