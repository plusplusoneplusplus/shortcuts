/**
 * Extended tests for TaskActions — context-dependent buttons and interactions.
 * The existing TaskActions.test.tsx covers the "Generate task with AI" button;
 * this file covers the remaining interactive elements that depend on context state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TaskProvider, useTaskContext } from '../../../src/server/spa/client/react/context/TaskContext';
import { TaskActions } from '../../../src/server/spa/client/react/tasks/TaskActions';

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
}));

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    <TaskProvider>
                        {children}
                    </TaskProvider>
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

/** Helper to read TaskContext showContextFiles state. */
function ShowContextFilesReader() {
    const { state } = useTaskContext();
    return <div data-testid="show-context-files">{state.showContextFiles ? 'true' : 'false'}</div>;
}

/** Helper to read QueueContext showDialog state. */
function ShowDialogReader() {
    const { state } = useQueue();
    return <div data-testid="show-dialog">{state.showDialog ? 'true' : 'false'}</div>;
}

describe('TaskActions — conditional buttons', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows "Open in editor" and "Copy path" when openFilePath is set', () => {
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath="feature1/task.md"
                    selectedFilePaths={[]}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
            </Wrap>
        );
        expect(screen.getByText('Open in editor')).toBeTruthy();
        expect(screen.getByText('Copy path')).toBeTruthy();
    });

    it('hides "Open in editor" and "Copy path" when openFilePath is null', () => {
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath={null}
                    selectedFilePaths={[]}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
            </Wrap>
        );
        expect(screen.queryByText('Open in editor')).toBeNull();
        expect(screen.queryByText('Copy path')).toBeNull();
    });

    it('"Open in editor" calls fetch with correct endpoint and payload', async () => {
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath="feature1/task.md"
                    selectedFilePaths={[]}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
            </Wrap>
        );
        fireEvent.click(screen.getByText('Open in editor'));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/workspaces/ws1/open-file',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ path: 'feature1/task.md' }),
                }),
            );
        });
    });

    it('"Copy path" calls navigator.clipboard.writeText with the path', () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath="feature1/task.md"
                    selectedFilePaths={[]}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
            </Wrap>
        );
        fireEvent.click(screen.getByText('Copy path'));

        expect(writeText).toHaveBeenCalledWith('feature1/task.md');
    });

    it('"Queue all" button appears when non-context files are selected', () => {
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath={null}
                    selectedFilePaths={['feature1/task.md']}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
            </Wrap>
        );
        expect(screen.getByTestId('queue-all-btn')).toBeTruthy();
        expect(screen.getByText('Queue all')).toBeTruthy();
    });

    it('"Queue all" button is hidden when no files are selected', () => {
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath={null}
                    selectedFilePaths={[]}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
            </Wrap>
        );
        expect(screen.queryByTestId('queue-all-btn')).toBeNull();
    });

    it('"Queue all" click dispatches OPEN_DIALOG to QueueContext', () => {
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath={null}
                    selectedFilePaths={['feature1/task.md']}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
                <ShowDialogReader />
            </Wrap>
        );
        expect(screen.getByTestId('show-dialog').textContent).toBe('false');

        fireEvent.click(screen.getByTestId('queue-all-btn'));

        expect(screen.getByTestId('show-dialog').textContent).toBe('true');
    });

    it('"Context files" checkbox toggles showContextFiles in TaskContext', () => {
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath={null}
                    selectedFilePaths={[]}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
                <ShowContextFilesReader />
            </Wrap>
        );
        // Initial state: showContextFiles is true
        expect(screen.getByTestId('show-context-files').textContent).toBe('true');

        const checkbox = screen.getByRole('checkbox');
        fireEvent.click(checkbox);

        expect(screen.getByTestId('show-context-files').textContent).toBe('false');
    });

    it('"Clear" button calls onClearSelection callback', () => {
        const onClearSelection = vi.fn();
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath={null}
                    selectedFilePaths={['feature1/task.md']}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={onClearSelection}
                />
            </Wrap>
        );
        fireEvent.click(screen.getByText('Clear'));
        expect(onClearSelection).toHaveBeenCalledOnce();
    });

    it('n-count badge shows correct number of selected non-context files', () => {
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath={null}
                    selectedFilePaths={['feature1/task.md', 'feature2/impl.md', 'README.md']}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
            </Wrap>
        );
        // README.md is a context file, so only 2 non-context files
        expect(screen.getByText('2 selected')).toBeTruthy();
    });
});
