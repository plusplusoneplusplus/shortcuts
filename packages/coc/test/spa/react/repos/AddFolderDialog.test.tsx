/**
 * Tests for AddFolderDialog — multi-phase wizard for bulk-adding repos.
 *
 * Covers: initial render, filesystem browser navigation, scan/discover,
 * checklist selection, batch add with per-item error accumulation,
 * cancel/close behavior, and phase transitions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AddFolderDialog } from '../../../../src/server/spa/client/react/repos/AddFolderDialog';

/* ── helpers ─────────────────────────────────────────────────────────── */

const mockFetch = vi.fn();

const BROWSE_HOME: any = {
    path: '/home/user',
    parent: '/home',
    entries: [
        { name: 'projects', isGitRepo: false },
        { name: 'dotfiles', isGitRepo: true },
    ],
    drives: [],
    browseRoots: [{ label: 'Home', path: '/home/user' }],
};

const BROWSE_PROJECTS: any = {
    path: '/home/user/projects',
    parent: '/home/user',
    entries: [
        { name: 'frontend', isGitRepo: true },
        { name: 'backend', isGitRepo: true },
    ],
};

const DISCOVERED_REPOS = {
    repos: [
        { path: '/home/user/projects/frontend', name: 'frontend' },
        { path: '/home/user/projects/backend', name: 'backend' },
    ],
};

function ok(body: any) {
    return {
        ok: true,
        status: 200,
        headers: { get: (key: string) => key.toLowerCase() === 'content-type' ? 'application/json' : null },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    };
}

function err(status: number, body: any) {
    return {
        ok: false,
        status,
        statusText: 'Error',
        headers: { get: (key: string) => key.toLowerCase() === 'content-type' ? 'application/json' : null },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    };
}

function networkError(): never {
    throw new TypeError('Failed to fetch');
}

/**
 * Default fetch router: responds to `/fs/browse` and `/workspaces/discover`
 * with sensible defaults. Can be overridden per-test.
 */
function defaultFetchRouter(url: string, opts?: RequestInit) {
    if (opts?.method === 'POST' && url.includes('/workspaces')) {
        return Promise.resolve(ok({ id: 'ws-1' }));
    }
    if (url.includes('/fs/browse')) {
        const params = new URL(url, 'http://localhost').searchParams;
        const path = params.get('path') ?? '';
        if (path === '~' || path.endsWith('/user')) return Promise.resolve(ok(BROWSE_HOME));
        if (path.includes('projects')) return Promise.resolve(ok(BROWSE_PROJECTS));
        return Promise.resolve(ok(BROWSE_HOME));
    }
    if (url.includes('/workspaces/discover')) {
        return Promise.resolve(ok(DISCOVERED_REPOS));
    }
    return Promise.resolve(ok({}));
}

function renderDialog(props: Partial<{ open: boolean; onClose: () => void; onAdded: () => void }> = {}) {
    const defaultProps = {
        open: true,
        onClose: vi.fn(),
        onAdded: vi.fn(),
        ...props,
    };
    const result = render(<AddFolderDialog {...defaultProps} />);
    return { ...result, ...defaultProps };
}

/* ── setup ───────────────────────────────────────────────────────────── */

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    mockFetch.mockImplementation(defaultFetchRouter);
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/* ── tests ───────────────────────────────────────────────────────────── */

describe('AddFolderDialog', () => {
    // ── Initial render ────────────────────────────────────────────────

    describe('initial render', () => {
        it('does not render when open is false', () => {
            renderDialog({ open: false });
            expect(screen.queryByText('Add Workspace Folder')).toBeNull();
        });

        it('renders dialog with title when open', async () => {
            renderDialog();
            await waitFor(() => {
                expect(screen.getByText('Add Workspace Folder')).toBeTruthy();
            });
        });

        it('shows loading state initially while browsing ~', async () => {
            // Delay the fetch so we can observe loading
            mockFetch.mockImplementation(() => new Promise(() => {}));
            renderDialog();
            await waitFor(() => {
                expect(screen.getByText('Loading…')).toBeTruthy();
            });
        });

        it('navigates to ~ on open and shows browser entries', async () => {
            renderDialog();
            await waitFor(() => {
                expect(screen.getByText('projects')).toBeTruthy();
                expect(screen.getByText('dotfiles')).toBeTruthy();
            });
        });

        it('shows git badge on git repo entries', async () => {
            renderDialog();
            await waitFor(() => {
                // dotfiles has isGitRepo: true
                const entries = screen.getAllByTestId('folder-browser-entry');
                const dotfilesEntry = entries.find(e => e.textContent?.includes('dotfiles'));
                expect(dotfilesEntry?.textContent).toContain('git');
            });
        });

        it('shows Scan button disabled initially then enabled after path loads', async () => {
            renderDialog();
            // Initially the path is empty, Scan should be disabled
            const scanBtn = screen.getByTestId('scan-folder-btn');
            // After navigation resolves, path is set and Scan should be enabled
            await waitFor(() => {
                expect(scanBtn).not.toHaveAttribute('disabled');
            });
        });
    });

    // ── Filesystem browser ────────────────────────────────────────────

    describe('filesystem browser', () => {
        it('navigates into a subdirectory when entry is clicked', async () => {
            renderDialog();
            await waitFor(() => screen.getByText('projects'));

            act(() => {
                const entries = screen.getAllByTestId('folder-browser-entry');
                const projectsEntry = entries.find(e => e.textContent?.includes('projects'));
                fireEvent.click(projectsEntry!);
            });

            await waitFor(() => {
                expect(screen.getByText('frontend')).toBeTruthy();
                expect(screen.getByText('backend')).toBeTruthy();
            });
        });

        it('shows parent (..) entry when parent path exists', async () => {
            renderDialog();
            await waitFor(() => screen.getByText('projects'));

            // BROWSE_HOME has parent: '/home' → the ".." entry should render
            const browser = screen.getByTestId('folder-browser');
            expect(browser.textContent).toContain('..');
        });

        it('displays browse roots as buttons', async () => {
            renderDialog();
            await waitFor(() => {
                expect(screen.getByTestId('browse-root-Home')).toBeTruthy();
            });
        });

        it('navigates to browse root when root button is clicked', async () => {
            renderDialog();
            await waitFor(() => screen.getByTestId('browse-root-Home'));

            act(() => {
                fireEvent.click(screen.getByTestId('browse-root-Home'));
            });

            await waitFor(() => {
                expect(mockFetch).toHaveBeenCalledWith(
                    expect.stringContaining('/fs/browse'),
                    expect.anything()
                );
            });
        });

        it('shows error message when browse fails', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/fs/browse')) {
                    return Promise.reject(new Error('Network error'));
                }
                return Promise.resolve(ok({}));
            });

            renderDialog();
            await waitFor(() => {
                expect(screen.getByText('Unable to browse this path')).toBeTruthy();
            });
        });

        it('shows "No subdirectories" when entries are empty', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/fs/browse')) {
                    return Promise.resolve(ok({
                        path: '/empty',
                        parent: '/',
                        entries: [],
                    }));
                }
                return Promise.resolve(ok({}));
            });

            renderDialog();
            await waitFor(() => {
                expect(screen.getByText('No subdirectories')).toBeTruthy();
            });
        });

        it('shows selected path display beneath browser', async () => {
            renderDialog();
            await waitFor(() => {
                // browserPath is set to '/home/user' after navigating to ~
                const browser = screen.getByTestId('folder-browser');
                // The breadcrumb inside the browser shows the path
                expect(browser.textContent).toContain('/home/user');
            });
        });

        it('shows drive buttons when drives are present and no browseRoots', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/fs/browse')) {
                    return Promise.resolve(ok({
                        path: 'C:\\',
                        parent: null,
                        entries: [{ name: 'Users' }],
                        drives: ['C:\\', 'D:\\'],
                        browseRoots: [],
                    }));
                }
                return Promise.resolve(ok({}));
            });

            renderDialog();
            await waitFor(() => {
                // Drive buttons should appear; verify via browser container text
                const browser = screen.getByTestId('folder-browser');
                expect(browser.textContent).toContain('C:\\');
                expect(browser.textContent).toContain('D:\\');
            });
        });
    });

    // ── Scan / discover ───────────────────────────────────────────────

    describe('scan and discover', () => {
        it('calls /workspaces/discover when Scan is clicked', async () => {
            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));

            act(() => {
                fireEvent.click(screen.getByTestId('scan-folder-btn'));
            });

            await waitFor(() => {
                expect(mockFetch).toHaveBeenCalledWith(
                    expect.stringContaining('/workspaces/discover'),
                    expect.anything()
                );
            });
        });

        it('transitions to checklist phase after successful scan', async () => {
            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));

            act(() => {
                fireEvent.click(screen.getByTestId('scan-folder-btn'));
            });

            await waitFor(() => {
                expect(screen.getByTestId('repo-checklist')).toBeTruthy();
            });
        });

        it('shows scan error when discover API fails', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/workspaces/discover')) {
                    return Promise.resolve(err(500, { error: 'Scan failed' }));
                }
                return defaultFetchRouter(url);
            });

            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));

            act(() => {
                fireEvent.click(screen.getByTestId('scan-folder-btn'));
            });

            await waitFor(() => {
                expect(screen.getByTestId('scan-error')).toBeTruthy();
                expect(screen.getByText('Scan failed')).toBeTruthy();
            });
        });

        it('shows generic error message when discover rejects with non-Error', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/workspaces/discover')) {
                    return Promise.reject('string-error');
                }
                return defaultFetchRouter(url);
            });

            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));

            act(() => {
                fireEvent.click(screen.getByTestId('scan-folder-btn'));
            });

            await waitFor(() => {
                expect(screen.getByText('Failed to scan folder')).toBeTruthy();
            });
        });

        it('shows empty state when no repos are discovered', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/workspaces/discover')) {
                    return Promise.resolve(ok({ repos: [] }));
                }
                return defaultFetchRouter(url);
            });

            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));

            act(() => {
                fireEvent.click(screen.getByTestId('scan-folder-btn'));
            });

            await waitFor(() => {
                expect(screen.getByTestId('no-repos-found')).toBeTruthy();
            });
        });
    });

    // ── Checklist phase ───────────────────────────────────────────────

    describe('checklist phase', () => {
        async function goToChecklist() {
            const result = renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));
            return result;
        }

        it('shows all discovered repos checked by default', async () => {
            await goToChecklist();
            const frontendCb = screen.getByTestId('repo-check-frontend') as HTMLInputElement;
            const backendCb = screen.getByTestId('repo-check-backend') as HTMLInputElement;
            expect(frontendCb.checked).toBe(true);
            expect(backendCb.checked).toBe(true);
        });

        it('shows repo count in header', async () => {
            await goToChecklist();
            // The checklist header uses "repositor{ies/y}" — look for "2" and "repositories"
            const checklist = screen.getByTestId('repo-checklist');
            // The header is a sibling above the checklist
            const parent = checklist.parentElement!;
            expect(parent.textContent).toContain('2');
            expect(parent.textContent).toContain('repositories');
        });

        it('toggles individual checkbox off and on', async () => {
            await goToChecklist();
            const frontendCb = screen.getByTestId('repo-check-frontend') as HTMLInputElement;

            act(() => { fireEvent.click(frontendCb); });
            expect(frontendCb.checked).toBe(false);

            act(() => { fireEvent.click(frontendCb); });
            expect(frontendCb.checked).toBe(true);
        });

        it('updates Add Selected count when checkbox is toggled', async () => {
            await goToChecklist();
            expect(screen.getByText('Add Selected (2)')).toBeTruthy();

            const frontendCb = screen.getByTestId('repo-check-frontend');
            act(() => { fireEvent.click(frontendCb); });
            expect(screen.getByText('Add Selected (1)')).toBeTruthy();
        });

        it('disables Add Selected button when no repos are checked', async () => {
            await goToChecklist();
            const frontendCb = screen.getByTestId('repo-check-frontend');
            const backendCb = screen.getByTestId('repo-check-backend');

            act(() => {
                fireEvent.click(frontendCb);
                fireEvent.click(backendCb);
            });

            const addBtn = screen.getByTestId('add-selected-btn');
            expect(addBtn).toHaveAttribute('disabled');
        });

        it('select all / deselect all toggles all checkboxes', async () => {
            await goToChecklist();

            // Deselect all
            act(() => { fireEvent.click(screen.getByText('Deselect all')); });
            expect((screen.getByTestId('repo-check-frontend') as HTMLInputElement).checked).toBe(false);
            expect((screen.getByTestId('repo-check-backend') as HTMLInputElement).checked).toBe(false);

            // Select all
            act(() => { fireEvent.click(screen.getByText('Select all')); });
            expect((screen.getByTestId('repo-check-frontend') as HTMLInputElement).checked).toBe(true);
            expect((screen.getByTestId('repo-check-backend') as HTMLInputElement).checked).toBe(true);
        });

        it('shows singular "repository" for single repo', async () => {
            mockFetch.mockImplementation((url: string) => {
                if (url.includes('/workspaces/discover')) {
                    return Promise.resolve(ok({ repos: [{ path: '/solo', name: 'solo' }] }));
                }
                return defaultFetchRouter(url);
            });

            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });

            await waitFor(() => {
                // Checklist body uses "repositor{y/ies}" — get checklist parent
                const checklist = screen.getByTestId('repo-checklist');
                const body = checklist.parentElement!;
                expect(body.textContent).toContain('1');
                expect(body.textContent).toContain('repository');
                expect(body.textContent).not.toContain('repositories');
            });
        });

        it('Back button returns to pick phase', async () => {
            await goToChecklist();
            act(() => { fireEvent.click(screen.getByText('Back')); });

            await waitFor(() => {
                expect(screen.getByTestId('scan-folder-btn')).toBeTruthy();
                expect(screen.queryByTestId('repo-checklist')).toBeNull();
            });
        });
    });

    // ── Batch add (adding + done phases) ──────────────────────────────

    describe('batch add', () => {
        async function goToAddingPhase() {
            const result = renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));
            act(() => { fireEvent.click(screen.getByTestId('add-selected-btn')); });
            return result;
        }

        it('transitions to adding phase with progress indicator', async () => {
            // Make POST slow so we can observe the adding phase
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (opts?.method === 'POST') {
                    return new Promise(resolve =>
                        setTimeout(() => resolve(ok({})), 100)
                    );
                }
                return defaultFetchRouter(url, opts);
            });

            const { onClose } = renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));
            act(() => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

            await waitFor(() => {
                expect(screen.getByTestId('adding-progress')).toBeTruthy();
            });
        });

        it('shows done phase after all repos are added successfully', async () => {
            await goToAddingPhase();
            await waitFor(() => {
                expect(screen.getByTestId('adding-done')).toBeTruthy();
            });
        });

        it('shows success count on done phase', async () => {
            await goToAddingPhase();
            await waitFor(() => {
                const done = screen.getByTestId('adding-done');
                expect(done.textContent).toContain('Added');
                expect(done.textContent).toContain('2');
            });
        });

        it('shows singular "repository" when only one is added', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (url.includes('/workspaces/discover')) {
                    return Promise.resolve(ok({ repos: [{ path: '/solo', name: 'solo' }] }));
                }
                return defaultFetchRouter(url, opts);
            });

            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('add-selected-btn'));
            act(() => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

            await waitFor(() => {
                const done = screen.getByTestId('adding-done');
                expect(done.textContent).toContain('Added');
                expect(done.textContent).toContain('1');
            });
        });

        it('Done button calls onAdded', async () => {
            const { onAdded } = renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));
            act(() => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

            await waitFor(() => screen.getByTestId('folder-add-done-btn'));
            act(() => { fireEvent.click(screen.getByTestId('folder-add-done-btn')); });

            expect(onAdded).toHaveBeenCalledOnce();
        });

        it('POSTs correct workspace payload for each selected repo', async () => {
            await goToAddingPhase();
            await waitFor(() => screen.getByTestId('adding-done'));

            const postCalls = mockFetch.mock.calls.filter(
                (c: any[]) => c[1]?.method === 'POST' && typeof c[0] === 'string' && c[0].endsWith('/workspaces')
            );
            expect(postCalls.length).toBeGreaterThanOrEqual(2);

            const bodies = postCalls.map((c: any[]) => JSON.parse(c[1].body));
            const frontend = bodies.find((b: any) => b.name === 'frontend');
            const backend = bodies.find((b: any) => b.name === 'backend');

            expect(frontend).toBeDefined();
            expect(frontend.rootPath).toBe('/home/user/projects/frontend');
            // Id is server-authoritative now — the client no longer sends one.
            expect(frontend.id).toBeUndefined();

            expect(backend).toBeDefined();
            expect(backend.rootPath).toBe('/home/user/projects/backend');
        });
    });

    // ── Per-item error accumulation ───────────────────────────────────

    describe('per-item error accumulation', () => {
        it('shows per-item errors without blocking successful adds', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (opts?.method === 'POST') {
                    const body = JSON.parse(opts.body as string);
                    if (body.name === 'backend') {
                        return Promise.resolve(err(500, { error: 'Duplicate workspace' }));
                    }
                    return Promise.resolve(ok({}));
                }
                return defaultFetchRouter(url, opts);
            });

            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));
            act(() => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

            await waitFor(() => {
                const done = screen.getByTestId('adding-done');
                // 1 success, 1 failure
                expect(done.textContent).toContain('Added');
                expect(done.textContent).toContain('1');
                expect(done.textContent).toContain('Failed to add 1');
                expect(done.textContent).toContain('backend: Duplicate workspace');
            });
        });

        it('shows network error for repos that fail with fetch exception', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (opts?.method === 'POST') {
                    const body = JSON.parse(opts.body as string);
                    if (body.name === 'frontend') {
                        return Promise.reject(new TypeError('Failed to fetch'));
                    }
                    return Promise.resolve(ok({}));
                }
                return defaultFetchRouter(url, opts);
            });

            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));
            act(() => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

            await waitFor(() => {
                const done = screen.getByTestId('adding-done');
                expect(done.textContent).toContain('frontend: Network error');
            });
        });

        it('shows generic "Failed" when error response has no error field', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (opts?.method === 'POST') {
                    return Promise.resolve({
                        ok: false,
                        status: 500,
                        json: () => Promise.reject(new Error('not json')),
                    });
                }
                return defaultFetchRouter(url, opts);
            });

            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));
            act(() => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

            await waitFor(() => {
                const done = screen.getByTestId('adding-done');
                expect(done.textContent).toContain('frontend: Failed');
            });
        });

        it('shows "Close" instead of "Done" when there are errors', async () => {
            mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
                if (opts?.method === 'POST') {
                    return Promise.resolve(err(500, { error: 'fail' }));
                }
                return defaultFetchRouter(url, opts);
            });

            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));
            act(() => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

            await waitFor(() => {
                const doneBtn = screen.getByTestId('folder-add-done-btn');
                expect(doneBtn.textContent).toBe('Close');
            });
        });

        it('shows "Done" when there are no errors', async () => {
            renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));
            act(() => { fireEvent.click(screen.getByTestId('add-selected-btn')); });

            await waitFor(() => {
                const doneBtn = screen.getByTestId('folder-add-done-btn');
                expect(doneBtn.textContent).toBe('Done');
            });
        });
    });

    // ── Cancel / close ────────────────────────────────────────────────

    describe('cancel and close', () => {
        it('Cancel button in pick phase calls onClose without API calls', async () => {
            const { onClose } = renderDialog();
            await waitFor(() => screen.getByText('Cancel'));

            const callsBefore = mockFetch.mock.calls.filter(
                (c: any[]) => c[1]?.method === 'POST'
            ).length;

            act(() => { fireEvent.click(screen.getByText('Cancel')); });

            expect(onClose).toHaveBeenCalledOnce();
            const callsAfter = mockFetch.mock.calls.filter(
                (c: any[]) => c[1]?.method === 'POST'
            ).length;
            expect(callsAfter).toBe(callsBefore);
        });

        it('Cancel button in checklist phase calls onClose', async () => {
            const { onClose } = renderDialog();
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));

            // There are multiple Cancel buttons; use the one visible in checklist
            const cancelButtons = screen.getAllByText('Cancel');
            act(() => { fireEvent.click(cancelButtons[cancelButtons.length - 1]); });

            expect(onClose).toHaveBeenCalledOnce();
        });
    });

    // ── State reset on reopen ─────────────────────────────────────────

    describe('state reset on reopen', () => {
        it('resets to pick phase when dialog reopens', async () => {
            const onClose = vi.fn();
            const onAdded = vi.fn();
            const { rerender } = render(
                <AddFolderDialog open={true} onClose={onClose} onAdded={onAdded} />
            );

            // Navigate to checklist
            await waitFor(() => screen.getByTestId('scan-folder-btn'));
            act(() => { fireEvent.click(screen.getByTestId('scan-folder-btn')); });
            await waitFor(() => screen.getByTestId('repo-checklist'));

            // Close and reopen
            rerender(<AddFolderDialog open={false} onClose={onClose} onAdded={onAdded} />);
            rerender(<AddFolderDialog open={true} onClose={onClose} onAdded={onAdded} />);

            // Should be back at pick phase
            await waitFor(() => {
                expect(screen.getByTestId('scan-folder-btn')).toBeTruthy();
                expect(screen.queryByTestId('repo-checklist')).toBeNull();
            });
        });
    });
});

/* ── joinBrowserPath (helper function) ─────────────────────────────── */

describe('joinBrowserPath (via navigation)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockFetch.mockReset();
        mockFetch.mockImplementation(defaultFetchRouter);
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('constructs correct path with forward slashes for Unix paths', async () => {
        renderDialog();
        await waitFor(() => screen.getByText('projects'));

        act(() => {
            const entries = screen.getAllByTestId('folder-browser-entry');
            fireEvent.click(entries[0]); // 'projects'
        });

        await waitFor(() => {
            // Verify fetch was called with correct path
            const browseCalls = mockFetch.mock.calls.filter(
                (c: any[]) => typeof c[0] === 'string' && c[0].includes('/fs/browse')
            );
            const lastCall = browseCalls[browseCalls.length - 1];
            const url = new URL(lastCall[0], 'http://localhost');
            const path = url.searchParams.get('path');
            expect(path).toBe('/home/user/projects');
        });
    });

    it('constructs correct path with backslashes for Windows paths', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/fs/browse')) {
                const params = new URL(url, 'http://localhost').searchParams;
                const path = params.get('path') ?? '';
                if (path === '~') {
                    return Promise.resolve(ok({
                        path: 'C:\\Users\\dev',
                        parent: 'C:\\Users',
                        entries: [{ name: 'projects' }],
                    }));
                }
                return Promise.resolve(ok({
                    path: path,
                    parent: 'C:\\Users\\dev',
                    entries: [],
                }));
            }
            return Promise.resolve(ok({}));
        });

        renderDialog();
        await waitFor(() => screen.getByText('projects'));

        act(() => {
            const entries = screen.getAllByTestId('folder-browser-entry');
            fireEvent.click(entries[0]);
        });

        await waitFor(() => {
            const browseCalls = mockFetch.mock.calls.filter(
                (c: any[]) => typeof c[0] === 'string' && c[0].includes('/fs/browse')
            );
            const lastCall = browseCalls[browseCalls.length - 1];
            const url = new URL(lastCall[0], 'http://localhost');
            const path = url.searchParams.get('path');
            expect(path).toBe('C:\\Users\\dev\\projects');
        });
    });
});
