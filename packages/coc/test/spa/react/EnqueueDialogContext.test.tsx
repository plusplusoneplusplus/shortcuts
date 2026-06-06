/**
 * Tests for EnqueueDialog document-context mode — context file chips,
 * context files in POST payload, bulk mode submission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../src/server/spa/client/react/contexts/MinimizedDialogsContext';
import { EnqueueDialog } from '../../../src/server/spa/client/react/queue/EnqueueDialog';
import type { SessionContextAttachmentDragPayload } from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { _resetRuntimeConfig } from '../../../src/server/spa/client/react/utils/config';
import { mockViewport } from '../../spa/helpers/viewport-mock';

if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

const MOCK_WORKSPACES = [{ id: 'ws-1', name: 'my-repo', rootPath: '/home/user/my-repo' }];

function Wrap({ children, workspaces = MOCK_WORKSPACES }: { children: ReactNode; workspaces?: any[] }) {
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

interface DialogOpenerProps {
    contextFiles?: string[];
    contextTaskName?: string;
    bulkMode?: boolean;
    workspaceId?: string;
    mode?: 'task' | 'ask' | 'resolve';
    attachedContext?: SessionContextAttachmentDragPayload[];
}

function DialogOpener({
    contextFiles,
    contextTaskName,
    bulkMode,
    workspaceId = 'ws-1',
    mode,
    attachedContext,
}: DialogOpenerProps) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({
            type: 'OPEN_DIALOG',
            workspaceId,
            contextFiles,
            contextTaskName,
            bulkMode,
            mode,
            attachedContext,
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

let mockFetch: ReturnType<typeof vi.fn>;
let cleanup: (() => void) | undefined;

beforeEach(() => {
    _resetRuntimeConfig();
    (window as any).__DASHBOARD_CONFIG__ = {
        apiBasePath: '/api',
        wsPath: '/ws',
        sessionContextAttachmentsEnabled: true,
    };
    cleanup = mockViewport({ width: 1024, height: 768 });
    mockFetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/models')) {
            return Promise.resolve({
                ok: true,
                json: async () => [{ id: 'gpt-4', enabled: true }, { id: 'claude-3', enabled: true }],
            });
        }
        if (typeof url === 'string' && url.includes('/skills/all')) {
            return Promise.resolve({
                ok: true,
                json: async () => ({ merged: [{ name: 'impl', description: 'Implement code' }, { name: 'test', description: 'Write tests' }] }),
            });
        }
        if (typeof url === 'string' && url.includes('/summary')) {
            return Promise.resolve({ ok: true, json: async () => ({ tasks: { name: 'root', relativePath: '', children: [] } }) });
        }
        if (typeof url === 'string' && url.includes('/queue')) {
            return Promise.resolve({
                ok: true,
                json: async () => ({ task: { id: 'task-1' } }),
            });
        }
        if (typeof url === 'string' && url.includes('/preferences')) {
            if (url.includes('skill-usage')) {
                return Promise.resolve({ ok: true, json: async () => ({}) });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).__DASHBOARD_CONFIG__;
    _resetRuntimeConfig();
    cleanup?.();
});

describe('EnqueueDialog — document context mode', () => {
    it('shows context file chips when contextFiles are provided', async () => {
        render(
            <Wrap>
                <DialogOpener
                    contextFiles={['/home/user/my-repo/tasks/feature.plan.md']}
                    contextTaskName="feature"
                />
                <EnqueueDialog />
            </Wrap>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('context-files-section')).toBeTruthy();
        });

        const chip = screen.getByTestId('context-file-chip');
        expect(chip.textContent).toContain('feature.plan.md');
    });

    it('shows "Run Skill" as dialog title when context files are present', async () => {
        render(
            <Wrap>
                <DialogOpener
                    contextFiles={['/home/user/my-repo/tasks/feature.plan.md']}
                    contextTaskName="feature"
                />
                <EnqueueDialog />
            </Wrap>,
        );

        await waitFor(() => {
            expect(screen.getByText('Run Skill')).toBeTruthy();
        });
    });

    it('removes a context file chip when ✕ is clicked', async () => {
        render(
            <Wrap>
                <DialogOpener
                    contextFiles={[
                        '/home/user/my-repo/tasks/a.md',
                        '/home/user/my-repo/tasks/b.md',
                    ]}
                    contextTaskName="feature"
                />
                <EnqueueDialog />
            </Wrap>,
        );

        await waitFor(() => {
            expect(screen.getAllByTestId('context-file-chip')).toHaveLength(2);
        });

        const removeButtons = screen.getAllByLabelText(/^Remove /);
        await act(async () => {
            fireEvent.click(removeButtons[0]);
        });

        expect(screen.getAllByTestId('context-file-chip')).toHaveLength(1);
    });

    it('includes context.files in POST payload on submit', async () => {
        render(
            <Wrap>
                <DialogOpener
                    contextFiles={['/home/user/my-repo/tasks/feature.plan.md']}
                    contextTaskName="feature"
                />
                <EnqueueDialog />
            </Wrap>,
        );

        // Switch to Advanced tab
        await waitFor(() => {
            expect(screen.getByText('Advanced')).toBeTruthy();
        });
        await act(async () => { fireEvent.click(screen.getByText('Advanced')); });

        // Open skill picker and select a skill
        await waitFor(() => {
            expect(screen.getByTestId('skill-picker-trigger')).toBeTruthy();
        });
        await act(async () => { fireEvent.click(screen.getByTestId('skill-picker-trigger')); });
        await waitFor(() => {
            expect(screen.getByTestId('skill-picker-item-impl')).toBeTruthy();
        });
        await act(async () => { fireEvent.click(screen.getByTestId('skill-picker-item-impl')); });

        // Submit
        const submitBtn = screen.getByText('Enqueue');
        await act(async () => { fireEvent.click(submitBtn); });

        await waitFor(() => {
            const postCall = mockFetch.mock.calls.find(
                (c: any) => typeof c[0] === 'string' && c[0].includes('/queue') && c[1]?.method === 'POST',
            );
            expect(postCall).toBeTruthy();
            const body = JSON.parse(postCall![1].body);
            expect(body.payload.context.files).toEqual(['/home/user/my-repo/tasks/feature.plan.md']);
            expect(body.payload.context.skills).toEqual(['impl']);
            expect(body.displayName).toContain('Follow:');
            expect(body.displayName).toContain('feature');
        });
    });

    it('renders seeded context as a removable chip and submits pointer-only context', async () => {
        render(
            <Wrap>
                <DialogOpener
                    workspaceId="ws-1"
                    mode="ask"
                    attachedContext={[{
                        kind: 'coc.work-item-context',
                        version: 1,
                        sourceWorkspaceId: 'ws-1',
                        workItemId: 'wi-123',
                        workItemNumber: 123,
                        label: 'Work Item #123',
                        title: 'Investigate drag context',
                        status: 'open',
                    }]}
                />
                <EnqueueDialog />
            </Wrap>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('attached-work-item-context-chip')).toBeTruthy();
        });
        expect(screen.getByText('Work Item #123')).toBeTruthy();

        await act(async () => { fireEvent.click(screen.getByText('Ask')); });

        await waitFor(() => {
            const postCall = mockFetch.mock.calls.find(
                (c: any) => typeof c[0] === 'string' && c[0].includes('/queue') && c[1]?.method === 'POST',
            );
            expect(postCall).toBeTruthy();
            const body = JSON.parse(postCall![1].body);
            expect(body.payload.mode).toBe('ask');
            expect(body.payload.prompt).toContain('<attached_pointer_context version="1">');
            expect(body.payload.prompt).toContain('kind="work-item"');
            expect(body.payload.prompt).toContain('work_item_id="wi-123"');
            expect(body.payload.prompt).toContain('<title>Investigate drag context</title>');
            expect(body.payload.prompt).not.toContain('full diff');
        });
    });

    it('shows bulk mode banner and submits one task per file', async () => {
        const files = [
            '/home/user/my-repo/tasks/a.md',
            '/home/user/my-repo/tasks/b.md',
            '/home/user/my-repo/tasks/c.md',
        ];
        render(
            <Wrap>
                <DialogOpener
                    contextFiles={files}
                    contextTaskName="project"
                    bulkMode={true}
                />
                <EnqueueDialog />
            </Wrap>,
        );

        // Wait for bulk banner
        await waitFor(() => {
            expect(screen.getByTestId('bulk-mode-banner')).toBeTruthy();
        });
        expect(screen.getByTestId('bulk-mode-banner').textContent).toContain('3 files');

        // Switch to Advanced tab, open skill picker, select a skill
        await waitFor(() => { expect(screen.getByText('Advanced')).toBeTruthy(); });
        await act(async () => { fireEvent.click(screen.getByText('Advanced')); });
        await waitFor(() => { expect(screen.getByTestId('skill-picker-trigger')).toBeTruthy(); });
        await act(async () => { fireEvent.click(screen.getByTestId('skill-picker-trigger')); });
        await waitFor(() => { expect(screen.getByTestId('skill-picker-item-impl')).toBeTruthy(); });
        await act(async () => { fireEvent.click(screen.getByTestId('skill-picker-item-impl')); });

        // Submit
        const submitBtn = screen.getByText('Enqueue 3 Tasks');
        await act(async () => { fireEvent.click(submitBtn); });

        await waitFor(() => {
            const postCalls = mockFetch.mock.calls.filter(
                (c: any) => typeof c[0] === 'string' && c[0].includes('/queue') && c[1]?.method === 'POST',
            );
            expect(postCalls).toHaveLength(3);

            // Verify each call has the correct file
            for (let i = 0; i < 3; i++) {
                const body = JSON.parse(postCalls[i][1].body);
                expect(body.payload.context.files).toEqual([files[i]]);
                expect(body.payload.context.skills).toEqual(['impl']);
            }
        });
    });

    it('pre-fills workspace from context', async () => {
        render(
            <Wrap>
                <DialogOpener
                    contextFiles={['/home/user/my-repo/tasks/feature.plan.md']}
                    contextTaskName="feature"
                    workspaceId="ws-1"
                />
                <EnqueueDialog />
            </Wrap>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('context-files-section')).toBeTruthy();
        });

        // The workspace should be pre-selected (verified by skills loading for ws-1)
        await waitFor(() => {
            const skillsFetch = mockFetch.mock.calls.find(
                (c: any) => typeof c[0] === 'string' && c[0].includes('/workspaces/ws-1/skills/all'),
            );
            expect(skillsFetch).toBeTruthy();
        });
    });

    it('does not show bulk banner for single-file context', async () => {
        render(
            <Wrap>
                <DialogOpener
                    contextFiles={['/home/user/my-repo/tasks/feature.plan.md']}
                    contextTaskName="feature"
                    bulkMode={false}
                />
                <EnqueueDialog />
            </Wrap>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('context-files-section')).toBeTruthy();
        });

        expect(screen.queryByTestId('bulk-mode-banner')).toBeNull();
    });
});
