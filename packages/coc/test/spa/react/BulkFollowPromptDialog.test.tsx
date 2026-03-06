import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { BulkFollowPromptDialog } from '../../../src/server/spa/client/react/shared/BulkFollowPromptDialog';
import type { TaskFolder } from '../../../src/server/spa/client/react/hooks/useTaskTree';

const mockFetch = vi.fn();
const mockAddToast = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    mockAddToast.mockReset();
    global.fetch = mockFetch;
});

function makeFolder(overrides: Partial<TaskFolder> = {}): TaskFolder {
    return {
        name: 'feature1',
        relativePath: 'feature1',
        children: [],
        documentGroups: [],
        singleDocuments: [
            { baseName: 'design', fileName: 'design.md', relativePath: 'feature1', isArchived: false },
            { baseName: 'spec', fileName: 'spec.md', relativePath: 'feature1', isArchived: false },
        ],
        ...overrides,
    };
}

function renderDialog(folder = makeFolder(), onClose = vi.fn()) {
    return render(
        <AppProvider>
            <ToastProvider value={{ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }}>
                <BulkFollowPromptDialog wsId="ws-1" folder={folder} onClose={onClose} />
            </ToastProvider>
        </AppProvider>
    );
}

function WorkspaceInjector({ workspaces, children }: { workspaces: any[]; children: ReactNode }) {
    const { dispatch } = useApp();
    useEffect(() => { dispatch({ type: 'WORKSPACES_LOADED', workspaces }); }, []);
    return <>{children}</>;
}

function renderDialogWithWorkspace(workspaces: any[], folder = makeFolder(), onClose = vi.fn()) {
    return render(
        <AppProvider>
            <ToastProvider value={{ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }}>
                <WorkspaceInjector workspaces={workspaces}>
                    <BulkFollowPromptDialog wsId="ws-1" folder={folder} onClose={onClose} />
                </WorkspaceInjector>
            </ToastProvider>
        </AppProvider>
    );
}

describe('BulkFollowPromptDialog', () => {
    it('renders Follow Prompt title', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        await act(async () => {
            renderDialog();
        });
        expect(screen.getByText('Follow Prompt')).toBeDefined();
    });

    it('shows task count summary', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        await act(async () => {
            renderDialog();
        });
        expect(screen.getByText(/2 tasks will be queued/)).toBeDefined();
    });

    it('shows singular "task" for single file', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'only', fileName: 'only.md', relativePath: 'feature1', isArchived: false },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/1 task will be queued/)).toBeDefined();
    });

    it('excludes context files from count', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'design', fileName: 'design.md', relativePath: 'feature1', isArchived: false },
                { baseName: 'CONTEXT', fileName: 'CONTEXT.md', relativePath: 'feature1', isArchived: false },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/1 task will be queued/)).toBeDefined();
    });

    it('collects files from nested children', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'root-task', fileName: 'root-task.md', relativePath: 'feature1', isArchived: false },
            ],
            children: [
                {
                    name: 'sub',
                    relativePath: 'feature1/sub',
                    children: [],
                    documentGroups: [],
                    singleDocuments: [
                        { baseName: 'nested', fileName: 'nested.md', relativePath: 'feature1/sub', isArchived: false },
                    ],
                },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/2 tasks will be queued/)).toBeDefined();
    });

    it('collects files from document groups', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [],
            documentGroups: [
                {
                    baseName: 'task1',
                    isArchived: false,
                    documents: [
                        { baseName: 'task1', docType: 'plan', fileName: 'task1.plan.md', relativePath: 'feature1', isArchived: false },
                        { baseName: 'task1', docType: 'spec', fileName: 'task1.spec.md', relativePath: 'feature1', isArchived: false },
                    ],
                },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/2 tasks will be queued/)).toBeDefined();
    });

    it('populates model select from /api/queue/models', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4', 'claude-sonnet'] }),
                });
            }
            if (url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastModel: '' }),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ prompts: [], skills: [] }),
            });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            const select = document.getElementById('bfp-model') as HTMLSelectElement;
            const options = Array.from(select.options).map(o => o.value);
            expect(options).toContain('gpt-4');
            expect(options).toContain('claude-sonnet');
        });
    });

    it('renders prompt items when prompts exist', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'review', relativePath: '.vscode/review.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            expect(screen.getByText('review')).toBeDefined();
        });
    });

    it('submits one task per file when prompt is clicked', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'impl', relativePath: '.vscode/impl.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '.vscode/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog(makeFolder(), onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('impl')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('impl'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'POST' && url.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(2);

            const bodies = postCalls.map(([_, opts]: [string, any]) => JSON.parse(opts.body));
            expect(bodies[0].type).toBe('follow-prompt');
            expect(bodies[1].type).toBe('follow-prompt');
            expect(bodies[0].payload.planFilePath).toContain('design.md');
            expect(bodies[1].payload.planFilePath).toContain('spec.md');
            expect(bodies[0].displayName).toContain('design');
            expect(bodies[1].displayName).toContain('spec');
        });

        expect(onClose).toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith('Queued 2 tasks successfully', 'success');
    });

    it('submits one task per file for skills', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [{ name: 'draft', description: 'Draft a spec' }] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '.vscode/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog(makeFolder(), onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('draft')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('draft'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'POST' && url.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(2);

            const bodies = postCalls.map(([_, opts]: [string, any]) => JSON.parse(opts.body));
            expect(bodies[0].payload.skillName).toBe('draft');
            expect(bodies[1].payload.skillName).toBe('draft');
        });
    });

    it('reports partial failures correctly', async () => {
        const onClose = vi.fn();
        let postCount = 0;

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'test', relativePath: 'test.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '.vscode/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                postCount++;
                if (postCount === 1) {
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
                }
                return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog(makeFolder(), onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('test')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('test'));
        });

        await waitFor(() => {
            expect(mockAddToast).toHaveBeenCalledWith('Queued 1, failed 1', 'success');
        });
    });

    it('shows 0 tasks for empty folder', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const emptyFolder = makeFolder({ singleDocuments: [], documentGroups: [], children: [] });
        await act(async () => {
            renderDialog(emptyFolder);
        });
        expect(screen.getByText(/0 tasks will be queued/)).toBeDefined();
    });

    it('disables prompt buttons when folder has no files', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'review', relativePath: 'review.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        const emptyFolder = makeFolder({ singleDocuments: [], documentGroups: [], children: [] });
        await act(async () => {
            renderDialog(emptyFolder);
        });

        await waitFor(() => {
            expect(screen.getByText('review')).toBeDefined();
        });

        const btn = screen.getByText('review').closest('button')!;
        expect(btn.disabled).toBe(true);
    });

    it('sends model inside config object', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4'] }),
                });
            }
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'review', relativePath: 'review.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '.vscode/tasks' }),
                });
            }
            if (url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastModel: 'gpt-4' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const singleFileFolder = makeFolder({
            singleDocuments: [
                { baseName: 'task', fileName: 'task.md', relativePath: 'feature1', isArchived: false },
            ],
        });

        await act(async () => {
            renderDialog(singleFileFolder, onClose);
        });

        await waitFor(() => {
            const select = document.getElementById('bfp-model') as HTMLSelectElement;
            expect(Array.from(select.options).some(o => o.value === 'gpt-4')).toBe(true);
        });

        await act(async () => {
            fireEvent.change(document.getElementById('bfp-model')!, { target: { value: 'gpt-4' } });
        });

        await waitFor(() => {
            expect(screen.getByText('review')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('review'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'POST' && url.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.config).toBeDefined();
            expect(body.config.model).toBe('gpt-4');
            expect(body.model).toBeUndefined();
        });
    });

    it('closes dialog via close button', async () => {
        const onClose = vi.fn();
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        await act(async () => {
            renderDialog(makeFolder(), onClose);
        });
        fireEvent.click(document.getElementById('bfp-close')!);
        expect(onClose).toHaveBeenCalled();
    });

    it('renders Last Used section when recent items exist', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        recentFollowPrompts: [
                            { type: 'prompt', name: 'review', path: 'review.prompt.md', timestamp: 1000 },
                            { type: 'skill', name: 'draft', timestamp: 900 },
                        ],
                    }),
                });
            }
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'review', relativePath: 'review.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [{ name: 'draft' }] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            expect(screen.getByText('Last Used')).toBeDefined();
            const recentButtons = document.querySelectorAll('.fp-recent-item');
            expect(recentButtons.length).toBe(2);
        });
    });

    it('does not render Last Used section when no recent items', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                });
            }
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'review', relativePath: 'review.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            expect(screen.getByText('review')).toBeDefined();
        });

        expect(screen.queryByText('Last Used')).toBeNull();
    });

    it('disables recent item buttons when folder has no files', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        recentFollowPrompts: [
                            { type: 'prompt', name: 'review', path: 'review.prompt.md', timestamp: 1000 },
                        ],
                    }),
                });
            }
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'review', relativePath: 'review.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        const emptyFolder = makeFolder({ singleDocuments: [], documentGroups: [], children: [] });
        await act(async () => {
            renderDialog(emptyFolder);
        });

        await waitFor(() => {
            expect(screen.getByText('Last Used')).toBeDefined();
        });

        const recentBtn = document.querySelector('.fp-recent-item') as HTMLButtonElement;
        expect(recentBtn.disabled).toBe(true);
    });

    it('normalizes backslashes in planFilePath when workingDirectory has backslashes', async () => {
        const onClose = vi.fn();
        const workspaces = [{ id: 'ws-1', name: 'Test', rootPath: 'D:\\projects\\shortcuts' }];
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'task', fileName: 'task.md', relativePath: 'feature1', isArchived: false },
            ],
        });

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'impl', relativePath: '.vscode/impl.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '.vscode/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialogWithWorkspace(workspaces, folder, onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('impl')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('impl'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'POST' && url.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            // Windows drive-letter paths should use backslashes (native style)
            expect(body.payload.planFilePath).not.toContain('/');
            expect(body.payload.planFilePath).toBe('D:\\projects\\shortcuts\\.vscode\\tasks\\feature1\\task.md');
            expect(body.payload.promptFilePath).not.toContain('/');
        });
    });

    it('renders additional info textarea with placeholder', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        await act(async () => {
            renderDialog();
        });
        const textarea = document.getElementById('bfp-additional-info') as HTMLTextAreaElement;
        expect(textarea).toBeDefined();
        expect(textarea.tagName).toBe('TEXTAREA');
        expect(textarea.placeholder).toContain('Extra context');
        expect(textarea.value).toBe('');
    });

    it('includes additionalInfo in POST body when non-empty', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'impl', relativePath: '.vscode/impl.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '.vscode/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const singleFileFolder = makeFolder({
            singleDocuments: [
                { baseName: 'task', fileName: 'task.md', relativePath: 'feature1', isArchived: false },
            ],
        });

        await act(async () => {
            renderDialog(singleFileFolder, onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('impl')).toBeDefined();
        });

        const textarea = document.getElementById('bfp-additional-info') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: '  output in JSON  ' } });
        });

        await act(async () => {
            fireEvent.click(screen.getByText('impl'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'POST' && url.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.payload.additionalInfo).toBe('output in JSON');
        });
    });

    it('does not include additionalInfo when textarea is empty', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/prompts')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ prompts: [{ name: 'impl', relativePath: '.vscode/impl.prompt.md' }] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '.vscode/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const singleFileFolder = makeFolder({
            singleDocuments: [
                { baseName: 'task', fileName: 'task.md', relativePath: 'feature1', isArchived: false },
            ],
        });

        await act(async () => {
            renderDialog(singleFileFolder, onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('impl')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByText('impl'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'POST' && url.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.payload.additionalInfo).toBeUndefined();
        });
    });

    it('excludes tasks with status "future" from count', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'active', fileName: 'active.md', relativePath: 'feature1', isArchived: false },
                { baseName: 'later', fileName: 'later.md', relativePath: 'feature1', isArchived: false, status: 'future' },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/1 task will be queued/)).toBeDefined();
    });

    it('excludes tasks with status "done" from count', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'active', fileName: 'active.md', relativePath: 'feature1', isArchived: false },
                { baseName: 'finished', fileName: 'finished.md', relativePath: 'feature1', isArchived: false, status: 'done' },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/1 task will be queued/)).toBeDefined();
    });

    it('includes tasks with no status (undefined)', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'task1', fileName: 'task1.md', relativePath: 'feature1', isArchived: false },
                { baseName: 'task2', fileName: 'task2.md', relativePath: 'feature1', isArchived: false, status: undefined },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/2 tasks will be queued/)).toBeDefined();
    });

    it('includes tasks with active statuses like "pending" and "in-progress"', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'todo', fileName: 'todo.md', relativePath: 'feature1', isArchived: false, status: 'pending' },
                { baseName: 'wip', fileName: 'wip.md', relativePath: 'feature1', isArchived: false, status: 'in-progress' },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/2 tasks will be queued/)).toBeDefined();
    });

    it('excludes inactive tasks from document groups', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [],
            documentGroups: [
                {
                    baseName: 'task1',
                    isArchived: false,
                    documents: [
                        { baseName: 'task1', docType: 'plan', fileName: 'task1.plan.md', relativePath: 'feature1', isArchived: false, status: 'pending' },
                        { baseName: 'task1', docType: 'spec', fileName: 'task1.spec.md', relativePath: 'feature1', isArchived: false, status: 'done' },
                    ],
                },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/1 task will be queued/)).toBeDefined();
    });

    it('excludes inactive tasks from nested children', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'active', fileName: 'active.md', relativePath: 'feature1', isArchived: false, status: 'pending' },
            ],
            children: [
                {
                    name: 'sub',
                    relativePath: 'feature1/sub',
                    children: [],
                    documentGroups: [],
                    singleDocuments: [
                        { baseName: 'future-task', fileName: 'future-task.md', relativePath: 'feature1/sub', isArchived: false, status: 'future' },
                    ],
                },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/1 task will be queued/)).toBeDefined();
    });

    it('shows 0 tasks when all are inactive', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ prompts: [], skills: [] }),
        });
        const folder = makeFolder({
            singleDocuments: [
                { baseName: 'done1', fileName: 'done1.md', relativePath: 'feature1', isArchived: false, status: 'done' },
                { baseName: 'future1', fileName: 'future1.md', relativePath: 'feature1', isArchived: false, status: 'future' },
            ],
        });
        await act(async () => {
            renderDialog(folder);
        });
        expect(screen.getByText(/0 tasks will be queued/)).toBeDefined();
    });
});
