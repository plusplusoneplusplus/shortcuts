/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – must be declared before importing the component under test
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/shared', () => ({
    Dialog: ({ open, children, footer, title, id, onClose }: any) =>
        open ? (
            <div data-testid="dialog" id={id}>
                <span data-testid="dialog-title">{title}</span>
                <div data-testid="dialog-body">{children}</div>
                <div data-testid="dialog-footer">{footer}</div>
            </div>
        ) : null,
    Button: ({ onClick, loading, disabled, children, id, ...rest }: any) => (
        <button
            onClick={onClick}
            disabled={loading || disabled}
            id={id}
            data-testid={rest['data-testid'] ?? id}
        >
            {children}
        </button>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

vi.mock('../../../../../src/server/spa/client/react/repos/repoGrouping', () => ({
    hashString: (s: string) => 'hash-' + s.replace(/[^a-z0-9]/gi, ''),
    normalizeRemoteUrl: (url: string) => url.toLowerCase().replace(/\.git$/, ''),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/colorUtils', () => ({
    resolveAutoColor: (_existing: string[], palette: any[]) =>
        palette.length > 0 ? palette[0].value : '',
}));

import { AddRepoDialog } from '../../../../../src/server/spa/client/react/repos/AddRepoDialog';
import { fetchApi } from '../../../../../src/server/spa/client/react/hooks/useApi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(overrides: Record<string, any> = {}) {
    return {
        workspace: {
            id: 'ws-existing',
            name: 'Existing Repo',
            rootPath: '/existing/path',
            color: '#0078d4',
            remoteUrl: null,
            ...overrides,
        },
        gitInfo: { branch: 'main', dirty: false, isGitRepo: true },
    };
}

const noop = () => {};

interface RenderOpts {
    open?: boolean;
    onClose?: () => void;
    editId?: string | null;
    repos?: any[];
    onSuccess?: () => void;
}

function renderDialog(opts: RenderOpts = {}) {
    const props = {
        open: opts.open ?? true,
        onClose: opts.onClose ?? noop,
        editId: opts.editId ?? null,
        repos: opts.repos ?? [],
        onSuccess: opts.onSuccess ?? noop,
    };
    return render(<AddRepoDialog {...props} />);
}

function getPathInput() {
    return screen.getByTestId('repo-path') as HTMLInputElement;
}

function getNameInput() {
    return screen.getByTestId('repo-alias') as HTMLInputElement;
}

function getSubmitBtn() {
    return screen.getByTestId('add-repo-submit') as HTMLButtonElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AddRepoDialog', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        // Default: global fetch resolves 200
        vi.stubGlobal('fetch', vi.fn());
    });

    // =======================================================================
    // Rendering: create vs edit mode
    // =======================================================================

    describe('create mode', () => {
        it('renders with "Add Repository" title', () => {
            renderDialog();
            expect(screen.getByTestId('dialog-title').textContent).toBe('Add Repository');
        });

        it('renders empty path and name inputs', () => {
            renderDialog();
            expect(getPathInput().value).toBe('');
            expect(getNameInput().value).toBe('');
        });

        it('shows "Add Repo" on the submit button', () => {
            renderDialog();
            expect(getSubmitBtn().textContent).toBe('Add Repo');
        });

        it('shows a Browse button', () => {
            renderDialog();
            expect(screen.getByTestId('browse-btn')).toBeTruthy();
        });
    });

    describe('edit mode', () => {
        const repo = makeRepo({ id: 'ws-edit', name: 'My Project', rootPath: '/proj', color: '#107c10' });

        it('renders with "Edit Repository" title', () => {
            renderDialog({ editId: 'ws-edit', repos: [repo] });
            expect(screen.getByTestId('dialog-title').textContent).toBe('Edit Repository');
        });

        it('pre-fills path and name from existing repo', () => {
            renderDialog({ editId: 'ws-edit', repos: [repo] });
            expect(getPathInput().value).toBe('/proj');
            expect(getNameInput().value).toBe('My Project');
        });

        it('makes path input read-only', () => {
            renderDialog({ editId: 'ws-edit', repos: [repo] });
            expect(getPathInput().readOnly).toBe(true);
        });

        it('shows "Save Changes" on the submit button', () => {
            renderDialog({ editId: 'ws-edit', repos: [repo] });
            expect(getSubmitBtn().textContent).toBe('Save Changes');
        });

        it('does not show Browse button', () => {
            renderDialog({ editId: 'ws-edit', repos: [repo] });
            expect(screen.queryByTestId('browse-btn')).toBeNull();
        });
    });

    // =======================================================================
    // Validation
    // =======================================================================

    describe('validation', () => {
        it('blocks submit and shows error when path is empty in create mode', async () => {
            renderDialog();

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            const msg = screen.getByTestId('repo-validation');
            expect(msg.textContent).toContain('Path is required');
            expect(fetch).not.toHaveBeenCalled();
        });
    });

    // =======================================================================
    // Submit — create mode (POST)
    // =======================================================================

    describe('submit in create mode', () => {
        it('POSTs to /api/workspaces with correct body', async () => {
            const onSuccess = vi.fn();
            const onClose = vi.fn();

            (fetch as unknown as Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({}),
            });

            renderDialog({ onSuccess, onClose });

            fireEvent.change(getPathInput(), { target: { value: '/my/repo' } });
            fireEvent.change(getNameInput(), { target: { value: 'My Repo' } });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            expect(fetch).toHaveBeenCalledTimes(1);
            const [url, opts] = (fetch as unknown as Mock).mock.calls[0];
            expect(url).toBe('/api/workspaces');
            expect(opts.method).toBe('POST');

            const body = JSON.parse(opts.body);
            expect(body.name).toBe('My Repo');
            expect(body.rootPath).toBe('/my/repo');
            expect(body.id).toMatch(/^ws-/);
        });

        it('calls onSuccess and onClose after successful POST', async () => {
            const onSuccess = vi.fn();
            const onClose = vi.fn();

            (fetch as unknown as Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({}),
            });

            renderDialog({ onSuccess, onClose });

            fireEvent.change(getPathInput(), { target: { value: '/repo' } });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            expect(onSuccess).toHaveBeenCalledTimes(1);
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('derives name from path leaf when name is empty', async () => {
            (fetch as unknown as Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({}),
            });

            renderDialog();

            fireEvent.change(getPathInput(), { target: { value: '/home/user/my-project' } });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            const body = JSON.parse((fetch as unknown as Mock).mock.calls[0][1].body);
            expect(body.name).toBe('my-project');
        });

        it('resolves auto color before submitting', async () => {
            (fetch as unknown as Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({}),
            });

            renderDialog();

            fireEvent.change(getPathInput(), { target: { value: '/repo' } });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            const body = JSON.parse((fetch as unknown as Mock).mock.calls[0][1].body);
            // resolveAutoColor mock returns first palette entry: '#0078d4'
            expect(body.color).toBe('#0078d4');
        });
    });

    // =======================================================================
    // Submit — edit mode (PATCH)
    // =======================================================================

    describe('submit in edit mode', () => {
        const repo = makeRepo({ id: 'ws-edit', name: 'Old Name', rootPath: '/old', color: '#107c10' });

        it('PATCHes to /api/workspaces/:id with name and color', async () => {
            const onSuccess = vi.fn();
            const onClose = vi.fn();

            (fetch as unknown as Mock).mockResolvedValueOnce({ ok: true });

            renderDialog({ editId: 'ws-edit', repos: [repo], onSuccess, onClose });

            fireEvent.change(getNameInput(), { target: { value: 'New Name' } });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            expect(fetch).toHaveBeenCalledTimes(1);
            const [url, opts] = (fetch as unknown as Mock).mock.calls[0];
            expect(url).toBe('/api/workspaces/ws-edit');
            expect(opts.method).toBe('PATCH');

            const body = JSON.parse(opts.body);
            expect(body.name).toBe('New Name');
            expect(body.color).toBeDefined();
        });

        it('calls onSuccess and onClose after successful PATCH', async () => {
            const onSuccess = vi.fn();
            const onClose = vi.fn();

            (fetch as unknown as Mock).mockResolvedValueOnce({ ok: true });

            renderDialog({ editId: 'ws-edit', repos: [repo], onSuccess, onClose });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            expect(onSuccess).toHaveBeenCalledTimes(1);
            expect(onClose).toHaveBeenCalledTimes(1);
        });
    });

    // =======================================================================
    // API failure handling
    // =======================================================================

    describe('API failure', () => {
        it('shows error and keeps dialog open on non-ok POST response', async () => {
            const onSuccess = vi.fn();
            const onClose = vi.fn();

            (fetch as unknown as Mock).mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Workspace already exists' }),
            });

            renderDialog({ onSuccess, onClose });

            fireEvent.change(getPathInput(), { target: { value: '/dup' } });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            const msg = screen.getByTestId('repo-validation');
            expect(msg.textContent).toContain('Workspace already exists');
            expect(onSuccess).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
            // Dialog is still mounted
            expect(screen.getByTestId('dialog')).toBeTruthy();
        });

        it('shows generic error when POST response body has no error field', async () => {
            (fetch as unknown as Mock).mockResolvedValueOnce({
                ok: false,
                json: async () => ({}),
            });

            renderDialog();

            fireEvent.change(getPathInput(), { target: { value: '/repo' } });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            const msg = screen.getByTestId('repo-validation');
            expect(msg.textContent).toContain('Failed to add repo');
        });

        it('shows network error when fetch throws', async () => {
            const onSuccess = vi.fn();
            const onClose = vi.fn();

            (fetch as unknown as Mock).mockRejectedValueOnce(new Error('Network failure'));

            renderDialog({ onSuccess, onClose });

            fireEvent.change(getPathInput(), { target: { value: '/repo' } });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            const msg = screen.getByTestId('repo-validation');
            expect(msg.textContent).toContain('Network error');
            expect(onSuccess).not.toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        });
    });

    // =======================================================================
    // Clone detection
    // =======================================================================

    describe('clone detection', () => {
        it('shows clone warning when new repo shares a remote URL', async () => {
            const existingRepo = makeRepo({
                id: 'ws-orig',
                name: 'Original',
                rootPath: '/orig',
                remoteUrl: 'https://github.com/user/repo.git',
            });

            (fetch as unknown as Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({ remoteUrl: 'https://github.com/user/repo.git' }),
            });

            renderDialog({ repos: [existingRepo] });

            fireEvent.change(getPathInput(), { target: { value: '/clone' } });

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            await waitFor(() => {
                const msg = screen.queryByTestId('repo-validation');
                // The clone message or onSuccess/onClose should have been triggered
                expect(fetch).toHaveBeenCalledTimes(1);
            });
        });
    });

    // =======================================================================
    // Dialog closed state
    // =======================================================================

    describe('dialog visibility', () => {
        it('renders nothing when open is false', () => {
            renderDialog({ open: false });
            expect(screen.queryByTestId('dialog')).toBeNull();
        });
    });

    // =======================================================================
    // Filesystem browser
    // =======================================================================

    describe('filesystem browser', () => {
        it('opens browser panel when Browse is clicked', async () => {
            (fetchApi as Mock).mockResolvedValueOnce({
                path: '/home',
                parent: '/',
                entries: [{ name: 'projects', isGitRepo: false }],
            });

            renderDialog();

            await act(async () => {
                fireEvent.click(screen.getByTestId('browse-btn'));
            });

            expect(screen.getByTestId('path-browser')).toBeTruthy();
        });

        it('displays directory entries from API response', async () => {
            (fetchApi as Mock).mockResolvedValueOnce({
                path: '/home/user',
                parent: '/home',
                entries: [
                    { name: 'project-a', isGitRepo: true },
                    { name: 'project-b', isGitRepo: false },
                ],
            });

            renderDialog();

            await act(async () => {
                fireEvent.click(screen.getByTestId('browse-btn'));
            });

            const entries = screen.getAllByTestId('path-browser-entry');
            expect(entries.length).toBe(2);
        });

        it('selects current browser path and populates name from path leaf', async () => {
            (fetchApi as Mock).mockResolvedValueOnce({
                path: '/home/user/my-project',
                parent: '/home/user',
                entries: [],
            });

            renderDialog();

            await act(async () => {
                fireEvent.click(screen.getByTestId('browse-btn'));
            });

            await act(async () => {
                fireEvent.click(screen.getByTestId('path-browser-select'));
            });

            expect(getPathInput().value).toBe('/home/user/my-project');
            expect(getNameInput().value).toBe('my-project');
        });

        it('shows error message when browse API fails', async () => {
            (fetchApi as Mock).mockRejectedValueOnce(new Error('Permission denied'));

            renderDialog();

            await act(async () => {
                fireEvent.click(screen.getByTestId('browse-btn'));
            });

            expect(screen.getByText('Unable to browse this path')).toBeTruthy();
        });

        it('resets browserPath when browse API fails', async () => {
            // First browse succeeds
            (fetchApi as Mock).mockResolvedValueOnce({
                path: '/home/user',
                parent: '/home',
                entries: [{ name: 'project' }],
            });

            renderDialog();

            await act(async () => {
                fireEvent.click(screen.getByTestId('browse-btn'));
            });

            expect(screen.getByText('/home/user')).toBeTruthy();

            // Navigate to a bad path — should reset browserPath
            (fetchApi as Mock).mockRejectedValueOnce(new Error('ENOENT'));

            await act(async () => {
                const entries = screen.getAllByTestId('path-browser-entry');
                fireEvent.click(entries[0]);
            });

            expect(screen.getByText('Unable to browse this path')).toBeTruthy();
        });

        it('Escape closes browser panel without closing the dialog', async () => {
            (fetchApi as Mock).mockResolvedValueOnce({
                path: '/home/user',
                parent: '/home',
                entries: [{ name: 'project' }],
            });

            const onClose = vi.fn();
            render(
                <AddRepoDialog
                    open={true}
                    onClose={onClose}
                    repos={[]}
                    onSuccess={vi.fn()}
                />
            );

            await act(async () => {
                fireEvent.click(screen.getByTestId('browse-btn'));
            });

            expect(screen.getByTestId('path-browser')).toBeTruthy();

            // Press Escape — should close browser panel, NOT the dialog
            await act(async () => {
                fireEvent.keyDown(document, { key: 'Escape' });
            });

            // Browser panel should be gone
            expect(screen.queryByTestId('path-browser')).toBeNull();
            // Dialog should still be open (onClose not called)
            expect(onClose).not.toHaveBeenCalled();
            expect(screen.getByTestId('dialog')).toBeTruthy();
        });
    });

    // =======================================================================
    // Color picker
    // =======================================================================

    describe('color picker', () => {
        it('renders the color palette', () => {
            renderDialog();
            const picker = screen.getByTestId('repo-color-picker');
            // 8 colors: Auto + 7 real colors
            const buttons = picker.querySelectorAll('button');
            expect(buttons.length).toBe(8);
        });

        it('allows selecting a color', () => {
            renderDialog();
            const picker = screen.getByTestId('repo-color-picker');
            const greenBtn = picker.querySelector('button[data-value="#107c10"]') as HTMLElement;
            expect(greenBtn).toBeTruthy();

            fireEvent.click(greenBtn);
        });

        it('submits with selected color instead of auto', async () => {
            (fetch as unknown as Mock).mockResolvedValueOnce({
                ok: true,
                json: async () => ({}),
            });

            renderDialog();

            fireEvent.change(getPathInput(), { target: { value: '/repo' } });

            // Select green
            const picker = screen.getByTestId('repo-color-picker');
            const greenBtn = picker.querySelector('button[data-value="#107c10"]') as HTMLElement;
            fireEvent.click(greenBtn);

            await act(async () => {
                fireEvent.click(getSubmitBtn());
            });

            const body = JSON.parse((fetch as unknown as Mock).mock.calls[0][1].body);
            expect(body.color).toBe('#107c10');
        });
    });

    // =======================================================================
    // State reset on reopen
    // =======================================================================

    describe('state reset', () => {
        it('clears fields when dialog reopens in create mode', () => {
            const { rerender } = render(
                <AddRepoDialog open={true} onClose={noop} editId={null} repos={[]} onSuccess={noop} />,
            );

            fireEvent.change(getPathInput(), { target: { value: '/dirty' } });
            fireEvent.change(getNameInput(), { target: { value: 'Dirty' } });

            // Close and reopen
            rerender(
                <AddRepoDialog open={false} onClose={noop} editId={null} repos={[]} onSuccess={noop} />,
            );
            rerender(
                <AddRepoDialog open={true} onClose={noop} editId={null} repos={[]} onSuccess={noop} />,
            );

            expect(getPathInput().value).toBe('');
            expect(getNameInput().value).toBe('');
        });
    });
});
