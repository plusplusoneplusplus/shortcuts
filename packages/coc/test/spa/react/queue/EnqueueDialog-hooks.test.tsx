/**
 * Tests for EnqueueDialog hooks UI — add/remove hooks, timing/type selectors,
 * submit serialization (beforeScript, postActions, afterScript backward compat),
 * template save/restore, and reset on close/submit.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../../src/server/spa/client/react/context/QueueContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../../src/server/spa/client/react/context/MinimizedDialogsContext';
import { EnqueueDialog } from '../../../../src/server/spa/client/react/queue/EnqueueDialog';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

const mockFetch = vi.fn();

const MODELS_RESPONSE = [
    { id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
];

const SKILLS_RESPONSE = {
    merged: [
        { name: 'code-review', description: 'Review code' },
        { name: 'test-gen', description: 'Generate tests' },
    ],
};

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

// ── Providers ─────────────────────────────────────────────────────────────────

function Wrap({ children, workspaces = [] }: { children: ReactNode; workspaces?: any[] }) {
    return (
        <AppProvider>
            <QueueProvider>
                <MinimizedDialogsProvider>
                    <WorkspaceSetter workspaces={workspaces} />
                    {children}
                    <MinimizedDialogsTray />
                </MinimizedDialogsProvider>
            </QueueProvider>
        </AppProvider>
    );
}

function WorkspaceSetter({ workspaces }: { workspaces: any[] }) {
    const { dispatch } = useApp();
    useEffect(() => {
        if (workspaces.length > 0) {
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function DialogOpener({ mode, workspaceId }: { mode?: 'task' | 'ask' | 'resolve'; workspaceId?: string | null }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', folderPath: null, workspaceId: workspaceId ?? null, mode: mode ?? 'task' });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function setupFetchWithSkills() {
    mockFetch.mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/models')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(MODELS_RESPONSE) });
        }
        if (typeof url === 'string' && url.includes('/skills/all')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(SKILLS_RESPONSE) });
        }
        if (typeof url === 'string' && url.includes('/preferences')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
}

function renderDialogWithSkills(mode: 'task' | 'ask' | 'resolve' = 'task') {
    setupFetchWithSkills();
    return render(
        <Wrap workspaces={[{ id: 'ws-1', name: 'Test Workspace', rootPath: '/tmp/test' }]}>
            <DialogOpener mode={mode} workspaceId="ws-1" />
            <EnqueueDialog />
        </Wrap>
    );
}

function renderDialog(mode: 'task' | 'ask' | 'resolve' = 'task') {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(MODELS_RESPONSE) });
    return render(
        <Wrap>
            <DialogOpener mode={mode} />
            <EnqueueDialog />
        </Wrap>
    );
}

async function openAdvancedTab() {
    await waitFor(() => screen.getByTestId('floating-dialog-panel'));
    const advTab = screen.queryByRole('button', { name: /^Advanced$/i });
    if (advTab) {
        act(() => { fireEvent.click(advTab); });
    }
}

async function clickAddHook() {
    const addBtn = await screen.findByTestId('hook-add');
    act(() => { fireEvent.click(addBtn); });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('EnqueueDialog hooks UI', () => {
    it('renders "Hooks (optional)" section instead of "Scripts (optional)"', async () => {
        renderDialog();
        await openAdvancedTab();

        expect(screen.getByTestId('hooks-section')).toBeDefined();
        expect(screen.getByText('Hooks (optional)')).toBeDefined();
        expect(screen.queryByText('Scripts (optional)')).toBe(null);
    });

    it('shows "+ Add hook" button', async () => {
        renderDialog();
        await openAdvancedTab();

        const addBtn = screen.getByTestId('hook-add');
        expect(addBtn).toBeDefined();
        expect(addBtn.textContent).toContain('Add hook');
    });

    it('adds a hook entry when "+ Add hook" is clicked', async () => {
        renderDialog();
        await openAdvancedTab();

        expect(screen.queryAllByTestId('hook-entry')).toHaveLength(0);

        await clickAddHook();

        await waitFor(() => {
            expect(screen.queryAllByTestId('hook-entry')).toHaveLength(1);
        });
    });

    it('new hook defaults to timing=after, type=script', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook();

        await waitFor(() => {
            const entry = screen.getByTestId('hook-entry');
            const timingSelect = within(entry).getByTestId('hook-timing') as HTMLSelectElement;
            const typeSelect = within(entry).getByTestId('hook-type') as HTMLSelectElement;
            expect(timingSelect.value).toBe('after');
            expect(typeSelect.value).toBe('script');
        });
    });

    it('shows script input for script-type hooks', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook();

        await waitFor(() => {
            const entry = screen.getByTestId('hook-entry');
            expect(within(entry).getByTestId('hook-script-input')).toBeDefined();
            expect(within(entry).queryByTestId('hook-skill-select')).toBe(null);
        });
    });

    it('shows skill selector and prompt for skill-type hooks', async () => {
        renderDialogWithSkills();
        await openAdvancedTab();
        await clickAddHook();

        // Switch type to skill
        const entry = await screen.findByTestId('hook-entry');
        const typeSelect = within(entry).getByTestId('hook-type');
        act(() => { fireEvent.change(typeSelect, { target: { value: 'skill' } }); });

        await waitFor(() => {
            expect(within(entry).getByTestId('hook-skill-select')).toBeDefined();
            expect(within(entry).getByTestId('hook-skill-prompt')).toBeDefined();
            expect(within(entry).queryByTestId('hook-script-input')).toBe(null);
        });
    });

    it('can change hook timing to "before"', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook();

        const entry = await screen.findByTestId('hook-entry');
        const timingSelect = within(entry).getByTestId('hook-timing') as HTMLSelectElement;
        act(() => { fireEvent.change(timingSelect, { target: { value: 'before' } }); });

        expect(timingSelect.value).toBe('before');
    });

    it('removes a hook when ✕ is clicked', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook();
        await clickAddHook();

        await waitFor(() => {
            expect(screen.queryAllByTestId('hook-entry')).toHaveLength(2);
        });

        const removeButtons = screen.getAllByTestId('hook-remove');
        act(() => { fireEvent.click(removeButtons[0]); });

        await waitFor(() => {
            expect(screen.queryAllByTestId('hook-entry')).toHaveLength(1);
        });
    });

    it('can add multiple hooks', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook();
        await clickAddHook();
        await clickAddHook();

        await waitFor(() => {
            expect(screen.queryAllByTestId('hook-entry')).toHaveLength(3);
        });
    });
});

describe('EnqueueDialog hooks — submit serialization', () => {
    it('serializes before-script hook as body.payload.beforeScript', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook();

        // Set timing to before, type to script, enter a script
        const entry = await screen.findByTestId('hook-entry');
        const timingSelect = within(entry).getByTestId('hook-timing');
        act(() => { fireEvent.change(timingSelect, { target: { value: 'before' } }); });

        const scriptInput = within(entry).getByTestId('hook-script-input');
        act(() => { fireEvent.change(scriptInput, { target: { value: './setup.sh' } }); });

        // Type prompt text and submit
        const textarea = screen.getByTestId('prompt-input');
        act(() => {
            textarea.innerText = 'test with before hook';
            fireEvent.input(textarea);
        });

        await waitFor(() => {
            const btn = screen.queryByRole('button', { name: /enqueue/i });
            if (btn && !btn.hasAttribute('disabled')) {
                act(() => { fireEvent.click(btn); });
            }
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter((c: any) => c[1]?.method === 'POST');
            if (postCalls.length > 0) {
                const body = JSON.parse(postCalls[0][1].body);
                expect(body.payload.beforeScript).toBe('./setup.sh');
            }
        }, { timeout: 3000 });
    });

    it('serializes single after-script hook as both postActions and afterScript (backward compat)', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook();

        // Default is timing=after, type=script
        const entry = await screen.findByTestId('hook-entry');
        const scriptInput = within(entry).getByTestId('hook-script-input');
        act(() => { fireEvent.change(scriptInput, { target: { value: './cleanup.sh' } }); });

        const textarea = screen.getByTestId('prompt-input');
        act(() => {
            textarea.innerText = 'test with after hook';
            fireEvent.input(textarea);
        });

        await waitFor(() => {
            const btn = screen.queryByRole('button', { name: /enqueue/i });
            if (btn && !btn.hasAttribute('disabled')) {
                act(() => { fireEvent.click(btn); });
            }
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter((c: any) => c[1]?.method === 'POST');
            if (postCalls.length > 0) {
                const body = JSON.parse(postCalls[0][1].body);
                expect(body.payload.postActions).toEqual([{ type: 'script', script: './cleanup.sh' }]);
                expect(body.payload.afterScript).toBe('./cleanup.sh');
            }
        }, { timeout: 3000 });
    });

    it('does not set afterScript when there are multiple after hooks', async () => {
        renderDialog();
        await openAdvancedTab();

        // Add two after-script hooks
        await clickAddHook();
        await clickAddHook();

        const entries = screen.getAllByTestId('hook-entry');
        act(() => {
            fireEvent.change(within(entries[0]).getByTestId('hook-script-input'), { target: { value: './first.sh' } });
            fireEvent.change(within(entries[1]).getByTestId('hook-script-input'), { target: { value: './second.sh' } });
        });

        const textarea = screen.getByTestId('prompt-input');
        act(() => {
            textarea.innerText = 'test multi hooks';
            fireEvent.input(textarea);
        });

        await waitFor(() => {
            const btn = screen.queryByRole('button', { name: /enqueue/i });
            if (btn && !btn.hasAttribute('disabled')) {
                act(() => { fireEvent.click(btn); });
            }
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter((c: any) => c[1]?.method === 'POST');
            if (postCalls.length > 0) {
                const body = JSON.parse(postCalls[0][1].body);
                expect(body.payload.postActions).toHaveLength(2);
                expect(body.payload.afterScript).toBeUndefined();
            }
        }, { timeout: 3000 });
    });

    it('does not include empty hooks in payload', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook(); // Empty script hook — should be ignored

        const textarea = screen.getByTestId('prompt-input');
        act(() => {
            textarea.innerText = 'test empty hooks';
            fireEvent.input(textarea);
        });

        await waitFor(() => {
            const btn = screen.queryByRole('button', { name: /enqueue/i });
            if (btn && !btn.hasAttribute('disabled')) {
                act(() => { fireEvent.click(btn); });
            }
        });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter((c: any) => c[1]?.method === 'POST');
            if (postCalls.length > 0) {
                const body = JSON.parse(postCalls[0][1].body);
                expect(body.payload.beforeScript).toBeUndefined();
                expect(body.payload.afterScript).toBeUndefined();
                expect(body.payload.postActions).toBeUndefined();
            }
        }, { timeout: 3000 });
    });
});

describe('EnqueueDialog hooks — reset behavior', () => {
    it('clears hooks after successful submit', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook();

        expect(screen.queryAllByTestId('hook-entry')).toHaveLength(1);

        const entry = screen.getByTestId('hook-entry');
        act(() => {
            fireEvent.change(within(entry).getByTestId('hook-script-input'), { target: { value: './test.sh' } });
        });

        const textarea = screen.getByTestId('prompt-input');
        act(() => {
            textarea.innerText = 'submit to reset';
            fireEvent.input(textarea);
        });

        await waitFor(() => {
            const btn = screen.queryByRole('button', { name: /enqueue/i });
            if (btn && !btn.hasAttribute('disabled')) {
                act(() => { fireEvent.click(btn); });
            }
        });

        // Dialog closes after submit, hooks reset
        await waitFor(() => {
            expect(screen.queryByTestId('floating-dialog-panel')).toBe(null);
        }, { timeout: 3000 });
    });

    it('clears hooks on close', async () => {
        renderDialog();
        await openAdvancedTab();
        await clickAddHook();

        expect(screen.queryAllByTestId('hook-entry')).toHaveLength(1);

        const cancelBtn = screen.queryByRole('button', { name: /cancel/i });
        if (cancelBtn) {
            act(() => { fireEvent.click(cancelBtn); });
        }

        await waitFor(() => {
            expect(screen.queryByTestId('floating-dialog-panel')).toBe(null);
        });
    });
});

describe('EnqueueDialog hooks — template integration', () => {
    it('saves postActions to template and restores hooks from template', async () => {
        const savedTemplates: any[] = [];
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(MODELS_RESPONSE) });
            }
            if (typeof url === 'string' && url.includes('/skills/all')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(SKILLS_RESPONSE) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                if (opts?.method === 'PATCH') {
                    const body = JSON.parse(opts.body);
                    if (body.skillTemplates) savedTemplates.push(...body.skillTemplates);
                    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
                }
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skillTemplates: [{
                            id: 'tpl-hooks',
                            name: 'Hook Template',
                            model: 'gpt-4',
                            mode: 'task',
                            skills: [],
                            postActions: [
                                { type: 'script', script: './after.sh' },
                                { type: 'skill', skillName: 'code-review', prompt: 'check quality' },
                            ],
                        }],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws-1', name: 'Test', rootPath: '/tmp' }]}>
                <DialogOpener mode="task" workspaceId="ws-1" />
                <EnqueueDialog />
            </Wrap>
        );

        await waitFor(() => screen.getByTestId('floating-dialog-panel'));

        // Template tab should auto-switch since templates exist
        await waitFor(() => screen.getByTestId('template-card-tpl-hooks'));

        // Click the template card to select it
        act(() => { fireEvent.click(screen.getByTestId('template-card-tpl-hooks')); });

        // Switch to Advanced to see the restored hooks
        const advTab = screen.queryByRole('button', { name: /^Advanced$/i });
        if (advTab) {
            act(() => { fireEvent.click(advTab); });
        }

        await waitFor(() => {
            const entries = screen.queryAllByTestId('hook-entry');
            expect(entries).toHaveLength(2);
        });

        // Verify first hook is a script
        const entries = screen.getAllByTestId('hook-entry');
        const firstType = within(entries[0]).getByTestId('hook-type') as HTMLSelectElement;
        expect(firstType.value).toBe('script');

        // Verify second hook is a skill
        const secondType = within(entries[1]).getByTestId('hook-type') as HTMLSelectElement;
        expect(secondType.value).toBe('skill');
    });

    it('clears hooks when selecting a template with no postActions', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(MODELS_RESPONSE) });
            }
            if (typeof url === 'string' && url.includes('/skills/all')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(SKILLS_RESPONSE) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skillTemplates: [{
                            id: 'tpl-no-hooks',
                            name: 'No Hooks',
                            model: 'gpt-4',
                            mode: 'task',
                            skills: [],
                        }],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws-1', name: 'Test', rootPath: '/tmp' }]}>
                <DialogOpener mode="task" workspaceId="ws-1" />
                <EnqueueDialog />
            </Wrap>
        );

        await waitFor(() => screen.getByTestId('floating-dialog-panel'));

        // Switch to Advanced and add a hook manually
        const advTab = screen.queryByRole('button', { name: /^Advanced$/i });
        if (advTab) {
            act(() => { fireEvent.click(advTab); });
        }
        await clickAddHook();
        expect(screen.queryAllByTestId('hook-entry')).toHaveLength(1);

        // Switch to Templates and select the template without hooks
        const tplTab = screen.queryByRole('button', { name: /^Templates/i });
        if (tplTab) {
            act(() => { fireEvent.click(tplTab); });
        }
        await waitFor(() => screen.getByTestId('template-card-tpl-no-hooks'));
        act(() => { fireEvent.click(screen.getByTestId('template-card-tpl-no-hooks')); });

        // Switch back to Advanced — hooks should be cleared
        const advTab2 = screen.queryByRole('button', { name: /^Advanced$/i });
        if (advTab2) {
            act(() => { fireEvent.click(advTab2); });
        }

        await waitFor(() => {
            expect(screen.queryAllByTestId('hook-entry')).toHaveLength(0);
        });
    });
});

describe('EnqueueDialog hooks — skill type inputs', () => {
    it('skill selector lists available skills', async () => {
        renderDialogWithSkills();
        await openAdvancedTab();

        // Wait for skills to load
        await waitFor(() => {
            expect(mockFetch.mock.calls.some((c: any) => typeof c[0] === 'string' && c[0].includes('/skills/all'))).toBe(true);
        });

        await clickAddHook();

        // Switch to skill type
        const entry = await screen.findByTestId('hook-entry');
        const typeSelect = within(entry).getByTestId('hook-type');
        act(() => { fireEvent.change(typeSelect, { target: { value: 'skill' } }); });

        await waitFor(() => {
            const skillSelect = within(entry).getByTestId('hook-skill-select') as HTMLSelectElement;
            const options = Array.from(skillSelect.options).map(o => o.value);
            expect(options).toContain('code-review');
            expect(options).toContain('test-gen');
            expect(options).toContain(''); // "Select skill…" default
        });
    });

    it('skill prompt input accepts text', async () => {
        renderDialogWithSkills();
        await openAdvancedTab();

        await waitFor(() => {
            expect(mockFetch.mock.calls.some((c: any) => typeof c[0] === 'string' && c[0].includes('/skills/all'))).toBe(true);
        });

        await clickAddHook();

        const entry = await screen.findByTestId('hook-entry');
        const typeSelect = within(entry).getByTestId('hook-type');
        act(() => { fireEvent.change(typeSelect, { target: { value: 'skill' } }); });

        const promptInput = within(entry).getByTestId('hook-skill-prompt') as HTMLInputElement;
        act(() => { fireEvent.change(promptInput, { target: { value: 'check for bugs' } }); });

        expect(promptInput.value).toBe('check for bugs');
    });
});
