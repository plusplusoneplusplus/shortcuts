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

describe('TaskActions — Generate task with AI button', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the generate button unconditionally', () => {
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
        const btn = screen.getByTestId('generate-with-ai-btn');
        expect(btn).toBeTruthy();
        expect(btn.textContent).toContain('Generate task with AI');
    });

    it('fires the callback on click', () => {
        const mockFn = vi.fn();
        render(
            <Wrap>
                <TaskActions
                    wsId="ws1"
                    openFilePath={null}
                    selectedFilePaths={[]}
                    tasksFolderPath=".vscode/tasks"
                    onClearSelection={vi.fn()}
                    onGenerateWithAI={mockFn}
                />
            </Wrap>
        );
        fireEvent.click(screen.getByTestId('generate-with-ai-btn'));
        expect(mockFn).toHaveBeenCalledOnce();
    });

    it('still renders when onGenerateWithAI is undefined', () => {
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
        const btn = screen.getByTestId('generate-with-ai-btn');
        expect(btn).toBeTruthy();
        // Click should not crash
        fireEvent.click(btn);
    });
});
