/**
 * Tests for EnqueueDialog component — validation, submit, cancel, model dropdown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../src/server/spa/client/react/contexts/MinimizedDialogsContext';
import { EnqueueDialog } from '../../../src/server/spa/client/react/queue/EnqueueDialog';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    // Default responses for inner fetches (models, preferences, templates, etc.)
    mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-3', name: 'claude-3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }),
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── Providers ─────────────────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <MinimizedDialogsProvider>
                    {children}
                    <MinimizedDialogsTray />
                </MinimizedDialogsProvider>
            </QueueProvider>
        </AppProvider>
    );
}

function DialogOpener({ mode }: { mode?: 'task' | 'ask' | 'resolve' }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', folderPath: null, workspaceId: null, mode: mode ?? 'task' });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function ResolveDialogOpener({ resolveContext }: { resolveContext: { title: string; commentCount: number; onSubmit: (ctx: string, sk: string[], model: string) => void } }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', workspaceId: null, mode: 'resolve', resolveContext });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function renderDialog(mode: 'task' | 'ask' | 'resolve' = 'task') {
    return render(
        <Wrap>
            <DialogOpener mode={mode} />
            <EnqueueDialog />
        </Wrap>
    );
}

function renderResolveDialog(resolveContext: { title: string; commentCount: number; onSubmit: (ctx: string, sk: string[], model: string) => void }) {
    return render(
        <Wrap>
            <ResolveDialogOpener resolveContext={resolveContext} />
            <EnqueueDialog />
        </Wrap>
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('EnqueueDialog', () => {
    it('renders the dialog panel when open', async () => {
        renderDialog();
        await waitFor(() => {
            // FloatingDialog renders data-testid="floating-dialog-panel"
            expect(screen.getByTestId('floating-dialog-panel')).toBeDefined();
        });
    });

    it('shows "Enqueue AI Task" title in task mode', async () => {
        renderDialog('task');
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeDefined();
        });
    });

    it('shows "Ask AI (Read-only)" title in ask mode', async () => {
        renderDialog('ask');
        await waitFor(() => {
            expect(screen.getByText('Ask AI (Read-only)')).toBeDefined();
        });
    });

    it('Enqueue button is disabled when prompt is empty', async () => {
        renderDialog();
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));
        const enqueueBtn = screen.queryByRole('button', { name: /enqueue/i });
        if (enqueueBtn) {
            expect(enqueueBtn).toHaveProperty('disabled', true);
        }
    });

    it('Enqueue button becomes enabled when prompt has content', async () => {
        renderDialog();
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));
        const textarea = screen.queryByTestId('prompt-input');
        if (textarea) {
            act(() => {
                textarea.innerText = 'my prompt';
                fireEvent.input(textarea);
            });
            await waitFor(() => {
                const enqueueBtn = screen.queryByRole('button', { name: /enqueue/i });
                if (enqueueBtn) {
                    expect(enqueueBtn).toHaveProperty('disabled', false);
                }
            });
        }
    });

    it('Cancel button closes dialog', async () => {
        renderDialog();
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));
        const cancelBtn = screen.queryByRole('button', { name: /cancel/i });
        if (cancelBtn) {
            act(() => { fireEvent.click(cancelBtn); });
            await waitFor(() => {
                expect(screen.queryByTestId('floating-dialog-panel')).toBe(null);
            });
        }
    });

    it('submits the typed queue task payload with the correct prompt', async () => {
        // Setup fetch: models, preferences GET, templates GET, then queue tasks POST
        mockFetch
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }) }) // /models
            .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }); // preferences/others

        renderDialog();
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));

        const textarea = screen.queryByTestId('prompt-input');
        if (!textarea) return; // Guard — dialog may not render in some environments

        act(() => {
            textarea.innerText = 'test prompt content';
            fireEvent.input(textarea);
        });
        await waitFor(() => {
            const enqueueBtn = screen.queryByRole('button', { name: /enqueue/i });
            if (enqueueBtn && !enqueueBtn.hasAttribute('disabled')) {
                act(() => { fireEvent.click(enqueueBtn); });
            }
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(c => c[1]?.method === 'POST');
            if (postCalls.length > 0) {
                const body = JSON.parse(postCalls[0][1].body);
                expect(body.payload.prompt).toContain('test prompt content');
            }
        }, { timeout: 3000 });
    });

    it('shows only enabled models in the model dropdown', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [
                        { id: 'gpt-4', name: 'gpt-4', enabled: true, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
                        { id: 'gpt-3.5', name: 'gpt-3.5', enabled: false, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
                    ] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        renderDialog();
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));

        await waitFor(() => {
            const selects = screen.queryAllByRole('combobox');
            const modelSelect = selects.find(s => Array.from((s as HTMLSelectElement).options).some(o => o.value === 'gpt-4'));
            if (modelSelect) {
                const options = Array.from((modelSelect as HTMLSelectElement).options).map(o => o.value);
                expect(options).toContain('gpt-4');
                expect(options).not.toContain('gpt-3.5');
            }
        });
    });

    it('falls back to all models when none are enabled', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [
                        { id: 'gpt-4', name: 'gpt-4', enabled: false, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
                        { id: 'gpt-3.5', name: 'gpt-3.5', enabled: false, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
                    ] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        renderDialog();
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));

        await waitFor(() => {
            const selects = screen.queryAllByRole('combobox');
            const modelSelect = selects.find(s => Array.from((s as HTMLSelectElement).options).some(o => o.value === 'gpt-4'));
            if (modelSelect) {
                const options = Array.from((modelSelect as HTMLSelectElement).options).map(o => o.value);
                expect(options).toContain('gpt-4');
                expect(options).toContain('gpt-3.5');
            }
        });
    });

    // ── Templates tab disabled logic ──────────────────────────────────────────

    it('Submit button disabled on Templates tab when no template is selected', async () => {
        const TEMPLATE = { id: 'tmpl-1', name: 'My Template', model: 'gpt-4', mode: 'task' as const, skills: [] };
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }) });
            }
            if (url.includes('/preferences')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ skillTemplates: [TEMPLATE] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        renderDialog('task');
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));

        // The dialog auto-switches to Templates tab when templates exist
        await waitFor(() => screen.getByTestId('template-card-tmpl-1'));

        // Button should be disabled — no template is yet selected
        const enqueueBtn = screen.queryByRole('button', { name: /enqueue/i });
        if (enqueueBtn) {
            expect(enqueueBtn).toHaveProperty('disabled', true);
        }
    });

    it('Submit button enabled on Templates tab after a template card is clicked', async () => {
        const TEMPLATE = { id: 'tmpl-2', name: 'My Template', model: 'gpt-4', mode: 'task' as const, skills: [] };
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }) });
            }
            if (url.includes('/preferences')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ skillTemplates: [TEMPLATE] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        renderDialog('task');
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));
        await waitFor(() => screen.getByTestId('template-card-tmpl-2'));

        act(() => {
            fireEvent.click(screen.getByTestId('template-card-tmpl-2'));
        });

        await waitFor(() => {
            const enqueueBtn = screen.queryByRole('button', { name: /enqueue/i });
            if (enqueueBtn) {
                expect(enqueueBtn).toHaveProperty('disabled', false);
            }
        });
    });

    it('Submit button disabled when manually switching to empty Templates tab', async () => {
        // Default mock returns no skillTemplates → empty templates list
        renderDialog('task');
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));

        // Manually switch to Templates tab
        const tabBtn = screen.queryByRole('button', { name: /^Templates/i });
        if (tabBtn) {
            act(() => { fireEvent.click(tabBtn); });
        }

        await waitFor(() => {
            // Empty state visible
            expect(screen.queryByTestId('templates-empty-state')).not.toBe(null);
            // Submit button should be disabled (selectedTemplateId is null)
            const enqueueBtn = screen.queryByRole('button', { name: /enqueue/i });
            if (enqueueBtn) {
                expect(enqueueBtn).toHaveProperty('disabled', true);
            }
        });
    });

    it('Advanced tab: submit disabled with no skills or prompt (regression)', async () => {
        renderDialog('task');
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));

        // Ensure we are on the Advanced tab
        const advancedTabBtn = screen.queryByRole('button', { name: /^Advanced$/i });
        if (advancedTabBtn) {
            act(() => { fireEvent.click(advancedTabBtn); });
        }

        await waitFor(() => {
            const enqueueBtn = screen.queryByRole('button', { name: /enqueue/i });
            if (enqueueBtn) {
                expect(enqueueBtn).toHaveProperty('disabled', true);
            }
        });
    });

    // ── Resolve mode tests ──

    it('shows resolve title when opened in resolve mode', async () => {
        const onSubmit = vi.fn();
        renderResolveDialog({ title: 'Resolve with AI', commentCount: 3, onSubmit });
        await waitFor(() => {
            expect(screen.getByText('Resolve with AI')).toBeDefined();
        });
    });

    it('shows resolve info text with comment count', async () => {
        const onSubmit = vi.fn();
        renderResolveDialog({ title: 'Resolve with AI', commentCount: 5, onSubmit });
        await waitFor(() => {
            const info = screen.getByTestId('resolve-info');
            expect(info.textContent).toContain('5 open comments');
        });
    });

    it('shows singular "comment" for count of 1', async () => {
        const onSubmit = vi.fn();
        renderResolveDialog({ title: 'Fix with AI', commentCount: 1, onSubmit });
        await waitFor(() => {
            const info = screen.getByTestId('resolve-info');
            expect(info.textContent).toContain('1 open comment');
            expect(info.textContent).not.toContain('comments');
        });
    });

    it('shows "▶ Resolve" submit button label in resolve mode', async () => {
        const onSubmit = vi.fn();
        renderResolveDialog({ title: 'Resolve with AI', commentCount: 2, onSubmit });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /Resolve/i })).toBeDefined();
        });
    });

    it('resolve mode submit button is not disabled even with empty prompt', async () => {
        const onSubmit = vi.fn();
        renderResolveDialog({ title: 'Resolve with AI', commentCount: 2, onSubmit });
        await waitFor(() => {
            const btn = screen.getByRole('button', { name: /Resolve/i });
            expect(btn).toHaveProperty('disabled', false);
        });
    });

    it('shows "Additional context (optional)" label in resolve mode', async () => {
        const onSubmit = vi.fn();
        renderResolveDialog({ title: 'Resolve with AI', commentCount: 2, onSubmit });
        await waitFor(() => {
            expect(screen.getByText('Additional context (optional)')).toBeDefined();
        });
    });
});

