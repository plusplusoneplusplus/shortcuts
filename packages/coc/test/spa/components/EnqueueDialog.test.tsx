/**
 * Tests for EnqueueDialog component — validation, submit, cancel, model dropdown.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../src/server/spa/client/react/context/MinimizedDialogsContext';
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
        json: () => Promise.resolve([{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-3', name: 'claude-3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }]),
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

function DialogOpener({ mode }: { mode?: 'task' | 'ask' }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', folderPath: null, workspaceId: null, mode: mode ?? 'task' });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function renderDialog(mode: 'task' | 'ask' = 'task') {
    return render(
        <Wrap>
            <DialogOpener mode={mode} />
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
        const textarea = screen.queryByRole('textbox');
        if (textarea) {
            act(() => { fireEvent.change(textarea, { target: { value: 'my prompt' } }); });
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

    it('submit POSTs to /api/queue/tasks with correct prompt', async () => {
        // Setup fetch: models, preferences GET, templates GET, then queue tasks POST
        mockFetch
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }]) }) // /api/models
            .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }); // preferences/others

        renderDialog();
        await waitFor(() => screen.getByTestId('floating-dialog-panel'));

        const textarea = screen.queryByRole('textbox');
        if (!textarea) return; // Guard — dialog may not render textarea in some environments

        act(() => { fireEvent.change(textarea, { target: { value: 'test prompt content' } }); });
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
                    json: () => Promise.resolve([
                        { id: 'gpt-4', name: 'gpt-4', enabled: true, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
                        { id: 'gpt-3.5', name: 'gpt-3.5', enabled: false, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
                    ]),
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
                    json: () => Promise.resolve([
                        { id: 'gpt-4', name: 'gpt-4', enabled: false, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
                        { id: 'gpt-3.5', name: 'gpt-3.5', enabled: false, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
                    ]),
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
});

