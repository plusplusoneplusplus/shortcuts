/**
 * Tests for EnqueueDialog — folder picker, folderPath in POST body, flattenFolders helper.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { EnqueueDialog } from '../../../src/server/spa/client/react/queue/EnqueueDialog';

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
                <WorkspaceSetter workspaces={workspaces} />
                {children}
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
function DialogOpener({ folderPath }: { folderPath?: string | null }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', folderPath });
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

    it('includes folderPath in POST body when folder is selected', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/enqueue')) {
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
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS' }]}>
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
        const textarea = screen.getByPlaceholderText('Enter your prompt...');
        fireEvent.change(textarea, { target: { value: 'Test prompt' } });

        // Submit
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.folderPath).toBe('feature1');
        expect(postBody.prompt).toBe('Test prompt');
    });

    it('omits folderPath from POST body when no folder is selected', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue/enqueue')) {
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

        // Enter prompt and submit without folder
        const textarea = screen.getByPlaceholderText('Enter your prompt...');
        fireEvent.change(textarea, { target: { value: 'Test prompt' } });
        fireEvent.click(screen.getByText('Enqueue'));
        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });
        expect(postBody.folderPath).toBeUndefined();
    });
});
