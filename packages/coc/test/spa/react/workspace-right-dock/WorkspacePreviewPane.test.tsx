import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PreviewPane } from '../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';
import {
    readWorkspacePreview, WORKSPACE_PREVIEW_PREFIX, workspacePreviewUrl,
} from '../../../../src/server/spa/client/react/shared/file-viewer/workspacePreview';
import { MAX_FILE_VIEW_SIZE } from '../../../../src/server/spa/client/react/shared/file-viewer/useFileContent';
import {
    registerCloneBaseUrls, resetCloneRegistryForTests, setActiveCloneForRouting,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const mocks = vi.hoisted(() => ({
    local: { request: vi.fn() },
    alpha: { request: vi.fn() },
    beta: { request: vi.fn() },
    explorer: { readBlob: vi.fn(), writeBlob: vi.fn(), readTrustedBlob: vi.fn() },
    language: vi.fn(),
    registerProviders: vi.fn(),
    fetch: vi.fn(),
    createObjectURL: vi.fn(),
    revokeObjectURL: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => mocks.local,
    getCocClientFor: (base?: string) => base === 'https://alpha.example'
        ? mocks.alpha : base === 'https://beta.example' ? mocks.beta : mocks.local,
    toSpaCocRequestOptions: (options: unknown) => options,
    translateSpaCocClientError: (error: unknown) => { throw error; },
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: mocks.explorer,
}));
vi.mock('../../../../src/server/spa/client/react/features/language-servers/useLanguageDocument', () => ({
    useLanguageDocument: (options: unknown) => {
        mocks.language(options);
        return {
            view: null, snapshot: null, status: 'detached', ready: false,
            diagnostics: [], markers: [], handleChange: vi.fn(), markSaved: vi.fn(), restart: vi.fn(),
        };
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageProviders', () => ({
    supportsFeature: () => false,
    registerLanguageProviders: mocks.registerProviders,
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: ({ value, onSave, onChange, selectionContext }: {
        value: string; onSave?: () => void; onChange?: (value: string) => void;
        selectionContext?: unknown;
    }) => (
        <div data-testid="mock-monaco" data-save={Boolean(onSave)}
            data-selection={Boolean(selectionContext)}>
            <textarea aria-label="File content" value={value} readOnly={!onChange}
                onChange={event => onChange?.(event.target.value)} />
        </div>
    ),
    getMonacoLanguage: (name: string) => name.endsWith('.md') ? 'markdown' : 'plaintext',
}));

const workspaceId = 'shared-workspace';
const path = '/preview-root/report.csv';
const alphaRoute = `remote:alpha:${workspaceId}`;
const betaRoute = `remote:beta:${workspaceId}`;
const entries = [
    { workspaceId, serverId: 'alpha', baseUrl: 'https://alpha.example' },
    { workspaceId, serverId: 'beta', baseUrl: 'https://beta.example' },
];

function pane(fileName = 'report.csv', props: Partial<ComponentProps<typeof PreviewPane>> = {}) {
    return <PreviewPane repoId={workspaceId} routingRef={null}
        filePath={`${WORKSPACE_PREVIEW_PREFIX}${path}`} fileName={fileName} {...props} />;
}

beforeEach(() => {
    vi.clearAllMocks();
    resetCloneRegistryForTests();
    registerCloneBaseUrls(entries);
    mocks.local.request.mockReset().mockResolvedValue({ type: 'text', content: 'name,value\none,1\n' });
    mocks.alpha.request.mockReset().mockResolvedValue({ type: 'text', content: 'alpha' });
    mocks.beta.request.mockReset().mockResolvedValue({ type: 'text', content: 'beta' });
    vi.stubGlobal('fetch', mocks.fetch);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(mocks.createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(mocks.revokeObjectURL);
});

afterEach(() => {
    cleanup();
    resetCloneRegistryForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('workspace-authorized read-only PreviewPane', () => {
    it('reads CSV as text through files/preview and never activates writing or LSP', async () => {
        const onRegisterSave = vi.fn();
        const onDirtyChange = vi.fn();
        render(pane('report.csv', { onRegisterSave, onDirtyChange }));
        expect(await screen.findByRole('textbox', { name: 'File content' }))
            .toHaveValue('name,value\none,1\n');
        expect(mocks.local.request).toHaveBeenCalledWith(
            '/workspaces/shared-workspace/files/preview',
            { query: { path, lines: 0 }, signal: expect.any(AbortSignal) },
        );
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'attempted edit' } });
        expect(screen.getByRole('textbox')).toHaveValue('name,value\none,1\n');
        expect(screen.getByTestId('mock-monaco')).toHaveAttribute('data-save', 'false');
        expect(screen.getByTestId('mock-monaco')).toHaveAttribute('data-selection', 'false');
        expect(onRegisterSave.mock.calls.every(([save]) => save === null)).toBe(true);
        expect(onDirtyChange.mock.calls.every(([dirty]) => dirty === false)).toBe(true);
        expect(mocks.language.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
        expect(mocks.registerProviders).not.toHaveBeenCalled();
        expect(mocks.explorer.readBlob).not.toHaveBeenCalled();
        expect(mocks.explorer.readTrustedBlob).not.toHaveBeenCalled();
        expect(mocks.explorer.writeBlob).not.toHaveBeenCalled();
        expect(screen.queryByTestId('save-btn')).not.toBeInTheDocument();
    });

    it('preserves the image MIME type into the real FileViewer image branch', async () => {
        mocks.local.request.mockResolvedValue({ type: 'image', mimeType: 'image/webp', content: 'AA==' });
        render(pane('diagram.webp'));
        expect(await screen.findByRole('img', { name: 'diagram.webp' }))
            .toHaveAttribute('src', 'data:image/webp;base64,AA==');
        expect(screen.queryByTestId('mock-monaco')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    });

    it('toggles workspace Markdown between rendered and read-only raw content', async () => {
        mocks.local.request.mockResolvedValue({ type: 'text', content: '# Preview heading\n' });
        render(pane('report.md'));
        expect(await screen.findByTestId('source-canvas-markdown')).toHaveTextContent('Preview heading');
        fireEvent.click(screen.getByRole('button', { name: 'Raw' }));
        expect(screen.getByRole('textbox')).toHaveValue('# Preview heading\n');
        expect(screen.getByTestId('mock-monaco')).toHaveAttribute('data-save', 'false');
        fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));
        expect(screen.getByTestId('source-canvas-markdown')).toHaveTextContent('Preview heading');
        expect(mocks.local.request).toHaveBeenCalledTimes(1);
        expect(mocks.explorer.writeBlob).not.toHaveBeenCalled();
    });

    it('uses the dock Markdown switch to enter raw directly without a second nested toggle', async () => {
        mocks.local.request.mockResolvedValue({ type: 'file', content: '# Dock heading\n' });
        render(pane('report.md', { markdownPreview: true }));
        expect(await screen.findByTestId('preview-markdown')).toHaveTextContent('Dock heading');
        const controls = within(screen.getByRole('group', { name: 'Markdown view' }));
        fireEvent.click(controls.getByRole('button', { name: 'Raw' }));
        expect(screen.getByRole('textbox')).toHaveValue('# Dock heading\n');
        expect(screen.queryByTestId('source-canvas-md-toggle')).not.toBeInTheDocument();
        expect(screen.getByTestId('mock-monaco')).toHaveAttribute('data-save', 'false');
        fireEvent.click(controls.getByRole('button', { name: 'Rendered' }));
        expect(screen.getByTestId('preview-markdown')).toHaveTextContent('Dock heading');
    });

    it('keeps Retry and Download available on preview errors and retries the same owner', async () => {
        mocks.alpha.request.mockRejectedValueOnce(new Error('Preview unavailable'));
        render(pane('report.csv', { routingRef: alphaRoute }));
        expect(await screen.findByTestId('preview-error')).toHaveTextContent('Preview unavailable');
        expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('textbox')).toHaveValue('alpha');
        expect(mocks.alpha.request).toHaveBeenCalledTimes(2);
        expect(mocks.local.request).not.toHaveBeenCalled();
    });

    it('offers Download when an image is too large to preview', async () => {
        mocks.local.request.mockResolvedValue({ type: 'image-too-large' });
        render(pane('large.png'));
        expect(await screen.findByTestId('preview-error')).toHaveTextContent(/too large/i);
        expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    });

    it('offers Download for oversized text without enabling a language document', async () => {
        mocks.local.request.mockResolvedValue({ type: 'text', content: 'x'.repeat(MAX_FILE_VIEW_SIZE + 1) });
        render(pane('large.txt'));
        expect(await screen.findByRole('button', { name: 'Download' })).toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue('x'.repeat(MAX_FILE_VIEW_SIZE));
        expect(mocks.language.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
    });

    it('offers Download for binary previews rather than an empty text editor', async () => {
        mocks.local.request.mockRejectedValue(Object.assign(new Error('Binary files are not supported'), { status: 400 }));
        render(pane('archive.bin'));
        expect(await screen.findByRole('button', { name: 'Download' })).toBeInTheDocument();
        expect(screen.getByTestId('preview-error')).toHaveTextContent('Binary files are not supported');
        expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('downloads from the concrete owner even after active clone selection changes', async () => {
        mocks.alpha.request.mockResolvedValue({ type: 'image', mimeType: 'image/png', content: 'AA==' });
        const bytes = new Blob(['image bytes']);
        mocks.fetch.mockResolvedValue({ ok: true, blob: async () => bytes });
        mocks.createObjectURL.mockReturnValue('blob:preview-download');
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        render(pane('image.png', { routingRef: alphaRoute }));
        await screen.findByRole('img');
        setActiveCloneForRouting(betaRoute);
        fireEvent.click(screen.getByRole('button', { name: 'Download' }));
        await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
        expect(mocks.fetch).toHaveBeenCalledWith(
            `https://alpha.example/api/workspaces/${workspaceId}/files/preview?path=${encodeURIComponent(path)}&download=true`,
        );
        expect(mocks.createObjectURL).toHaveBeenCalledWith(bytes);
        expect(click.mock.instances[0]).toHaveProperty('download', 'image.png');
        await waitFor(() => expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:preview-download'));
        expect(mocks.beta.request).not.toHaveBeenCalled();
    });

    it.each([
        ['HTTP error', () => Promise.resolve({ ok: false, status: 503 }), 'Download failed (503).'],
        ['network error', () => Promise.reject(new Error('Network unavailable')), 'Network unavailable'],
    ])('surfaces %s from Download', async (_name, response, message) => {
        mocks.local.request.mockResolvedValue({ type: 'image-too-large' });
        mocks.fetch.mockImplementation(response);
        render(pane('large.png'));
        fireEvent.click(await screen.findByRole('button', { name: 'Download' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
    });

    it('never falls through locally for an unresolved remote owner, including Download', async () => {
        render(pane('report.csv', { routingRef: `remote:missing:${workspaceId}` }));
        expect(await screen.findByTestId('preview-error')).toHaveTextContent(/owning remote server is unavailable/i);
        fireEvent.click(screen.getByRole('button', { name: 'Download' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(/owning remote server is unavailable/i);
        expect(mocks.fetch).not.toHaveBeenCalled();
        expect(mocks.local.request).not.toHaveBeenCalled();
    });

    it('blocks ordinary in-repo reads for an unresolved concrete remote without calling explorer.readBlob', async () => {
        render(pane('app.ts', {
            filePath: 'src/app.ts',
            routingRef: `remote:missing:${workspaceId}`,
        }));
        expect(await screen.findByTestId('preview-error'))
            .toHaveTextContent(/owning remote server is unavailable/i);
        expect(mocks.explorer.readBlob).not.toHaveBeenCalled();
        expect(mocks.explorer.writeBlob).not.toHaveBeenCalled();
        expect(mocks.explorer.readTrustedBlob).not.toHaveBeenCalled();
        expect(mocks.local.request).not.toHaveBeenCalled();
        expect(mocks.language.mock.calls.every(([options]) => options.enabled === false)).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByTestId('preview-error'))
            .toHaveTextContent(/owning remote server is unavailable/i);
        expect(mocks.explorer.readBlob).not.toHaveBeenCalled();
    });
});

describe('workspacePreview concrete routing', () => {
    it('pins reads and URLs to an explicit owner despite registry collisions', async () => {
        const signal = new AbortController().signal;
        setActiveCloneForRouting(betaRoute);
        expect(await readWorkspacePreview(workspaceId, path, alphaRoute, signal))
            .toMatchObject({ content: 'alpha', encoding: 'utf-8' });
        expect(workspacePreviewUrl(workspaceId, path, alphaRoute)).toContain('https://alpha.example/api/');
        expect(mocks.beta.request).not.toHaveBeenCalled();
    });

    it('uses the local API for an explicit null route despite a remote selected clone', async () => {
        setActiveCloneForRouting(alphaRoute);
        await readWorkspacePreview(workspaceId, path, null, new AbortController().signal);
        expect(mocks.local.request).toHaveBeenCalledTimes(1);
        expect(workspacePreviewUrl(workspaceId, path, null)).toMatch(/^\/api\/workspaces\//);
        expect(mocks.alpha.request).not.toHaveBeenCalled();
    });

    it('rejects unresolved remote reads and download URLs before invoking a client', async () => {
        const route = `remote:missing:${workspaceId}`;
        await expect(readWorkspacePreview(workspaceId, path, route, new AbortController().signal))
            .rejects.toThrow(/owning remote server is unavailable/i);
        expect(() => workspacePreviewUrl(workspaceId, path, route)).toThrow(/owning remote server is unavailable/i);
        expect(mocks.local.request).not.toHaveBeenCalled();
    });
});
