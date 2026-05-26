/**
 * Render tests for PendingTaskPayload sub-component.
 *
 * PendingTaskInfoPanel is already covered by pending-task-info.test.tsx
 * (metadata, buttons, hourglass, loading, resolve-comments, context files).
 * This file focuses on PendingTaskPayload rendering: image gallery,
 * FilePathValue, task generation context, follow-up message, and mode dispatch.
 *
 * Intentionally not tested (source-level tests dropped):
 * - Export existence checks (e.g. "exports PendingTaskInfoPanel") — TypeScript
 *   compiler verifies these at build time.
 * - Interface shape checks (e.g. "accepts task, onCancel props") — same reason.
 * - Implementation ordering (e.g. "clears payloadImages before guard") —
 *   internal detail, not behavioral.
 * - ChatDetail import checks — covered by build and by
 *   pending-task-info.test.tsx which renders through ChatDetail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { PendingTaskPayload, MetaRow, FilePathValue } from '../../../../src/server/spa/client/react/queue/PendingTaskPayload';

// Mock config for fetchApi (used internally by PendingTaskPayload for images)
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
    getWsPath: () => '/ws',
    getWsUrl: () => 'ws://localhost/ws',
}));

afterEach(cleanup);

// ── Helpers ────────────────────────────────────────────────────────────

function makeTask(overrides?: Partial<any>): any {
    return {
        id: 'task-1',
        type: 'chat',
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt: 'Hello world',
            workingDirectory: '/home/user/project',
        },
        ...overrides,
    };
}

// ── PendingTaskPayload: standard chat ──────────────────────────────────

describe('PendingTaskPayload standard chat', () => {
    it('renders prompt text for standard chat', () => {
        const task = makeTask();

        render(<PendingTaskPayload task={task} />);

        expect(screen.getByText('Hello world')).toBeTruthy();
    });

    it('renders mode when not autopilot', () => {
        const task = makeTask({
            payload: { kind: 'chat', mode: 'ask', prompt: 'question' },
        });

        render(<PendingTaskPayload task={task} />);

        expect(screen.getByText('Mode')).toBeTruthy();
        expect(screen.getByText('ask')).toBeTruthy();
    });

    it('does not render mode row for autopilot (default)', () => {
        const task = makeTask();

        const { container } = render(<PendingTaskPayload task={task} />);

        expect(container.textContent).not.toContain('Mode');
    });

    it('renders skills list', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'do stuff',
                context: { skills: ['refactor', 'test'] },
            },
        });

        render(<PendingTaskPayload task={task} />);

        expect(screen.getByText('Skills')).toBeTruthy();
        expect(screen.getByText('refactor, test')).toBeTruthy();
    });

    it('renders context files with FilePathLink', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'review',
                context: { files: ['/home/user/project/src/auth.ts'] },
            },
        });

        render(<PendingTaskPayload task={task} />);

        expect(screen.getByText('File')).toBeTruthy();
        const pathLink = document.querySelector('.file-path-link');
        expect(pathLink).toBeTruthy();
        expect(pathLink!.getAttribute('data-full-path')).toBe('/home/user/project/src/auth.ts');
    });
});

// ── PendingTaskPayload: follow-up message ──────────────────────────────

describe('PendingTaskPayload follow-up message', () => {
    it('renders follow-up heading and parent process ID', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Continue the work',
                processId: 'proc-abc',
            },
        });

        render(<PendingTaskPayload task={task} />);

        expect(screen.getByText('Follow-up Message')).toBeTruthy();
        expect(screen.getByText('Parent Process')).toBeTruthy();
        expect(screen.getByText('proc-abc')).toBeTruthy();
        expect(screen.getByText('Continue the work')).toBeTruthy();
    });
});

// ── PendingTaskPayload: task generation ────────────────────────────────

describe('PendingTaskPayload task generation', () => {
    it('renders task generation details with target folder', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Generate tasks',
                model: 'gpt-4',
                context: {
                    taskGeneration: {
                        name: 'my-feature',
                        targetFolder: '/home/user/project/tasks',
                        depth: 'deep',
                        mode: 'full',
                    },
                },
            },
        });

        render(<PendingTaskPayload task={task} />);

        expect(screen.getByText('Task Generation Details')).toBeTruthy();
        expect(screen.getByText('Task Name')).toBeTruthy();
        expect(screen.getByText('my-feature')).toBeTruthy();
        expect(screen.getByText('Target Folder')).toBeTruthy();
        const pathLink = document.querySelector('.file-path-link');
        expect(pathLink).toBeTruthy();
        expect(pathLink!.getAttribute('data-full-path')).toBe('/home/user/project/tasks');
        expect(screen.getByText('Depth')).toBeTruthy();
        expect(screen.getByText('deep')).toBeTruthy();
    });
});

// ── PendingTaskPayload: resolve comments ───────────────────────────────

describe('PendingTaskPayload resolve comments', () => {
    it('renders resolve comments with document path and comment count', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Fix comments',
                context: {
                    resolveComments: {
                        filePath: 'docs/readme.md',
                        commentIds: ['c-1', 'c-2', 'c-3'],
                    },
                },
            },
        });

        render(<PendingTaskPayload task={task} />);

        expect(screen.getByText('Resolve Comments Details')).toBeTruthy();
        expect(screen.getByText('Document')).toBeTruthy();
        const pathLink = document.querySelector('.file-path-link');
        expect(pathLink).toBeTruthy();
        expect(pathLink!.getAttribute('data-full-path')).toBe('docs/readme.md');
        expect(screen.getByText('Comments')).toBeTruthy();
        expect(screen.getByText('3 (c-1, c-2, c-3)')).toBeTruthy();
    });

    it('shows prompt directly without collapsing (full transparency)', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Resolve the review comments and update the code accordingly.',
                context: {
                    resolveComments: {
                        filePath: 'src/utils.ts',
                        commentIds: ['c-10'],
                    },
                },
            },
        });

        const { container } = render(<PendingTaskPayload task={task} />);

        // Prompt text is directly visible (not inside a <details> wrapper)
        expect(screen.getByText('Full Prompt')).toBeTruthy();
        expect(screen.getByText('Resolve the review comments and update the code accordingly.')).toBeTruthy();
        // The prompt should NOT be wrapped in a collapsed <details> element
        const details = container.querySelector('details');
        // If details exist they must be for document snapshot, not the main prompt
        if (details) {
            expect(details.querySelector('pre')?.textContent).not.toBe(
                'Resolve the review comments and update the code accordingly.',
            );
        }
    });

    it('shows documentUri when filePath is absent', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Fix it',
                context: {
                    resolveComments: {
                        documentUri: 'vscode://notes/my-note.md',
                        commentIds: ['c-5'],
                    },
                },
            },
        });

        render(<PendingTaskPayload task={task} />);

        expect(screen.getByText('Document')).toBeTruthy();
        expect(screen.getByText('vscode://notes/my-note.md')).toBeTruthy();
    });

    it('renders Document Snapshot section (collapsed) when documentContent is present', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Address review',
                context: {
                    resolveComments: {
                        filePath: 'docs/guide.md',
                        commentIds: ['c-7'],
                        documentContent: '# Guide\n\nSome content here.',
                    },
                },
            },
        });

        const { container } = render(<PendingTaskPayload task={task} />);

        // Document Snapshot should be inside a <details> (collapsed by default)
        const details = container.querySelector('details');
        expect(details).toBeTruthy();
        const summary = details?.querySelector('summary');
        expect(summary?.textContent).toBe('Document Snapshot');
        expect(details?.querySelector('pre')?.textContent).toBe('# Guide\n\nSome content here.');
    });

    it('does not render Document Snapshot section when documentContent is absent', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Fix it',
                context: {
                    resolveComments: {
                        filePath: 'src/main.ts',
                        commentIds: ['c-9'],
                    },
                },
            },
        });

        const { container } = render(<PendingTaskPayload task={task} />);

        expect(container.querySelector('details')).toBeNull();
    });
});

// ── PendingTaskPayload: image gallery ──────────────────────────────────

describe('PendingTaskPayload image gallery', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders ImageGallery when payload has inline images', () => {
        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Look at this',
                images: ['data:image/png;base64,abc123'],
            },
        });

        render(<PendingTaskPayload task={task} />);

        const gallery = document.querySelector('.flex.flex-wrap.gap-2');
        expect(gallery).toBeTruthy();
    });

    it('shows loading skeleton when fetching images', () => {
        fetchMock.mockImplementation(() => new Promise(() => {})); // Never resolves

        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'See images',
                hasImages: true,
                imagesCount: 3,
            },
        });

        render(<PendingTaskPayload task={task} />);

        const loading = document.querySelector('[data-testid="image-gallery-loading"]');
        expect(loading).toBeTruthy();
    });

    it('renders images loaded for payloads with hasImages', async () => {
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ images: ['data:image/png;base64,img1'] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );

        const task = makeTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Check images',
                hasImages: true,
            },
        });

        render(<PendingTaskPayload task={task} />);

        await waitFor(() => {
            const gallery = screen.getByTestId('image-gallery');
            expect(gallery).toBeTruthy();
            expect(gallery.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,img1');
        });
    });
});

// ── PendingTaskPayload: non-chat payload ───────────────────────────────

describe('PendingTaskPayload non-chat payload', () => {
    it('renders raw JSON for non-chat task types', () => {
        const task = {
            id: 'task-2',
            type: 'run-workflow',
            payload: { workflow: 'deploy.yaml', params: { env: 'prod' } },
        };

        render(<PendingTaskPayload task={task} />);

        expect(screen.getByText('Payload')).toBeTruthy();
        expect(screen.getByText(/"workflow": "deploy.yaml"/)).toBeTruthy();
    });
});
