import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { FollowPromptDialog } from '../../../src/server/spa/client/react/shared/FollowPromptDialog';

const mockFetch = vi.fn();
const mockAddToast = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    mockAddToast.mockReset();
    global.fetch = mockFetch;
});

function renderDialog(onClose = vi.fn()) {
    return render(
        <AppProvider>
            <ToastProvider value={{ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }}>
                <FollowPromptDialog wsId="ws-1" taskPath="test/task.md" taskName="task" onClose={onClose} />
            </ToastProvider>
        </AppProvider>
    );
}

function WorkspaceInjector({ workspaces, children }: { workspaces: any[]; children: ReactNode }) {
    const { dispatch } = useApp();
    useEffect(() => { dispatch({ type: 'WORKSPACES_LOADED', workspaces }); }, []);
    return <>{children}</>;
}

function renderDialogWithWorkspace(workspaces: any[], onClose = vi.fn()) {
    return render(
        <AppProvider>
            <ToastProvider value={{ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }}>
                <WorkspaceInjector workspaces={workspaces}>
                    <FollowPromptDialog wsId="ws-1" taskPath="test/task.md" taskName="task" onClose={onClose} />
                </WorkspaceInjector>
            </ToastProvider>
        </AppProvider>
    );
}

describe('FollowPromptDialog', () => {
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

    it('populates model select from /api/queue/models', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4', 'gpt-3.5'] }),
                });
            }
            if (url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastModel: 'gpt-4' }),
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
            const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
            const options = Array.from(select.options).map(o => o.value);
            expect(options).toContain('gpt-4');
            expect(options).toContain('gpt-3.5');
        });
    });

    it('submits to /api/queue/tasks on skill click and submit', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [{ name: 'impl', description: 'Implement changes.' }] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '/test/repos/abc/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog(onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('impl')).toBeDefined();
        });

        // Toggle skill chip
        await act(async () => {
            fireEvent.click(screen.getByText('impl'));
        });

        // Click the submit button
        await waitFor(() => {
            expect(screen.getByTestId('fp-submit-skills')).toBeDefined();
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('fp-submit-skills'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'POST' && _.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.type).toBe('chat');
            expect(body.payload.context.skills).toContain('impl');
        });
    });

    it('displays full skill name without truncation', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [
                            { name: 'draft', description: 'Draft a user experience specification for a requested feature.' },
                            { name: 'impl', description: 'Implement the requested code change and add comprehensive test coverage.' },
                        ],
                    }),
                });
            }
            if (url.includes('/prompts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ prompts: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            expect(screen.getByText('draft')).toBeDefined();
            expect(screen.getByText('impl')).toBeDefined();
        });

        // Skill name spans should have font-medium class (chip UI)
        const draftNameSpan = screen.getByText('draft');
        const implNameSpan = screen.getByText('impl');
        expect(draftNameSpan.className).toContain('font-medium');
        expect(implNameSpan.className).toContain('font-medium');

        // Skill buttons should have title with description
        const draftBtn = draftNameSpan.closest('button')!;
        const implBtn = implNameSpan.closest('button')!;
        expect(draftBtn.title).toContain('Draft a user experience specification');
        expect(implBtn.title).toContain('Implement the requested code change');
    });

    it('renders skill without description correctly', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'my-skill' }],
                    }),
                });
            }
            if (url.includes('/prompts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ prompts: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            expect(screen.getByText('my-skill')).toBeDefined();
        });

        const btn = screen.getByText('my-skill').closest('button')!;
        // Chip has icon + name spans (no ✕ when not selected)
        expect(btn.querySelectorAll('span').length).toBe(2);
        // Title falls back to skill name when no description
        expect(btn.title).toBe('my-skill');
    });

    it('sends model inside config object, not at top level', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4', 'claude-sonnet'] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [{ name: 'review', description: 'Review changes.' }] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '/test/repos/abc/tasks' }),
                });
            }
            if (url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastModel: 'gpt-4' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-2' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog(onClose);
        });

        // Wait for models to load and select one
        await waitFor(() => {
            const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
            expect(Array.from(select.options).some(o => o.value === 'gpt-4')).toBe(true);
        });

        // Select model
        const modelSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
        await act(async () => {
            fireEvent.change(modelSelect, { target: { value: 'gpt-4' } });
        });

        // Wait for skill items to appear
        await waitFor(() => {
            expect(screen.getByText('review')).toBeDefined();
        });

        // Toggle skill chip, then submit
        await act(async () => {
            fireEvent.click(screen.getByText('review'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('fp-submit-skills')).toBeDefined();
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('fp-submit-skills'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'POST' && _.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.config).toBeDefined();
            expect(body.config.model).toBe('gpt-4');
            expect(body.model).toBeUndefined();
        });
    });

    it('renders Last Used section when recent items exist', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        recentFollowPrompts: [
                            { type: 'prompt', name: 'review', path: 'review.prompt.md', timestamp: 1000 },
                            { type: 'skill', name: 'impl', timestamp: 900 },
                        ],
                    }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [{ name: 'impl' }] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            expect(screen.getByText('Last Used')).toBeDefined();
            // Recent items should appear as buttons
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
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [{ name: 'my-skill' }] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            expect(screen.getByText('my-skill')).toBeDefined();
        });

        expect(screen.queryByText('Last Used')).toBeNull();
    });

    it('clicking a recent item submits and tracks usage', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/preferences') && !opts?.method) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        recentFollowPrompts: [
                            { type: 'prompt', name: 'review', path: '.vscode/review.prompt.md', timestamp: 1000 },
                        ],
                    }),
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
                    json: () => Promise.resolve({ folderPath: '/test/repos/abc/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            if (opts?.method === 'PATCH') {
                return Promise.resolve({ ok: true });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog(onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('Last Used')).toBeDefined();
        });

        const recentButtons = document.querySelectorAll('.fp-recent-item');
        await act(async () => {
            fireEvent.click(recentButtons[0]);
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'POST' && _.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.type).toBe('chat');
            expect(body.payload.context.files.some((f: string) => f.includes('review.prompt.md'))).toBe(true);
        });
    });

    it('normalizes backslashes in planFilePath and promptFilePath when workingDirectory has backslashes', async () => {
        const onClose = vi.fn();
        const workspaces = [{ id: 'ws-1', name: 'Test', rootPath: 'D:\\projects\\shortcuts' }];

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/preferences') && !opts?.method) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        recentFollowPrompts: [
                            { type: 'prompt', name: 'impl', path: '.vscode/impl.prompt.md', timestamp: 1000 },
                        ],
                    }),
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
                    json: () => Promise.resolve({ folderPath: '/test/repos/abc/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialogWithWorkspace(workspaces, onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('Last Used')).toBeDefined();
        });

        const recentButtons = document.querySelectorAll('.fp-recent-item');
        await act(async () => {
            fireEvent.click(recentButtons[0]);
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'POST' && _.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            // Drive-letter paths use backslashes; absolute paths use forward slashes
            const files: string[] = body.payload.context.files;
            files.filter((f: string) => /^[A-Za-z]:/.test(f)).forEach((f: string) => expect(f).not.toContain('/'));
            expect(files.some((f: string) => f === '/test/repos/abc/tasks/test/task.md')).toBe(true);
            expect(files.some((f: string) => f === 'D:\\projects\\shortcuts\\.vscode\\impl.prompt.md')).toBe(true);
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
        const textarea = document.getElementById('fp-additional-info') as HTMLTextAreaElement;
        expect(textarea).toBeDefined();
        expect(textarea.tagName).toBe('TEXTAREA');
        expect(textarea.placeholder).toContain('Extra context');
        expect(textarea.value).toBe('');
    });

    it('includes additionalInfo in POST body when non-empty', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [{ name: 'impl', description: 'Implement changes.' }] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '/test/repos/abc/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog(onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('impl')).toBeDefined();
        });

        // Type in the textarea
        const textarea = document.getElementById('fp-additional-info') as HTMLTextAreaElement;
        await act(async () => {
            fireEvent.change(textarea, { target: { value: '  focus on auth module  ' } });
        });

        // Toggle skill chip, then submit
        await act(async () => {
            fireEvent.click(screen.getByText('impl'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('fp-submit-skills')).toBeDefined();
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('fp-submit-skills'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'POST' && _.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.payload.context.blocks[0].content).toBe('focus on auth module');
        });
    });

    it('does not include additionalInfo when textarea is empty', async () => {
        const onClose = vi.fn();

        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [{ name: 'impl', description: 'Implement changes.' }] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '/test/repos/abc/tasks' }),
                });
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'q-1' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog(onClose);
        });

        await waitFor(() => {
            expect(screen.getByText('impl')).toBeDefined();
        });

        // Toggle skill chip, then submit
        await act(async () => {
            fireEvent.click(screen.getByText('impl'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('fp-submit-skills')).toBeDefined();
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('fp-submit-skills'));
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                ([_, opts]: [string, any]) => opts?.method === 'POST' && _.includes('/queue/tasks')
            );
            expect(postCalls.length).toBe(1);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.payload.context?.blocks).toBeUndefined();
        });
    });

    it('disables additional info textarea while submitting', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [{ name: 'impl', description: 'Implement changes.' }] }),
                });
            }
            if (url.includes('/tasks/settings')) {
                // Delay to keep submitting state active
                return new Promise(resolve => setTimeout(() => resolve({
                    ok: true,
                    json: () => Promise.resolve({ folderPath: '/test/repos/abc/tasks' }),
                }), 200));
            }
            if (opts?.method === 'POST' && url.includes('/queue/tasks')) {
                return new Promise(resolve => setTimeout(() => resolve({
                    ok: true,
                    json: () => Promise.resolve({ id: 'q-1' }),
                }), 200));
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => {
            renderDialog();
        });

        await waitFor(() => {
            expect(screen.getByText('impl')).toBeDefined();
        });

        const textarea = document.getElementById('fp-additional-info') as HTMLTextAreaElement;
        expect(textarea.disabled).toBe(false);

        // Toggle skill chip
        await act(async () => {
            fireEvent.click(screen.getByText('impl'));
        });

        // Click submit to start submission (don't await completion)
        await waitFor(() => {
            expect(screen.getByTestId('fp-submit-skills')).toBeDefined();
        });
        act(() => {
            fireEvent.click(screen.getByTestId('fp-submit-skills'));
        });

        // Textarea should be disabled while submitting
        expect(textarea.disabled).toBe(true);
    });
});
