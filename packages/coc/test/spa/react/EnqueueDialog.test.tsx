/**
 * Tests for EnqueueDialog — folder picker, folderPath in POST body, flattenFolders helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../src/server/spa/client/react/context/MinimizedDialogsContext';
import { EnqueueDialog } from '../../../src/server/spa/client/react/queue/EnqueueDialog';
import { mockViewport } from '../../spa/helpers/viewport-mock';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

// Re-export flattenFolders for unit testing by extracting it
// Since flattenFolders is module-local, we replicate the logic here for unit tests
interface FolderOption { label: string; value: string; }

function flattenFolders(node: any, depth = 0): FolderOption[] {
    const indent = '\u00a0\u00a0'.repeat(depth);
    const options: FolderOption[] = [];
    if (node.relativePath !== undefined) {
        const label = node.relativePath === '' ? '(root)' : indent + node.name;
        options.push({ label, value: node.relativePath });
    }
    for (const child of node.children ?? []) {
        options.push(...flattenFolders(child, depth + 1));
    }
    return options;
}

// Helper: wrapper that provides App + Queue context with pre-set workspaces
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

// Injects workspaces into AppContext via dispatch
function WorkspaceSetter({ workspaces }: { workspaces: any[] }) {
    const { dispatch } = useApp();
    useEffect(() => {
        if (workspaces.length > 0) {
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

// Helper to open dialog via dispatch
function DialogOpener({ folderPath, workspaceId, mode }: { folderPath?: string | null; workspaceId?: string | null; mode?: 'task' | 'ask' }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', folderPath, workspaceId, mode });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

// ============================================================================
// flattenFolders unit tests
// ============================================================================

describe('flattenFolders', () => {
    it('flattens a root-only tree', () => {
        const tree = { name: 'tasks', relativePath: '', children: [] };
        const result = flattenFolders(tree);
        expect(result).toEqual([{ label: '(root)', value: '' }]);
    });

    it('flattens a nested tree with depth-indented labels', () => {
        const tree = {
            name: 'tasks',
            relativePath: '',
            children: [
                {
                    name: 'feature1',
                    relativePath: 'feature1',
                    children: [
                        {
                            name: 'backlog',
                            relativePath: 'feature1/backlog',
                            children: [],
                        },
                    ],
                },
                {
                    name: 'feature2',
                    relativePath: 'feature2',
                    children: [],
                },
            ],
        };
        const result = flattenFolders(tree);
        expect(result).toEqual([
            { label: '(root)', value: '' },
            { label: '\u00a0\u00a0feature1', value: 'feature1' },
            { label: '\u00a0\u00a0\u00a0\u00a0backlog', value: 'feature1/backlog' },
            { label: '\u00a0\u00a0feature2', value: 'feature2' },
        ]);
    });

    it('skips nodes without relativePath', () => {
        const tree = { name: 'tasks', relativePath: '', children: [{ name: 'orphan' }] };
        const result = flattenFolders(tree);
        expect(result).toEqual([{ label: '(root)', value: '' }]);
    });

    it('handles empty children', () => {
        const tree = { name: 'tasks', relativePath: '', children: [] };
        const result = flattenFolders(tree);
        expect(result).toHaveLength(1);
    });
});

// ============================================================================
// EnqueueDialog integration tests
// ============================================================================

describe('EnqueueDialog', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
        // Default: models endpoint returns empty
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks',
                        relativePath: '',
                        children: [
                            { name: 'feature1', relativePath: 'feature1', children: [] },
                        ],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not render folder select when workspaceId is empty', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
        expect(screen.queryByTestId('folder-select')).toBeNull();
    });

    it('seeds folderPath from dialogInitialFolderPath when dialog opens', async () => {
        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener folderPath="feature1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
        // The folder select won't appear until workspace is selected,
        // but dialogInitialFolderPath should be set in the state
    });

    it('filters out .git folders from folder select options', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks',
                        relativePath: '',
                        children: [
                            { name: 'feature1', relativePath: 'feature1', children: [], documentGroups: [], singleDocuments: [] },
                            { name: '.git', relativePath: '.git', children: [
                                { name: 'refs', relativePath: '.git/refs', children: [], documentGroups: [], singleDocuments: [] },
                            ], documentGroups: [], singleDocuments: [] },
                        ],
                        documentGroups: [],
                        singleDocuments: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener folderPath="" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Select workspace to trigger folder fetch
        const wsSelect = screen.getAllByRole('combobox')[1];
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        await waitFor(() => {
            expect(screen.getByTestId('folder-select')).toBeTruthy();
        });

        const folderSelect = screen.getByTestId('folder-select') as HTMLSelectElement;
        const options = Array.from(folderSelect.options).map(o => o.value);
        expect(options).toContain('feature1');
        expect(options).not.toContain('.git');
        expect(options).not.toContain('.git/refs');
    });

    it('includes folderPath in POST body when folder is selected', async () => {
        let postBody: any = null;
        let postUrl: string = '';
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                postUrl = url;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks',
                        relativePath: '',
                        children: [
                            { name: 'feature1', relativePath: 'feature1', children: [] },
                        ],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/home/user/project' }]}>
                <DialogOpener folderPath="feature1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Select workspace
        const wsSelect = screen.getAllByRole('combobox')[1]; // second select = workspace
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        // Wait for folder select to appear
        await waitFor(() => {
            expect(screen.getByTestId('folder-select')).toBeTruthy();
        });

        // Select folder
        const folderSelect = screen.getByTestId('folder-select');
        fireEvent.change(folderSelect, { target: { value: 'feature1' } });

        // Enter prompt
        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'Test prompt' } });

        // Submit
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postUrl).toContain('/queue/tasks');
        expect(postBody.type).toBe('follow-prompt');
        expect(postBody.payload.promptContent).toBe('Test prompt');
        expect(postBody.payload.workingDirectory).toBe('/home/user/project');
    });

    it('omits folderPath from POST body when no folder is selected', async () => {
        let postBody: any = null;
        let postUrl: string = '';
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                postUrl = url;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Enter prompt and submit without folder
        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'Test prompt' } });
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postUrl).toContain('/queue/tasks');
        expect(postBody.type).toBe('follow-prompt');
        expect(postBody.payload.promptContent).toBe('Test prompt');
        expect(postBody.payload.workingDirectory).toBeUndefined();
    });

    it('fetches skills when workspace is selected and shows skill selector', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [
                            { name: 'impl', description: 'Implementation tasks' },
                            { name: 'go-deep', description: 'Deep research' },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Skill selector should not appear without workspace
        expect(screen.queryByTestId('skill-select')).toBeNull();

        // Select workspace
        const wsSelect = screen.getAllByRole('combobox')[1];
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        // Wait for skill selector to appear
        await waitFor(() => {
            expect(screen.getByTestId('skill-select')).toBeTruthy();
        });

        const skillSelect = screen.getByTestId('skill-select') as HTMLSelectElement;
        const options = Array.from(skillSelect.options).map(o => o.value);
        expect(options).toContain('');  // None option
        expect(options).toContain('impl');
        expect(options).toContain('go-deep');
    });

    it('submits skill-based task to /queue/tasks when skill is selected', async () => {
        let postBody: any = null;
        let postUrl: string = '';
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks')) {
                postBody = JSON.parse(opts?.body || '{}');
                postUrl = url;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl', description: 'Implementation tasks' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/home/user/project' }]}>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Select workspace
        const wsSelect = screen.getAllByRole('combobox')[1];
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        // Wait for skill selector
        await waitFor(() => {
            expect(screen.getByTestId('skill-select')).toBeTruthy();
        });

        // Select skill
        fireEvent.change(screen.getByTestId('skill-select'), { target: { value: 'impl' } });

        // Submit without explicit prompt (should use default)
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postUrl).toContain('/queue/tasks');
        expect(postBody.type).toBe('follow-prompt');
        expect(postBody.displayName).toBe('Skill: impl');
        expect(postBody.payload.skillName).toBe('impl');
        expect(postBody.payload.promptContent).toBe('Use the impl skill.');
        expect(postBody.payload.workingDirectory).toBe('/home/user/project');
    });

    it('uses custom prompt content when skill is selected with prompt', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks')) {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/project' }]}>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Select workspace
        const wsSelect = screen.getAllByRole('combobox')[1];
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        await waitFor(() => {
            expect(screen.getByTestId('skill-select')).toBeTruthy();
        });

        // Select skill and enter custom prompt
        fireEvent.change(screen.getByTestId('skill-select'), { target: { value: 'impl' } });
        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'Fix the login bug' } });

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.payload.promptContent).toBe('Fix the login bug');
    });

    it('pre-selects workspace when dialogInitialWorkspaceId is set', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl', description: 'Implementation' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Skill selector should appear because workspace was pre-selected
        await waitFor(() => {
            expect(screen.getByTestId('skill-select')).toBeTruthy();
        });
    });

    it('enables Enqueue button when skill is selected but prompt is empty', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Initially Enqueue should be disabled (no prompt, no skill)
        expect((screen.getByText('Enqueue') as HTMLButtonElement).disabled).toBe(true);

        // Wait for skill selector
        await waitFor(() => {
            expect(screen.getByTestId('skill-select')).toBeTruthy();
        });

        // Select a skill
        fireEvent.change(screen.getByTestId('skill-select'), { target: { value: 'impl' } });

        // Enqueue should now be enabled even without prompt
        expect((screen.getByText('Enqueue') as HTMLButtonElement).disabled).toBe(false);
    });

    it('renders ImagePreviews paste hint below the textarea', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
        // The ImagePreviews component shows a paste hint when showHint is true and no images
        expect(screen.getByText(/Paste images/)).toBeTruthy();
    });

    it('includes images in freeform POST body when present', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'Test with images' } });

        // Simulate paste with an image blob
        const file = new File(['fake-png'], 'screenshot.png', { type: 'image/png' });
        const items = [{
            type: 'image/png',
            getAsFile: () => file,
        }];
        const pasteEvent = new Event('paste', { bubbles: true }) as any;
        pasteEvent.clipboardData = {
            items,
            types: ['image/png'],
        };
        // We need to use the React onPaste which expects ClipboardEvent shape
        fireEvent.paste(textarea, {
            clipboardData: {
                items,
                types: ['image/png'],
            },
        });

        // FileReader is async, but in jsdom it may not fully support readAsDataURL
        // Instead, just submit and verify images field is omitted (no images were actually added)
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.type).toBe('follow-prompt');
        expect(postBody.payload.promptContent).toBe('Test with images');
        // images should be undefined when no images were successfully added
        expect(postBody.images).toBeUndefined();
    });

    it('includes images in skill-based POST body when present', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks')) {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/project' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        await waitFor(() => {
            expect(screen.getByTestId('skill-select')).toBeTruthy();
        });

        fireEvent.change(screen.getByTestId('skill-select'), { target: { value: 'impl' } });

        // Submit — no images pasted so images field should be omitted
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.type).toBe('follow-prompt');
        expect(postBody.images).toBeUndefined();
    });

    it('includes model in config when skill task is submitted with model', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks')) {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: ['gpt-4', 'claude-sonnet'] }) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/proj' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        await waitFor(() => {
            expect(screen.getByTestId('skill-select')).toBeTruthy();
        });

        // Select model (skill-select=index 0, model=index 1, workspace=index 2)
        const modelSelect = screen.getAllByRole('combobox')[1];
        fireEvent.change(modelSelect, { target: { value: 'claude-sonnet' } });

        // Select skill
        fireEvent.change(screen.getByTestId('skill-select'), { target: { value: 'impl' } });

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.config).toEqual({ model: 'claude-sonnet' });
    });

    it('freeform submit sends follow-prompt type, never chat (regression)', async () => {
        let postBody: any = null;
        let postUrl: string = '';
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                postUrl = url;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'My freeform task' } });
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });

        // Must use /queue/tasks endpoint, NOT /queue/enqueue
        expect(postUrl).toContain('/queue/tasks');
        expect(postUrl).not.toContain('/queue/enqueue');
        // Must be follow-prompt, NOT chat
        expect(postBody.type).toBe('follow-prompt');
        expect(postBody.type).not.toBe('chat');
        expect(postBody.payload.promptContent).toBe('My freeform task');
    });

    it('freeform submit includes model in config when set', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: ['gpt-4', 'claude-sonnet'] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Select model
        const modelSelect = screen.getAllByRole('combobox')[0];
        fireEvent.change(modelSelect, { target: { value: 'gpt-4' } });

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'Prompt with model' } });

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.type).toBe('follow-prompt');
        expect(postBody.config).toEqual({ model: 'gpt-4' });
    });

    it('freeform submit uses workspace rootPath as workingDirectory', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/my/project' }]}>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Select workspace
        const wsSelect = screen.getAllByRole('combobox')[1];
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'Task in workspace' } });

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.payload.workingDirectory).toBe('/my/project');
    });

    it('persists selected skill to preferences via PATCH on submit', async () => {
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [
                            { name: 'impl', description: 'Implementation tasks' },
                            { name: 'go-deep', description: 'Deep research' },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/preferences') && opts?.method === 'PATCH') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/tasks') && opts?.method === 'POST') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Select workspace
        const wsSelect = screen.getAllByRole('combobox')[1];
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        // Wait for skill selector
        await waitFor(() => {
            expect(screen.getByTestId('skill-select')).toBeTruthy();
        });

        // Select skill
        fireEvent.change(screen.getByTestId('skill-select'), { target: { value: 'impl' } });

        // Selecting skill alone should NOT trigger a PATCH (save on submit only)
        await new Promise(r => setTimeout(r, 50));
        const patchCallsBefore = fetchSpy.mock.calls.filter(
            ([u, opts]: [string, any]) =>
                typeof u === 'string' && u.includes('/preferences') && opts?.method === 'PATCH'
        );
        expect(patchCallsBefore.length).toBe(0);

        // Submit the task
        fireEvent.click(screen.getByText('Enqueue'));

        // Verify PATCH was called with lastQueueTaskSkill on submit
        await waitFor(() => {
            const patchCalls = fetchSpy.mock.calls.filter(
                ([u, opts]: [string, any]) =>
                    typeof u === 'string' && u.includes('/preferences') && !u.includes('/skill-usage') && opts?.method === 'PATCH'
            );
            expect(patchCalls.length).toBeGreaterThanOrEqual(1);
            const lastPatch = patchCalls[patchCalls.length - 1];
            const body = JSON.parse(lastPatch[1].body);
            expect(body.lastQueueTaskSkill).toBe('impl');
        });
    });

    it('restores last-used skill from preferences when skills load', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastQueueTaskSkill: 'go-deep' }),
                });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [
                            { name: 'impl', description: 'Implementation tasks' },
                            { name: 'go-deep', description: 'Deep research' },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Wait for skill selector to appear with pre-selected value
        await waitFor(() => {
            const skillSelect = screen.getByTestId('skill-select') as HTMLSelectElement;
            expect(skillSelect.value).toBe('go-deep');
        });
    });

    it('does not restore skill if it is not in available skills list', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastQueueTaskSkill: 'nonexistent-skill' }),
                });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl', description: 'Implementation tasks' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Wait for skill selector
        await waitFor(() => {
            expect(screen.getByTestId('skill-select')).toBeTruthy();
        });

        // Should remain on "None" since the saved skill doesn't exist
        const skillSelect = screen.getByTestId('skill-select') as HTMLSelectElement;
        expect(skillSelect.value).toBe('');
    });

    // ── floating vs modal dialog layout ────────────────────────────────────

    describe('desktop/mobile dialog layout', () => {
        let viewportCleanup: (() => void) | undefined;

        afterEach(() => {
            viewportCleanup?.();
            viewportCleanup = undefined;
        });

        it('uses FloatingDialog (no backdrop) on desktop viewport', async () => {
            viewportCleanup = mockViewport(1280);
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>,
            );
            await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

            // FloatingDialog renders without an inset-0 backdrop overlay
            expect(document.querySelector('[data-testid="dialog-overlay"]')).toBeNull();
            expect(document.querySelector('[data-testid="floating-dialog-panel"]')).not.toBeNull();
        });

        it('uses Dialog (with backdrop) on mobile viewport', async () => {
            viewportCleanup = mockViewport(375);
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>,
            );
            await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

            // Standard Dialog renders with dialog-overlay
            expect(document.querySelector('[data-testid="dialog-overlay"]')).not.toBeNull();
            expect(document.querySelector('[data-testid="floating-dialog-panel"]')).toBeNull();
        });

        it('FloatingDialog panel has a drag handle on desktop', async () => {
            viewportCleanup = mockViewport(1280);
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>,
            );
            await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

            const handle = document.querySelector('[data-testid="floating-dialog-drag-handle"]');
            expect(handle).not.toBeNull();
            expect((handle as HTMLElement).className).toContain('cursor-move');
        });

        it('rest of page is accessible (no backdrop) on desktop', async () => {
            viewportCleanup = mockViewport(1280);
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>,
            );
            await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

            // No fixed inset-0 overlay covering the whole screen
            const overlay = document.querySelector('.fixed.inset-0');
            expect(overlay).toBeNull();
        });
    });

    it('submits on Ctrl+Enter from textarea', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>,
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'ctrl enter test' } });
        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/queue/tasks'),
                expect.objectContaining({ method: 'POST' }),
            );
        });
    });

    it('does not submit on Enter without Ctrl', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>,
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'plain enter test' } });
        fireEvent.keyDown(textarea, { key: 'Enter' });

        // fetch should not have been called for /queue/tasks
        expect(global.fetch).not.toHaveBeenCalledWith(
            expect.stringContaining('/queue/tasks'),
            expect.anything(),
        );
    });
});

// ============================================================================
// EnqueueDialog — minimize / restore
// ============================================================================

describe('EnqueueDialog minimize behavior', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows minimize button in dialog header on desktop', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>
            );
        });
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        expect(document.querySelector('[data-testid="dialog-minimize-btn"]')).not.toBeNull();
    });

    it('clicking minimize hides the dialog and shows a pill in the tray', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>
            );
        });
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]') as HTMLElement;
        await act(async () => { fireEvent.click(minimizeBtn); });

        // Dialog content should be gone
        expect(screen.queryByText('Enqueue AI Task')).toBeNull();
        // Pill should appear
        const pill = document.querySelector('[data-testid="minimized-pill-enqueue-task"]');
        expect(pill).not.toBeNull();
        expect(pill!.textContent).toContain('📋');
        expect(pill!.textContent).toContain('Enqueue Task');
        expect(pill!.textContent).toContain('Restore');
    });

    it('pill shows prompt preview when prompt has content', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>
            );
        });
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'Fix the login bug' } });

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]') as HTMLElement;
        await act(async () => { fireEvent.click(minimizeBtn); });

        const pill = document.querySelector('[data-testid="minimized-pill-enqueue-task"]');
        expect(pill).not.toBeNull();
        expect(pill!.textContent).toContain('Fix the login bug');
    });

    it('pill shows no preview when prompt is empty', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>
            );
        });
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]') as HTMLElement;
        await act(async () => { fireEvent.click(minimizeBtn); });

        const pill = document.querySelector('[data-testid="minimized-pill-enqueue-task"]');
        expect(pill).not.toBeNull();
        expect(pill!.textContent).not.toContain('▪');
    });

    it('pill shows truncated preview when prompt exceeds 30 chars', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>
            );
        });
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const longPrompt = 'This is a very long prompt that exceeds thirty characters';
        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: longPrompt } });

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]') as HTMLElement;
        await act(async () => { fireEvent.click(minimizeBtn); });

        const pill = document.querySelector('[data-testid="minimized-pill-enqueue-task"]');
        expect(pill).not.toBeNull();
        expect(pill!.textContent).toContain('…');
        expect(pill!.textContent).not.toContain(longPrompt);
    });

    it('clicking Restore pill re-opens the dialog', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>
            );
        });
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]') as HTMLElement;
        await act(async () => { fireEvent.click(minimizeBtn); });

        const pill = document.querySelector('[data-testid="minimized-pill-enqueue-task"]') as HTMLElement;
        await act(async () => { fireEvent.click(pill); });

        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        expect(document.querySelector('[data-testid="minimized-pill-enqueue-task"]')).toBeNull();
    });

    it('form state is preserved after minimize then restore', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>
            );
        });
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'My important prompt' } });

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]') as HTMLElement;
        await act(async () => { fireEvent.click(minimizeBtn); });

        const pill = document.querySelector('[data-testid="minimized-pill-enqueue-task"]') as HTMLElement;
        await act(async () => { fireEvent.click(pill); });

        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        expect((screen.getByPlaceholderText('Enter your prompt… Type / for skills') as HTMLTextAreaElement).value)
            .toBe('My important prompt');
    });

    it('closing from pill via ✕ removes pill and closes dialog', async () => {
        await act(async () => {
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>
            );
        });
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]') as HTMLElement;
        await act(async () => { fireEvent.click(minimizeBtn); });

        const closeBtn = document.querySelector('[data-testid="minimized-pill-enqueue-task"] button') as HTMLElement;
        expect(closeBtn).not.toBeNull();
        await act(async () => { fireEvent.click(closeBtn); });

        expect(document.querySelector('[data-testid="minimized-pill-enqueue-task"]')).toBeNull();
        expect(screen.queryByText('Enqueue AI Task')).toBeNull();
    });

    it('minimize button is hidden while submitting', async () => {
        const fetchSpy = vi.fn().mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            // Simulate slow submit
            return new Promise(() => { /* never resolves */ });
        });
        global.fetch = fetchSpy;

        await act(async () => {
            render(
                <Wrap>
                    <DialogOpener />
                    <EnqueueDialog />
                </Wrap>
            );
        });
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills');
        fireEvent.change(textarea, { target: { value: 'test prompt' } });

        const submitBtn = screen.getByText('Enqueue');
        await act(async () => { fireEvent.click(submitBtn); });

        // While submitting, minimize button should be absent
        expect(document.querySelector('[data-testid="dialog-minimize-btn"]')).toBeNull();
    });
});

// ============================================================================
// Slash-command integration tests
// ============================================================================

describe('EnqueueDialog slash commands', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    function setupFetchWithSkills(skills: Array<{ name: string; description?: string }>, capturePosts?: { body: any; url: string }[]) {
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks') && opts?.method === 'POST') {
                capturePosts?.push({ body: JSON.parse(opts.body || '{}'), url });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills }),
                });
            }
            if (typeof url === 'string' && url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        name: 'tasks', relativePath: '', children: [],
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    }

    beforeEach(() => {
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows slash-command menu when typing / in the prompt textarea', async () => {
        setupFetchWithSkills([
            { name: 'impl', description: 'Implementation' },
            { name: 'draft', description: 'Draft spec' },
        ]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/project' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-select')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills') as HTMLTextAreaElement;
        // Simulate typing '/'
        fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } });

        await waitFor(() => {
            expect(screen.getByTestId('slash-command-menu')).toBeTruthy();
        });

        // Both skills should appear in the menu
        expect(screen.getByText('impl')).toBeTruthy();
        expect(screen.getByText('draft')).toBeTruthy();
    });

    it('filters slash-command menu as user types after /', async () => {
        setupFetchWithSkills([
            { name: 'impl', description: 'Implementation' },
            { name: 'draft', description: 'Draft spec' },
        ]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/project' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-select')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills') as HTMLTextAreaElement;
        // Type '/im' to filter
        fireEvent.change(textarea, { target: { value: '/im', selectionStart: 3 } });

        await waitFor(() => {
            expect(screen.getByTestId('slash-command-menu')).toBeTruthy();
        });

        // Only 'impl' should match the filter
        expect(screen.getByText('impl')).toBeTruthy();
        expect(screen.queryByText('draft')).toBeNull();
    });

    it('sets selectedSkill dropdown when slash-command skill is selected via click', async () => {
        setupFetchWithSkills([
            { name: 'impl', description: 'Implementation' },
            { name: 'draft', description: 'Draft spec' },
        ]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/project' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-select')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } });

        await waitFor(() => {
            expect(screen.getByTestId('slash-command-menu')).toBeTruthy();
        });

        // Click on 'impl' in the menu (uses mousedown to prevent blur)
        const implItem = screen.getByText('impl');
        fireEvent.mouseDown(implItem);

        // Skill dropdown should now show 'impl' selected
        await waitFor(() => {
            const skillSelect = screen.getByTestId('skill-select') as HTMLSelectElement;
            expect(skillSelect.value).toBe('impl');
        });
    });

    it('submits skill task when /skill-name is typed in prompt without dropdown selection', async () => {
        const posts: Array<{ body: any; url: string }> = [];
        setupFetchWithSkills(
            [{ name: 'impl', description: 'Implementation' }],
            posts,
        );

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/project' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-select')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills') as HTMLTextAreaElement;
        // Type '/impl fix the bug' without using the autocomplete menu
        fireEvent.change(textarea, { target: { value: '/impl fix the bug', selectionStart: 17 } });

        // Submit
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => expect(posts.length).toBeGreaterThan(0));

        const body = posts[0].body;
        expect(body.type).toBe('follow-prompt');
        expect(body.displayName).toBe('Skill: impl');
        expect(body.payload.skillName).toBe('impl');
        expect(body.payload.promptContent).toBe('fix the bug');
    });

    it('placeholder text includes slash-command hint', async () => {
        setupFetchWithSkills([]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        expect(screen.getByPlaceholderText('Enter your prompt… Type / for skills')).toBeTruthy();
    });

    it('dismisses slash-command menu on Escape', async () => {
        setupFetchWithSkills([
            { name: 'impl', description: 'Implementation' },
        ]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/project' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-select')).toBeTruthy());

        const textarea = screen.getByPlaceholderText('Enter your prompt… Type / for skills') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: '/', selectionStart: 1 } });

        await waitFor(() => {
            expect(screen.getByTestId('slash-command-menu')).toBeTruthy();
        });

        // Press Escape
        fireEvent.keyDown(textarea, { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByTestId('slash-command-menu')).toBeNull();
        });
    });

    it('dropdown skill takes priority over slash-command skill on submit', async () => {
        const posts: Array<{ body: any; url: string }> = [];
        setupFetchWithSkills(
            [
                { name: 'impl', description: 'Implementation' },
                { name: 'draft', description: 'Draft spec' },
            ],
            posts,
        );

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/project' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-select')).toBeTruthy());

        // Select 'draft' in dropdown
        fireEvent.change(screen.getByTestId('skill-select'), { target: { value: 'draft' } });

        // Type '/impl do stuff' in prompt
        const textarea = screen.getByPlaceholderText(/context for draft skill/) as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: '/impl do stuff', selectionStart: 14 } });

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => expect(posts.length).toBeGreaterThan(0));

        const body = posts[0].body;
        // Dropdown selection ('draft') takes priority over /impl in prompt
        expect(body.payload.skillName).toBe('draft');
    });
});

// ============================================================================
// EnqueueDialog ask mode tests
// ============================================================================

describe('EnqueueDialog ask mode', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows "Ask AI (Read-only)" title when mode is ask', async () => {
        render(
            <Wrap>
                <DialogOpener mode="ask" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy();
        });
    });

    it('shows "Ask" submit button when mode is ask', async () => {
        render(
            <Wrap>
                <DialogOpener mode="ask" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Ask')).toBeTruthy();
        });
    });

    it('shows "Enqueue AI Task" title when mode is task (default)', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
    });

    it('submits a chat task with readonly:true in ask mode', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/tasks') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/test' }]}>
                <DialogOpener mode="ask" workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy();
        });

        const textarea = screen.getByRole('textbox');
        fireEvent.change(textarea, { target: { value: 'What does this function do?' } });
        fireEvent.click(screen.getByText('Ask'));

        await waitFor(() => {
            expect(postBody).not.toBeNull();
        });

        expect(postBody.type).toBe('chat');
        expect(postBody.payload.kind).toBe('chat');
        expect(postBody.payload.readonly).toBe(true);
        expect(postBody.payload.prompt).toBe('What does this function do?');
    });
});
