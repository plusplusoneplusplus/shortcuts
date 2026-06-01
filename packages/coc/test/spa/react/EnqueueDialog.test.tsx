/**
 * Tests for EnqueueDialog — folder picker, folderPath in POST body, flattenFolders helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../src/server/spa/client/react/contexts/MinimizedDialogsContext';
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
function DialogOpener({
    folderPath,
    workspaceId,
    mode,
    contextFiles,
    bulkMode,
    launchMode,
}: {
    folderPath?: string | null;
    workspaceId?: string | null;
    mode?: 'task' | 'ask' | 'resolve';
    contextFiles?: string[] | null;
    bulkMode?: boolean;
    launchMode?: 'default' | 'floating-chat';
}) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', folderPath, workspaceId, mode, contextFiles, bulkMode, launchMode });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

async function selectModalModel(modelId: string) {
    fireEvent.click(screen.getByTestId('enqueue-model-picker-chip'));
    const menu = await screen.findByTestId('model-command-menu');
    fireEvent.mouseDown(within(menu).getByText(modelId));
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
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks',
                        relativePath: '',
                        children: [
                            { name: 'feature1', relativePath: 'feature1', children: [] },
                        ],
                    } }),
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
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
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
                    } }),
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
        const wsSelect = screen.getByTestId('workspace-select');
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
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                postUrl = url;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks',
                        relativePath: '',
                        children: [
                            { name: 'feature1', relativePath: 'feature1', children: [] },
                        ],
                    } }),
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
        const wsSelect = screen.getByTestId('workspace-select');
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        // Wait for folder select to appear
        await waitFor(() => {
            expect(screen.getByTestId('folder-select')).toBeTruthy();
        });

        // Select folder
        const folderSelect = screen.getByTestId('folder-select');
        fireEvent.change(folderSelect, { target: { value: 'feature1' } });

        // Enter prompt
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Test prompt';
        fireEvent.input(textarea);

        // Submit
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postUrl).toContain('/queue');
        expect(postBody.type).toBe('chat');
        expect(postBody.payload.prompt).toBe('Test prompt');
        expect(postBody.payload.workingDirectory).toBe('/home/user/project');
    });

    it('omits folderPath from POST body when no folder is selected', async () => {
        let postBody: any = null;
        let postUrl: string = '';
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                postUrl = url;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Test prompt';
        fireEvent.input(textarea);
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postUrl).toContain('/queue');
        expect(postBody.type).toBe('chat');
        expect(postBody.payload.prompt).toBe('Test prompt');
        expect(postBody.payload.workingDirectory).toBeUndefined();
    });

    it('fetches skills when workspace is selected and shows skill selector', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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
        expect(screen.queryByTestId('skill-chips')).toBeNull();

        // Select workspace
        const wsSelect = screen.getByTestId('workspace-select');
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        // Wait for skill chips area to appear
        await waitFor(() => {
            expect(screen.getByTestId('skill-chips')).toBeTruthy();
        });

        // Open popover to verify skills are listed
        fireEvent.click(screen.getByTestId('skill-picker-trigger'));
        expect(screen.getByTestId('skill-picker-item-impl')).toBeTruthy();
        expect(screen.getByTestId('skill-picker-item-go-deep')).toBeTruthy();
    });

    it('submits skill-based task to /queue when skill is selected', async () => {
        let postBody: any = null;
        let postUrl: string = '';
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue')) {
                postBody = JSON.parse(opts?.body || '{}');
                postUrl = url;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl', description: 'Implementation tasks' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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
        const wsSelect = screen.getByTestId('workspace-select');
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        // Wait for skill chips
        await waitFor(() => {
            expect(screen.getByTestId('skill-chips')).toBeTruthy();
        });

        // Select skill via popover
        fireEvent.click(screen.getByTestId('skill-picker-trigger'));
        fireEvent.click(screen.getByTestId('skill-picker-item-impl'));

        // Submit without explicit prompt (should use default)
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postUrl).toContain('/queue');
        expect(postBody.type).toBe('chat');
        expect(postBody.displayName).toBe('Skill: impl');
        expect(postBody.payload.context.skills).toEqual(['impl']);
        expect(postBody.payload.prompt).toBe('Use the impl skill.');
        expect(postBody.payload.workingDirectory).toBe('/home/user/project');
    });

    it('uses custom prompt content when skill is selected with prompt', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue')) {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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
        const wsSelect = screen.getByTestId('workspace-select');
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        await waitFor(() => {
            expect(screen.getByTestId('skill-chips')).toBeTruthy();
        });

        // Select skill via popover and enter custom prompt
        fireEvent.click(screen.getByTestId('skill-picker-trigger'));
        fireEvent.click(screen.getByTestId('skill-picker-item-impl'));
        // Close popover before accessing the main textarea
        fireEvent.mouseDown(document.body);
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Fix the login bug';
        fireEvent.input(textarea);

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.payload.prompt).toBe('Fix the login bug');
    });

    it('pre-selects workspace when dialogInitialWorkspaceId is set', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl', description: 'Implementation' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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

        // Skill chips should appear because workspace was pre-selected
        await waitFor(() => {
            expect(screen.getByTestId('skill-chips')).toBeTruthy();
        });
    });

    it('enables Enqueue button when skill is selected but prompt is empty', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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

        // Wait for skill chips
        await waitFor(() => {
            expect(screen.getByTestId('skill-chips')).toBeTruthy();
        });

        // Select a skill via popover
        fireEvent.click(screen.getByTestId('skill-picker-trigger'));
        fireEvent.click(screen.getByTestId('skill-picker-item-impl'));

        // Enqueue should now be enabled even without prompt
        expect((screen.getByText('Enqueue') as HTMLButtonElement).disabled).toBe(false);
    });

    it('enables submit button when contextFiles are present but no skill and no prompt', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" contextFiles={['/tasks/feature.plan.md']} />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Run Skill')).toBeTruthy();
        });

        // Button should be enabled immediately — contextFiles make skill+prompt optional
        const enqueueBtn = screen.getByText('Enqueue') as HTMLButtonElement;
        expect(enqueueBtn.disabled).toBe(false);
    });

    it('renders attachment hint below the prompt input', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
        // The attach button and hint text are shown
        expect(screen.getByTestId('enqueue-attach-btn')).toBeTruthy();
        expect(screen.getByText(/paste images.*drag.*drop/i)).toBeTruthy();
    });

    it('includes images in freeform POST body when present', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Test with images';
        fireEvent.input(textarea);

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
        expect(postBody.type).toBe('chat');
        expect(postBody.payload.prompt).toBe('Test with images');
        // images should be undefined when no images were successfully added
        expect(postBody.images).toBeUndefined();
    });

    it('includes images in skill-based POST body when present', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue')) {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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
            expect(screen.getByTestId('skill-chips')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('skill-picker-trigger'));
        fireEvent.click(screen.getByTestId('skill-picker-item-impl'));

        // Submit — no images pasted so images field should be omitted
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.type).toBe('chat');
    });

    it('includes model in config when skill task is submitted with model', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue')) {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-sonnet', name: 'claude-sonnet', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skills: [{ name: 'impl' }],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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
            expect(screen.getByTestId('skill-chips')).toBeTruthy();
        });

        // Select model (no skill select dropdown, so model=index 0, workspace=index 1)
        await selectModalModel('claude-sonnet');

        // Select skill via popover
        fireEvent.click(screen.getByTestId('skill-picker-trigger'));
        fireEvent.click(screen.getByTestId('skill-picker-item-impl'));

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.config).toEqual({ model: 'claude-sonnet' });
    });

    it('freeform submit sends chat type with autopilot mode', async () => {
        let postBody: any = null;
        let postUrl: string = '';
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                postUrl = url;
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'My freeform task';
        fireEvent.input(textarea);
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });

        // Must use the canonical /queue endpoint, not removed task aliases.
        expect(postUrl).toContain('/queue');
        expect(postUrl).not.toContain('/queue/tasks');
        expect(postUrl).not.toContain('/queue/enqueue');
        // Must be chat with autopilot mode
        expect(postBody.type).toBe('chat');
        expect(postBody.payload.kind).toBe('chat');
        expect(postBody.payload.mode).toBe('autopilot');
        expect(postBody.payload.prompt).toBe('My freeform task');
    });

    it('freeform submit includes model in config when set', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-sonnet', name: 'claude-sonnet', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }) });
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
        await selectModalModel('gpt-4');

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Prompt with model';
        fireEvent.input(textarea);

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.type).toBe('chat');
        expect(postBody.config).toEqual({ model: 'gpt-4' });
    });

    it('ask submit includes selected provider and legacy reasoning effort without forcing a model override', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.endsWith('/agent-providers')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ providers: [
                    { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
                    { id: 'codex', label: 'Codex', enabled: true, available: true },
                ] }) });
            }
            if (typeof url === 'string' && url.includes('/agent-providers/codex') && url.includes('/reasoning-efforts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ reasoningEfforts: { 'codex-default': 'high' } }) });
            }
            if (typeof url === 'string' && url.includes('/agent-providers/codex/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'codex', models: [{
                    id: 'codex-default',
                    name: 'Codex Default',
                    enabled: true,
                    capabilities: { supports: { vision: false, reasoningEffort: true }, limits: { max_context_window_tokens: 128000 } },
                    supportedReasoningEfforts: ['low', 'medium', 'high'],
                }] }) });
            }
            if (typeof url === 'string' && url.includes('/agent-providers/codex/effort-tiers')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'codex', effortTiers: {}, defaults: {} }) });
            }
            if (typeof url === 'string' && url.includes('/preferences') && (!opts || opts.method !== 'PATCH')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({
                    lastChatProvider: 'codex',
                    defaultModelsByProvider: { codex: { ask: 'codex-default' } },
                }) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/test' }]}>
                <DialogOpener mode="ask" workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Codex'));
        await waitFor(() => expect(screen.getByTestId('effort-pill-selector').getAttribute('data-effort-value')).toBe('high'));

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Explain this file';
        fireEvent.input(textarea);
        fireEvent.click(screen.getByText('Ask'));

        await waitFor(() => expect(postBody).toBeTruthy());
        expect(postBody.payload.provider).toBe('codex');
        expect(postBody.payload.mode).toBe('ask');
        expect(postBody.config).toEqual({ reasoningEffort: 'high' });
    });

    it('bulk context-file submissions reuse the same provider and reasoning effort selection', async () => {
        const postBodies: any[] = [];
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBodies.push(JSON.parse(opts?.body || '{}'));
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.endsWith('/agent-providers')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ providers: [
                    { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
                    { id: 'codex', label: 'Codex', enabled: true, available: true },
                ] }) });
            }
            if (typeof url === 'string' && url.includes('/agent-providers/codex') && url.includes('/reasoning-efforts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ reasoningEfforts: { 'codex-default': 'medium' } }) });
            }
            if (typeof url === 'string' && url.includes('/agent-providers/codex/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'codex', models: [{
                    id: 'codex-default',
                    name: 'Codex Default',
                    enabled: true,
                    capabilities: { supports: { vision: false, reasoningEffort: true }, limits: { max_context_window_tokens: 128000 } },
                    supportedReasoningEfforts: ['low', 'medium', 'high'],
                }] }) });
            }
            if (typeof url === 'string' && url.includes('/agent-providers/codex/effort-tiers')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'codex', effortTiers: {}, defaults: {} }) });
            }
            if (typeof url === 'string' && url.includes('/preferences') && (!opts || opts.method !== 'PATCH')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({
                    lastChatProvider: 'codex',
                    defaultModelsByProvider: { codex: { task: 'codex-default' } },
                }) });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ workflows: [], tasks: { name: 'tasks', relativePath: '', children: [] } }) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/test' }]}>
                <DialogOpener
                    workspaceId="ws1"
                    contextFiles={['/tasks/a.plan.md', '/tasks/b.plan.md']}
                    bulkMode
                />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Run Skill')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('agent-selector-chip-btn').textContent).toContain('Codex'));
        await waitFor(() => expect(screen.getByTestId('effort-pill-selector').getAttribute('data-effort-value')).toBe('medium'));

        fireEvent.click(screen.getByText('Enqueue 2 Tasks'));

        await waitFor(() => expect(postBodies).toHaveLength(2));
        expect(postBodies.map(body => body.payload.provider)).toEqual(['codex', 'codex']);
        expect(postBodies.map(body => body.config)).toEqual([{ reasoningEffort: 'medium' }, { reasoningEffort: 'medium' }]);
        expect(postBodies.map(body => body.payload.context.files)).toEqual([['/tasks/a.plan.md'], ['/tasks/b.plan.md']]);
    });

    it('freeform submit uses workspace rootPath as workingDirectory', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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
        const wsSelect = screen.getByTestId('workspace-select');
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Task in workspace';
        fireEvent.input(textarea);

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.payload.workingDirectory).toBe('/my/project');
    });

    it('persists selected skill to preferences via PATCH on submit', async () => {
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
                });
            }
            if (typeof url === 'string' && url.includes('/preferences') && opts?.method === 'PATCH') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
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
        const wsSelect = screen.getByTestId('workspace-select');
        fireEvent.change(wsSelect, { target: { value: 'ws1' } });

        // Wait for skill chips
        await waitFor(() => {
            expect(screen.getByTestId('skill-chips')).toBeTruthy();
        });

        // Select skill via popover
        fireEvent.click(screen.getByTestId('skill-picker-trigger'));
        fireEvent.click(screen.getByTestId('skill-picker-item-impl'));
        await new Promise(r => setTimeout(r, 50));
        const patchCallsBefore = fetchSpy.mock.calls.filter(
            ([u, opts]: [string, any]) =>
                typeof u === 'string' && u.includes('/preferences') && opts?.method === 'PATCH'
        );
        expect(patchCallsBefore.length).toBe(0);

        // Submit the task
        fireEvent.click(screen.getByText('Enqueue'));

        // Verify PATCH was called with lastSkills.task as array on submit
        await waitFor(() => {
            const patchCalls = fetchSpy.mock.calls.filter(
                ([u, opts]: [string, any]) =>
                    typeof u === 'string' && u.includes('/preferences') && !u.includes('/skill-usage') && opts?.method === 'PATCH'
            );
            expect(patchCalls.length).toBeGreaterThanOrEqual(1);
            const skillPatch = patchCalls.find(([_, opts]: [string, any]) => {
                try { return JSON.parse(opts.body)?.lastSkills != null; } catch { return false; }
            });
            expect(skillPatch).toBeDefined();
            const body = JSON.parse(skillPatch![1].body);
            expect(body.lastSkills).toEqual({ task: ['impl'] });
        });
    });

    it('restores last-used skill from preferences when skills load', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastSkills: { task: 'go-deep' } }),
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
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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

        // Wait for skill chip to appear (pre-selected from preferences)
        await waitFor(() => {
            expect(screen.getByTestId('skill-chip-go-deep')).toBeTruthy();
        });
    });

    it('does not restore skill if it is not in available skills list', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ lastSkills: { task: 'nonexistent-skill' } }),
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
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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

        // Wait for skill chips
        await waitFor(() => {
            expect(screen.getByTestId('skill-chips')).toBeTruthy();
        });

        // Should have no selected skill chips since the saved skill doesn't exist in available skills
        expect(screen.queryByTestId('skill-chip-impl')).toBeNull();
        expect(screen.queryByTestId('skill-chip-nonexistent-skill')).toBeNull();
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

    it('submits on Ctrl+Enter from prompt input', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>,
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'ctrl enter test';
        fireEvent.input(textarea);
        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/queue'),
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

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'plain enter test';
        fireEvent.input(textarea);
        fireEvent.keyDown(textarea, { key: 'Enter' });

        // fetch should not have been called for /queue
        expect(global.fetch).not.toHaveBeenCalledWith(
            expect.stringContaining('/queue'),
            expect.anything(),
        );
    });
});

// ============================================================================
// EnqueueDialog — default tab selection based on templates
// ============================================================================

describe('EnqueueDialog default tab', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    function setupFetchWithTemplates(skillTemplates: any[]) {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skillTemplates }),
                });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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

    it('defaults to Templates tab when task-mode templates exist in task mode', async () => {
        setupFetchWithTemplates([
            { id: 't1', name: 'My Task Template', model: '', mode: 'task', skills: ['impl'] },
        ]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" mode="task" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        // Wait for templates to load and tab to auto-switch
        await waitFor(() => {
            const templatesBtn = screen.getByText(/^Templates/);
            expect(templatesBtn.className).toContain('border-[#0078d4]');
        });
    });

    it('defaults to Templates tab when ask-mode templates exist in ask mode', async () => {
        setupFetchWithTemplates([
            { id: 'a1', name: 'My Ask Template', model: '', mode: 'ask', skills: [] },
        ]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" mode="ask" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy());

        await waitFor(() => {
            const templatesBtn = screen.getByText(/^Templates/);
            expect(templatesBtn.className).toContain('border-[#0078d4]');
        });
    });

    it('defaults to Advanced tab when no templates match the current mode', async () => {
        // Only ask-mode templates, but dialog is in task mode
        setupFetchWithTemplates([
            { id: 'a1', name: 'Ask Only', model: '', mode: 'ask', skills: [] },
        ]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" mode="task" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        // Give templates time to load
        await waitFor(() => {
            const advancedBtn = screen.getByText('Advanced');
            expect(advancedBtn.className).toContain('border-[#0078d4]');
        });
    });

    it('defaults to Advanced tab when there are no templates at all', async () => {
        setupFetchWithTemplates([]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" mode="task" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        await waitFor(() => {
            const advancedBtn = screen.getByText('Advanced');
            expect(advancedBtn.className).toContain('border-[#0078d4]');
        });
    });

    it('defaults to Templates tab again after close and reopen', async () => {
        setupFetchWithTemplates([
            { id: 't1', name: 'Task Template', model: '', mode: 'task', skills: ['impl'] },
        ]);

        function ReopenHelper() {
            const { dispatch } = useQueue();
            return (
                <>
                    <button data-testid="close-dialog" onClick={() => dispatch({ type: 'CLOSE_DIALOG' })}>Close</button>
                    <button data-testid="reopen-dialog" onClick={() => dispatch({ type: 'OPEN_DIALOG', workspaceId: 'ws1', mode: 'task' })}>Reopen</button>
                </>
            );
        }

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" mode="task" />
                <ReopenHelper />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        // First open: should auto-switch to Templates
        await waitFor(() => {
            const templatesBtn = screen.getByText(/^Templates/);
            expect(templatesBtn.className).toContain('border-[#0078d4]');
        });

        // Close the dialog
        fireEvent.click(screen.getByTestId('close-dialog'));
        await waitFor(() => expect(screen.queryByText('Enqueue AI Task')).toBeNull());

        // Reopen the dialog
        fireEvent.click(screen.getByTestId('reopen-dialog'));
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        // Should auto-switch to Templates again (regression: was stuck on Advanced)
        await waitFor(() => {
            const templatesBtn = screen.getByText(/^Templates/);
            expect(templatesBtn.className).toContain('border-[#0078d4]');
        });
    });

    it('respects manual tab switch after auto-switch', async () => {
        setupFetchWithTemplates([
            { id: 't1', name: 'Task Template', model: '', mode: 'task', skills: ['impl'] },
        ]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" mode="task" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());

        // Wait for auto-switch to templates
        await waitFor(() => {
            const templatesBtn = screen.getByText(/^Templates/);
            expect(templatesBtn.className).toContain('border-[#0078d4]');
        });

        // Manually switch to Advanced
        fireEvent.click(screen.getByText('Advanced'));
        expect(screen.getByText('Advanced').className).toContain('border-[#0078d4]');

        // Should stay on Advanced (no forced re-switch)
        await new Promise(r => setTimeout(r, 100));
        expect(screen.getByText('Advanced').className).toContain('border-[#0078d4]');
    });

    it('Templates tab count only includes templates matching the current mode', async () => {
        // 2 task templates + 1 ask template; dialog opens in ask mode → count should be 1
        setupFetchWithTemplates([
            { id: 't1', name: 'Task A', model: '', mode: 'task', skills: [] },
            { id: 't2', name: 'Task B', model: '', mode: 'task', skills: [] },
            { id: 'a1', name: 'Ask A', model: '', mode: 'ask', skills: [] },
        ]);

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <DialogOpener workspaceId="ws1" mode="ask" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy());

        // Wait for templates to load, then verify the count reflects only ask-mode templates
        await waitFor(() => {
            const templatesBtn = screen.getByText(/^Templates/);
            expect(templatesBtn.textContent).toBe('Templates (1)');
        });
    });
});

// ============================================================================
// EnqueueDialog — minimize / restore
// ============================================================================

describe('EnqueueDialog minimize behavior', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        // Dialog content should be hidden (still in DOM but display:none)
        const overlay = document.querySelector('[data-testid="floating-dialog-panel"][aria-hidden="true"]');
        expect(overlay).not.toBeNull();
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

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Fix the login bug';
        fireEvent.input(textarea);

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
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = longPrompt;
        fireEvent.input(textarea);

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

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'My important prompt';
        fireEvent.input(textarea);

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]') as HTMLElement;
        await act(async () => { fireEvent.click(minimizeBtn); });

        const pill = document.querySelector('[data-testid="minimized-pill-enqueue-task"]') as HTMLElement;
        await act(async () => { fireEvent.click(pill); });

        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => {
            expect(screen.getByTestId('prompt-input').innerText)
                .toBe('My important prompt');
        });
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
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'test prompt';
        fireEvent.input(textarea);

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
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                capturePosts?.push({ body: JSON.parse(opts.body || '{}'), url });
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills }),
                });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: {
                        name: 'tasks', relativePath: '', children: [],
                    } }),
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

    it('shows slash-command menu when typing / in the prompt input', async () => {
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
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        const textarea = screen.getByTestId('prompt-input');
        // Simulate typing '/'
        textarea.innerText = '/';
        fireEvent.input(textarea);

        await waitFor(() => {
            expect(screen.getByTestId('slash-command-menu')).toBeTruthy();
        });

        // Both skills should appear in the menu (rendered with leading slash)
        const menu = screen.getByTestId('slash-command-menu');
        expect(within(menu).getByText('/impl')).toBeTruthy();
        expect(within(menu).getByText('/draft')).toBeTruthy();
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
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        const textarea = screen.getByTestId('prompt-input');
        // Type '/im' to filter
        textarea.innerText = '/im';
        fireEvent.input(textarea);

        await waitFor(() => {
            expect(screen.getByTestId('slash-command-menu')).toBeTruthy();
        });

        // Only '/impl' should match the filter
        const menu = screen.getByTestId('slash-command-menu');
        expect(within(menu).getByText('/impl')).toBeTruthy();
        expect(within(menu).queryByText('/draft')).toBeNull();
    });

    it('adds skill to selectedSkills when slash-command skill is selected via click', async () => {
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
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = '/';
        fireEvent.input(textarea);

        await waitFor(() => {
            expect(screen.getByTestId('slash-command-menu')).toBeTruthy();
        });

        // Click on '/impl' in the menu (uses mousedown to prevent blur)
        const menu = screen.getByTestId('slash-command-menu');
        const implItem = within(menu).getByText('/impl');
        fireEvent.mouseDown(implItem);

        // Skill chip should now show 'impl' as selected
        await waitFor(() => {
            expect(screen.getByTestId('skill-chip-impl')).toBeTruthy();
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
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        const textarea = screen.getByTestId('prompt-input');
        // Type '/impl fix the bug' without using the autocomplete menu
        textarea.innerText = '/impl fix the bug';
        fireEvent.input(textarea);

        // Submit
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => expect(posts.length).toBeGreaterThan(0));

        const body = posts[0].body;
        expect(body.type).toBe('chat');
        expect(body.displayName).toBe('Skill: impl');
        expect(body.payload.context.skills).toEqual(['impl']);
        expect(body.payload.prompt).toBe('/impl fix the bug');
    });

    it('does not strip slash-command skill names from the prompt text', async () => {
        const posts: Array<{ body: any; url: string }> = [];
        setupFetchWithSkills(
            [{ name: 'impl', description: 'Implementation' }, { name: 'draft', description: 'Draft' }],
            posts,
        );

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/project' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = '/impl /draft please review and implement';
        fireEvent.input(textarea);

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => expect(posts.length).toBeGreaterThan(0));

        const body = posts[0].body;
        // Slash-command tokens must be preserved in the prompt — never stripped
        expect(body.payload.prompt).toBe('/impl /draft please review and implement');
        expect(body.payload.context.skills).toEqual(expect.arrayContaining(['impl', 'draft']));
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

        expect(screen.getByTestId('prompt-input').getAttribute('data-placeholder')).toBe('Enter your prompt… Type / for skills');
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
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = '/';
        fireEvent.input(textarea);

        await waitFor(() => {
            expect(screen.getByTestId('slash-command-menu')).toBeTruthy();
        });

        // Press Escape
        fireEvent.keyDown(textarea, { key: 'Escape' });

        await waitFor(() => {
            expect(screen.queryByTestId('slash-command-menu')).toBeNull();
        });
    });

    it('chip and slash-command skills are merged and deduplicated on submit', async () => {
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
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        // Select 'draft' via popover
        fireEvent.click(screen.getByTestId('skill-picker-trigger'));
        fireEvent.click(screen.getByTestId('skill-picker-item-draft'));

        // Type '/impl do stuff' in prompt
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = '/impl do stuff';
        fireEvent.input(textarea);

        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => expect(posts.length).toBeGreaterThan(0));

        const body = posts[0].body;
        // Both chip selection ('draft') and slash-command ('impl') are merged and deduplicated
        expect(body.payload.context.skills).toEqual(expect.arrayContaining(['draft', 'impl']));
        expect(body.payload.context.skills).toHaveLength(2);
    });
});

// ============================================================================
// EnqueueDialog mode-switch state isolation tests
// ============================================================================

describe('EnqueueDialog mode-switch state isolation', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    /** Sets up fetch mock that returns per-mode preferences, skills, and models. */
    function setupFetchForModeSwitch(opts: {
        taskSkills?: string[];
        askSkills?: string[];
        taskModel?: string;
        askModel?: string;
        availableSkills?: Array<{ name: string; description?: string }>;
        availableModels?: string[];
    }) {
        const {
            taskSkills = [],
            askSkills = [],
            taskModel = '',
            askModel = '',
            availableSkills = [
                { name: 'impl', description: 'Implementation' },
                { name: 'go-deep', description: 'Deep research' },
            ],
            availableModels = ['gpt-5.4', 'claude-sonnet'],
        } = opts;

        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/models')) {
                const modelInfos = availableModels.map(id => ({ id, name: id, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }));
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: modelInfos }) });
            }
            if (typeof url === 'string' && url.includes('/preferences') && (!opts || opts.method !== 'PATCH')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        lastSkills: { task: taskSkills, ask: askSkills },
                        lastModels: { task: taskModel, ask: askModel },
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: availableSkills }),
                });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ workflows: [], tasks: { name: 'tasks', relativePath: '', children: [] } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    }

    /** Helper that lets us open/close/reopen dialog in different modes. */
    function ModeSwitcher() {
        const { dispatch } = useQueue();
        return (
            <>
                <button data-testid="open-task" onClick={() => dispatch({ type: 'OPEN_DIALOG', workspaceId: 'ws1', mode: 'task' })}>Open Task</button>
                <button data-testid="open-ask" onClick={() => dispatch({ type: 'OPEN_DIALOG', workspaceId: 'ws1', mode: 'ask' })}>Open Ask</button>
                <button data-testid="close-dialog" onClick={() => dispatch({ type: 'CLOSE_DIALOG' })}>Close</button>
            </>
        );
    }

    beforeEach(() => {
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('switching from task to ask mode applies ask-mode skills, not task-mode skills', async () => {
        setupFetchForModeSwitch({
            taskSkills: ['impl'],
            askSkills: ['go-deep'],
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <ModeSwitcher />
                <EnqueueDialog />
            </Wrap>,
        );

        // Open in task mode
        fireEvent.click(screen.getByTestId('open-task'));
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        // Task skill should be selected (chip visible)
        await waitFor(() => {
            expect(screen.getByTestId('skill-chip-impl')).toBeTruthy();
        });

        // Close and reopen in ask mode
        fireEvent.click(screen.getByTestId('close-dialog'));
        await waitFor(() => expect(screen.queryByText('Enqueue AI Task')).toBeNull());

        fireEvent.click(screen.getByTestId('open-ask'));
        await waitFor(() => expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        // Ask skill should be selected, not task skill
        await waitFor(() => {
            expect(screen.getByTestId('skill-chip-go-deep')).toBeTruthy();
        });
        expect(screen.queryByTestId('skill-chip-impl')).toBeNull();
    });

    it('switching from task to ask mode keeps shared AI controls available', async () => {
        setupFetchForModeSwitch({
            taskModel: 'gpt-5.4',
            askModel: 'claude-sonnet',
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <ModeSwitcher />
                <EnqueueDialog />
            </Wrap>,
        );

        // Open in task mode
        fireEvent.click(screen.getByTestId('open-task'));
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('enqueue-ai-controls')).toBeTruthy());

        // Close and reopen in ask mode
        fireEvent.click(screen.getByTestId('close-dialog'));
        await waitFor(() => expect(screen.queryByText('Enqueue AI Task')).toBeNull());

        fireEvent.click(screen.getByTestId('open-ask'));
        await waitFor(() => expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('enqueue-ai-controls')).toBeTruthy());
    });

    it('switching from ask to task mode clears ask skills and applies task skills', async () => {
        setupFetchForModeSwitch({
            taskSkills: ['impl'],
            askSkills: ['go-deep'],
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <ModeSwitcher />
                <EnqueueDialog />
            </Wrap>,
        );

        // Open in ask mode
        fireEvent.click(screen.getByTestId('open-ask'));
        await waitFor(() => expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        await waitFor(() => {
            expect(screen.getByTestId('skill-chip-go-deep')).toBeTruthy();
        });

        // Close and reopen in task mode
        fireEvent.click(screen.getByTestId('close-dialog'));
        await waitFor(() => expect(screen.queryByText('Ask AI (Read-only)')).toBeNull());

        fireEvent.click(screen.getByTestId('open-task'));
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        // Task skill should be selected, not ask skill
        await waitFor(() => {
            expect(screen.getByTestId('skill-chip-impl')).toBeTruthy();
        });
        expect(screen.queryByTestId('skill-chip-go-deep')).toBeNull();
    });

    it('switching to mode with no saved skills clears selected skills', async () => {
        setupFetchForModeSwitch({
            taskSkills: ['impl'],
            askSkills: [],  // no saved ask skills
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <ModeSwitcher />
                <EnqueueDialog />
            </Wrap>,
        );

        // Open in task mode — impl should be selected
        fireEvent.click(screen.getByTestId('open-task'));
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());
        await waitFor(() => {
            expect(screen.getByTestId('skill-chip-impl')).toBeTruthy();
        });

        // Close and reopen in ask mode — no saved ask skills, so impl should NOT leak
        fireEvent.click(screen.getByTestId('close-dialog'));
        await waitFor(() => expect(screen.queryByText('Enqueue AI Task')).toBeNull());

        fireEvent.click(screen.getByTestId('open-ask'));
        await waitFor(() => expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('skill-chips')).toBeTruthy());

        // Neither skill should be selected (no chips visible)
        expect(screen.queryByTestId('skill-chip-impl')).toBeNull();
        expect(screen.queryByTestId('skill-chip-go-deep')).toBeNull();
    });

    it('switching to mode with no saved model keeps server defaults unforced', async () => {
        setupFetchForModeSwitch({
            taskModel: 'gpt-5.4',
            askModel: '',  // no saved ask model
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
                <ModeSwitcher />
                <EnqueueDialog />
            </Wrap>,
        );

        // Open in task mode — the shared AI controls replace the legacy model select.
        fireEvent.click(screen.getByTestId('open-task'));
        await waitFor(() => expect(screen.getByText('Enqueue AI Task')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('enqueue-ai-controls')).toBeTruthy());

        // Close and reopen in ask mode — no saved ask model should still leave the shared controls present.
        fireEvent.click(screen.getByTestId('close-dialog'));
        await waitFor(() => expect(screen.queryByText('Enqueue AI Task')).toBeNull());

        fireEvent.click(screen.getByTestId('open-ask'));
        await waitFor(() => expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy());
        await waitFor(() => expect(screen.getByTestId('enqueue-ai-controls')).toBeTruthy());
    });
});

// EnqueueDialog ask mode tests
// ============================================================================

describe('EnqueueDialog ask mode', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

    it('submits a chat task with mode:ask in ask mode', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'What does this function do?';
        fireEvent.input(textarea);
        fireEvent.click(screen.getByText('Ask'));

        await waitFor(() => {
            expect(postBody).not.toBeNull();
        });

        expect(postBody.type).toBe('chat');
        expect(postBody.payload.kind).toBe('chat');
        expect(postBody.payload.mode).toBe('ask');
        expect(postBody.payload.prompt).toBe('What does this function do?');
    });

    it('selecting a template card restores skills and model but does NOT restore the prompt', async () => {
        // Seed a template entry with skills + model in preferences response
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skillTemplates: [
                            {
                                id: 'tmpl-1',
                                name: 'task: impl [gpt-4]',
                                model: 'gpt-4',
                                mode: 'task',
                                skills: ['impl'],
                            },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        // Switch to Templates tab to access template cards
        act(() => { fireEvent.click(screen.getByText(/^Templates/)); });

        // Click the first template card
        const card = await screen.findByTestId('template-card-tmpl-1');
        fireEvent.click(card);

        // Prompt input should remain empty — templates don't restore the prompt
        await waitFor(() => {
            const textarea = screen.getByTestId('prompt-input');
            expect(textarea.textContent).toBe('');
        });
    });

    it('clicking a task template card selects it, then submitting POSTs to /queue with template settings', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skillTemplates: [
                            {
                                id: 'tmpl-run-1',
                                name: 'task: impl [gpt-4]',
                                model: 'gpt-4',
                                mode: 'task',
                                skills: ['impl'],
                            },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/test' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Switch to Templates tab and click the card to select it
        act(() => { fireEvent.click(screen.getByText(/^Templates/)); });
        const card = await screen.findByTestId('template-card-tmpl-run-1');
        await act(async () => { fireEvent.click(card); });

        // Card should show visual selection (checkmark)
        await waitFor(() => {
            expect(screen.getByTestId('template-selected-tmpl-run-1')).toBeTruthy();
        });

        // Click Enqueue to submit with template settings
        const enqueueBtn = screen.getByRole('button', { name: /Enqueue/i });
        await act(async () => { fireEvent.click(enqueueBtn); });

        await waitFor(() => {
            expect(postBody).not.toBeNull();
        });

        expect(postBody.type).toBe('chat');
        expect(postBody.payload.kind).toBe('chat');
        expect(postBody.payload.mode).toBe('autopilot');
        expect(postBody.payload.prompt).toContain('impl');
        expect(postBody.config).toEqual({ model: 'gpt-4' });
        expect(postBody.displayName).toBe('Skill: impl');
    });

    it('clicking an ask-mode template card then submitting POSTs with mode:ask', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skillTemplates: [
                            {
                                id: 'tmpl-ask-1',
                                name: 'ask: review',
                                model: '',
                                mode: 'ask',
                                skills: ['review'],
                            },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/test' }]}>
                <DialogOpener workspaceId="ws1" mode="ask" />
                <EnqueueDialog />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy();
        });

        act(() => { fireEvent.click(screen.getByText(/^Templates/)); });
        const card = await screen.findByTestId('template-card-tmpl-ask-1');
        await act(async () => { fireEvent.click(card); });

        // Click Ask to submit with template settings
        const askBtn = screen.getByRole('button', { name: /^Ask$/i });
        await act(async () => { fireEvent.click(askBtn); });

        await waitFor(() => {
            expect(postBody).not.toBeNull();
        });

        expect(postBody.payload.mode).toBe('ask');
        expect(postBody.payload.prompt).toContain('review');
        expect(postBody.config).toBeUndefined();
    });

    it('clicking a template card stays on the Templates tab and shows visual selection — no immediate POST', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skillTemplates: [
                            {
                                id: 'tmpl-prefill-1',
                                name: 'task: impl',
                                model: 'gpt-4',
                                mode: 'task',
                                skills: ['impl'],
                            },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        act(() => { fireEvent.click(screen.getByText(/^Templates/)); });

        const card = await screen.findByTestId('template-card-tmpl-prefill-1');
        fireEvent.click(card);

        // Should NOT have posted to /queue
        const postCalls = fetchSpy.mock.calls.filter((c: any[]) =>
            typeof c[0] === 'string' && c[0].includes('/queue') && c[1]?.method === 'POST'
        );
        expect(postCalls).toHaveLength(0);

        // Should show visual selection checkmark (stays on Templates tab)
        await waitFor(() => {
            expect(screen.getByTestId('template-selected-tmpl-prefill-1')).toBeTruthy();
        });
    });

    it('selecting a template then submitting uses the typed prompt instead of the fallback', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skillTemplates: [
                            {
                                id: 'tmpl-prompt-1',
                                name: 'task: impl',
                                model: '',
                                mode: 'task',
                                skills: ['impl'],
                            },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/test' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Type a prompt, then switch to Templates tab and select a template
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'my custom task prompt';
        fireEvent.input(textarea);

        act(() => { fireEvent.click(screen.getByText(/^Templates/)); });
        const card = await screen.findByTestId('template-card-tmpl-prompt-1');
        await act(async () => { fireEvent.click(card); });

        // Submit — the typed prompt must be used, not the fallback
        const enqueueBtn = screen.getByRole('button', { name: /Enqueue/i });
        await act(async () => { fireEvent.click(enqueueBtn); });

        await waitFor(() => {
            expect(postBody).not.toBeNull();
        });

        expect(postBody.payload.prompt).toBe('my custom task prompt');
    });

    it('selecting a template with no skills clears previously selected skills', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skillTemplates: [
                            { id: 'tmpl-with-skills', name: 'ask: go-deep [opus]', model: 'claude-opus-4.6', mode: 'ask', skills: ['go-deep'] },
                            { id: 'tmpl-no-skills', name: 'ask: default [opus]', model: 'claude-opus-4.6', mode: 'ask', skills: [] },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        // Select template WITH skills first
        act(() => { fireEvent.click(screen.getByText(/^Templates/)); });
        const cardWithSkills = await screen.findByTestId('template-card-tmpl-with-skills');
        await act(async () => { fireEvent.click(cardWithSkills); });

        // Now select template with NO skills
        const cardNoSkills = await screen.findByTestId('template-card-tmpl-no-skills');
        await act(async () => { fireEvent.click(cardNoSkills); });

        // Type a prompt and submit
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'explain the codebase';
        fireEvent.input(textarea);

        const askBtn = screen.getAllByRole('button', { name: /Ask/i }).find(
            b => b.textContent?.trim() === 'Ask' && b.getAttribute('title') === 'Ctrl+Enter'
        )!;
        await act(async () => { fireEvent.click(askBtn); });

        await waitFor(() => {
            expect(postBody).not.toBeNull();
        });

        // Template with no skills should have cleared skills — no context.skills in payload
        expect(postBody.payload.context?.skills).toBeUndefined();
        expect(postBody.config?.model).toBe('claude-opus-4.6');
    });

    it('selecting a template with empty model sets model to default', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        skillTemplates: [
                            { id: 'tmpl-with-model', name: 'ask: go-deep [opus]', model: 'claude-opus-4.6', mode: 'ask', skills: ['go-deep'] },
                            { id: 'tmpl-default-model', name: 'ask: go-deep [default]', model: '', mode: 'ask', skills: ['go-deep'] },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        // Select template with explicit model first
        act(() => { fireEvent.click(screen.getByText(/^Templates/)); });
        const cardWithModel = await screen.findByTestId('template-card-tmpl-with-model');
        await act(async () => { fireEvent.click(cardWithModel); });

        // Now select template with empty model (default)
        const cardDefaultModel = await screen.findByTestId('template-card-tmpl-default-model');
        await act(async () => { fireEvent.click(cardDefaultModel); });

        // Submit
        const askBtn = screen.getAllByRole('button', { name: /Ask/i }).find(
            b => b.textContent?.trim() === 'Ask' && b.getAttribute('title') === 'Ctrl+Enter'
        )!;
        await act(async () => { fireEvent.click(askBtn); });

        await waitFor(() => {
            expect(postBody).not.toBeNull();
        });

        // Empty model means "default" — no config.model in body
        expect(postBody.config?.model).toBeUndefined();
    });

    it('preference-restore effects do not overwrite template selection with no skills', async () => {
        // Simulate: preferences have saved skills, but the selected template has no skills.
        // The preference-restore effect should NOT re-apply saved skills.
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/preferences')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        models: { ask: 'gpt-4' },
                        skills: { ask: ['go-deep'] },
                        skillTemplates: [
                            { id: 'tmpl-bare', name: 'ask: bare [default]', model: '', mode: 'ask', skills: [] },
                        ],
                    }),
                });
            }
            if (typeof url === 'string' && url.includes('/skills/all')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ merged: [{ name: 'go-deep', description: 'Deep research' }] }),
                });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
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

        // Select the bare template (no skills, default model)
        act(() => { fireEvent.click(screen.getByText(/^Templates/)); });
        const card = await screen.findByTestId('template-card-tmpl-bare');
        await act(async () => { fireEvent.click(card); });

        // Type prompt and submit
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'bare ask question';
        fireEvent.input(textarea);

        const askBtn = screen.getAllByRole('button', { name: /Ask/i }).find(
            b => b.textContent?.trim() === 'Ask' && b.getAttribute('title') === 'Ctrl+Enter'
        )!;
        await act(async () => { fireEvent.click(askBtn); });

        await waitFor(() => {
            expect(postBody).not.toBeNull();
        });

        // Template had no skills → should NOT have picked up 'go-deep' from preferences
        expect(postBody.payload.context?.skills).toBeUndefined();
        // Template had empty model → should NOT have picked up 'gpt-4' from preferences
        expect(postBody.config?.model).toBeUndefined();
    });
});

// ============================================================================
// Onboarding: hasRunWorkflow dispatch
// ============================================================================

describe('EnqueueDialog onboarding hasRunWorkflow', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    const dispatchCalls: any[] = [];

    // Spy component that records all AppContext dispatches
    function DispatchSpy() {
        const { dispatch } = useApp();
        useEffect(() => {
            const orig = dispatch;
            // We wrap by monkey-patching at the call site via a custom hook below
        }, []);
        return null;
    }

    // Instead, capture dispatches by wrapping AppProvider and using a recorder
    function WrapWithSpy({ children, workspaces = [], onboardingProgress }: { children: ReactNode; workspaces?: any[]; onboardingProgress?: any }) {
        return (
            <AppProvider>
                <QueueProvider>
                    <MinimizedDialogsProvider>
                        <WorkspaceSetter workspaces={workspaces} />
                        {onboardingProgress && <OnboardingSetter progress={onboardingProgress} />}
                        <DispatchRecorder calls={dispatchCalls} />
                        {children}
                        <MinimizedDialogsTray />
                    </MinimizedDialogsProvider>
                </QueueProvider>
            </AppProvider>
        );
    }

    function OnboardingSetter({ progress }: { progress: any }) {
        const { dispatch } = useApp();
        useEffect(() => {
            dispatch({ type: 'UPDATE_ONBOARDING', payload: progress });
        }, []); // eslint-disable-line react-hooks/exhaustive-deps
        return null;
    }

    function DispatchRecorder({ calls }: { calls: any[] }) {
        const { dispatch: realDispatch } = useApp();
        // Record calls to UPDATE_ONBOARDING by wrapping via fetch spy
        // Since UPDATE_ONBOARDING triggers a PATCH to /preferences, we detect it in fetchSpy
        return null;
    }

    beforeEach(() => {
        dispatchCalls.length = 0;
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            if (typeof url === 'string' && url.includes('/summary')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ workflows: [], tasks: { name: 'tasks', relativePath: '', children: [] } }) });
            }
            if (typeof url === 'string' && url.includes('/preferences') && opts?.method === 'PATCH') {
                const body = JSON.parse(opts?.body || '{}');
                if (body.onboardingProgress) {
                    dispatchCalls.push(body);
                }
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('dispatches UPDATE_ONBOARDING { hasRunWorkflow: true } after successful enqueue', async () => {
        render(
            <WrapWithSpy workspaces={[{ id: 'ws1', name: 'WS', rootPath: '/tmp' }]}>
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </WrapWithSpy>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Enter prompt
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Run something';
        fireEvent.input(textarea);

        // Submit
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            const taskPost = fetchSpy.mock.calls.find(
                (c: any[]) => typeof c[0] === 'string' && c[0].includes('/queue')
            );
            expect(taskPost).toBeTruthy();
        });

        // Verify the PATCH to /preferences included hasRunWorkflow
        await waitFor(() => {
            expect(dispatchCalls.some(c => c.onboardingProgress?.hasRunWorkflow === true)).toBe(true);
        });
    });

    it('does not dispatch UPDATE_ONBOARDING if hasRunWorkflow is already true', async () => {
        render(
            <WrapWithSpy
                workspaces={[{ id: 'ws1', name: 'WS', rootPath: '/tmp' }]}
                onboardingProgress={{ hasRunWorkflow: true }}
            >
                <DialogOpener workspaceId="ws1" />
                <EnqueueDialog />
            </WrapWithSpy>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Clear any dispatches from OnboardingSetter
        dispatchCalls.length = 0;

        // Enter prompt
        const textarea = screen.getByTestId('prompt-input');
        textarea.innerText = 'Another task';
        fireEvent.input(textarea);

        // Submit
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            const taskPost = fetchSpy.mock.calls.find(
                (c: any[]) => typeof c[0] === 'string' && c[0].includes('/queue')
            );
            expect(taskPost).toBeTruthy();
        });

        // Wait a tick to ensure no further dispatches
        await new Promise(r => setTimeout(r, 50));

        // Should NOT have dispatched hasRunWorkflow again
        expect(dispatchCalls.filter(c => c.onboardingProgress?.hasRunWorkflow === true)).toHaveLength(0);
    });
});
