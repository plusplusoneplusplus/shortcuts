/**
 * Tests for TaskActions toolbar — Generate task with AI button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TaskProvider } from '../../../src/server/spa/client/react/context/TaskContext';
import { TaskActions } from '../../../src/server/spa/client/react/tasks/TaskActions';

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

describe('TaskActions — toolbar', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('does not render a generate-with-ai button (moved to RepoDetail header)', () => {
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
        expect(screen.queryByTestId('generate-with-ai-btn')).toBeNull();
    });

    it('renders copy path and open in editor when file is open', () => {
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath="some/file.md"
                    selectedFilePaths={[]}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                />
            </Wrap>
        );
        expect(screen.getByText('Copy path')).toBeTruthy();
        expect(screen.getByText('Open in editor')).toBeTruthy();
    });
});
