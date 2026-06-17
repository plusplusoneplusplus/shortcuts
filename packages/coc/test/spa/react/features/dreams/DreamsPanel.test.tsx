import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DreamCard } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    isDreamsEnabled: vi.fn(),
    getRepo: vi.fn(),
    patchRepo: vi.fn(),
    listCards: vi.fn(),
    runNow: vi.fn(),
    approve: vi.fn(),
    dismiss: vi.fn(),
    convert: vi.fn(),
    markSuperseded: vi.fn(),
    queueEnqueue: vi.fn(),
    saveNoteContent: vi.fn(),
    createMemoryFact: vi.fn(),
    createWorkItem: vi.fn(),
    getWorkItem: vi.fn(),
    updateWorkItem: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isDreamsEnabled: mocks.isDreamsEnabled,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getRepo: mocks.getRepo,
            patchRepo: mocks.patchRepo,
        },
        dreams: {
            listCards: mocks.listCards,
            runNow: mocks.runNow,
            approve: mocks.approve,
            dismiss: mocks.dismiss,
            convert: mocks.convert,
            markSuperseded: mocks.markSuperseded,
        },
        queue: {
            enqueue: mocks.queueEnqueue,
        },
        notes: {
            saveContent: mocks.saveNoteContent,
        },
        memoryV2: {
            createFact: mocks.createMemoryFact,
        },
        workItems: {
            createForOrigin: mocks.createWorkItem,
            getForOrigin: mocks.getWorkItem,
            updateForOrigin: mocks.updateWorkItem,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

import { DreamsPanel } from '../../../../../src/server/spa/client/react/features/dreams/DreamsPanel';

const sampleCard: DreamCard = {
    id: 'dream-1',
    workspaceId: 'ws-1',
    runId: 'dream-run-1',
    category: 'product-improvement',
    status: 'visible',
    sourceRanges: [{ processId: 'queue_task-1', startTurnIndex: 1, endTurnIndex: 4 }],
    observedPattern: 'The user repeatedly asked for manual status checks during long-running coding loops.',
    whyItMatters: 'Manual polling interrupts the user and hides an opportunity for better automation.',
    recommendation: 'Add a dashboard reminder that suggests using loops for repeated status checks.',
    expectedImpact: 'Reduces repetitive user prompts during autonomous coding sessions.',
    confidence: 0.92,
    dedupFingerprint: 'dream:product-improvement:abc123',
    notAlreadyCoveredRationale: 'No active work item or prior dream covers this reminder.',
    criticRationale: 'Specific and backed by multiple completed conversations.',
    createdAt: '2026-06-10T08:00:00.000Z',
    updatedAt: '2026-06-10T08:01:00.000Z',
    visibleAt: '2026-06-10T08:01:00.000Z',
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDreamsEnabled.mockReturnValue(true);
    mocks.getRepo.mockResolvedValue({ dreams: { enabled: true } });
    mocks.patchRepo.mockResolvedValue({ dreams: { enabled: true } });
    mocks.listCards.mockResolvedValue([sampleCard]);
    mocks.runNow.mockResolvedValue({
        task: {
            id: 'dream-task-2',
            type: 'dream-run',
            status: 'queued',
            displayName: 'Dream Run: Manual',
            payload: { kind: 'dream-run', workspaceId: 'ws-1', trigger: 'manual' },
        },
    });
    mocks.approve.mockResolvedValue({ ...sampleCard, status: 'approved', approvedAt: '2026-06-10T08:03:00.000Z' });
    mocks.dismiss.mockResolvedValue({ ...sampleCard, status: 'dismissed', dismissedAt: '2026-06-10T08:03:00.000Z' });
    mocks.convert.mockResolvedValue({
        ...sampleCard,
        status: 'converted',
        convertedAt: '2026-06-10T08:03:00.000Z',
        conversion: {
            artifactType: 'work-item',
            artifactId: 'WI-123',
            createdAt: '2026-06-10T08:03:00.000Z',
        },
    });
    mocks.queueEnqueue.mockResolvedValue({ task: { id: 'task-123' } });
    mocks.saveNoteContent.mockResolvedValue({ path: 'Dreams/dream-1.md', updated: true, mtime: 1 });
    mocks.createMemoryFact.mockResolvedValue({
        id: 'memory-123',
        scope: 'workspace',
        workspaceId: 'ws-1',
        content: sampleCard.recommendation,
        importance: 0.9,
        confidence: 1,
        status: 'active',
        tags: ['dream'],
        source: 'explicit',
        createdAt: '2026-06-10T08:03:00.000Z',
        updatedAt: '2026-06-10T08:03:00.000Z',
        recalledCount: 0,
    });
    mocks.createWorkItem.mockResolvedValue({
        id: 'WI-456',
        repoId: 'ws-1',
        title: sampleCard.recommendation,
        description: sampleCard.observedPattern,
        status: 'created',
        type: 'work-item',
        createdAt: '2026-06-10T08:03:00.000Z',
        updatedAt: '2026-06-10T08:03:00.000Z',
    });
    mocks.getWorkItem.mockResolvedValue({
        id: 'WI-123',
        repoId: 'ws-1',
        title: 'Existing product work',
        description: 'Existing description',
        status: 'created',
        type: 'work-item',
        tags: ['existing'],
        createdAt: '2026-06-10T08:03:00.000Z',
        updatedAt: '2026-06-10T08:03:00.000Z',
    });
    mocks.updateWorkItem.mockResolvedValue({
        id: 'WI-123',
        repoId: 'ws-1',
        title: 'Existing product work',
        description: 'Updated description',
        status: 'created',
        type: 'work-item',
        tags: ['existing', 'dream'],
        createdAt: '2026-06-10T08:03:00.000Z',
        updatedAt: '2026-06-10T08:04:00.000Z',
    });
});

describe('DreamsPanel', () => {
    it('shows the disabled-by-flag state without calling Dreams routes', () => {
        mocks.isDreamsEnabled.mockReturnValue(false);

        render(<DreamsPanel workspaceId="ws-1" originId="gh_example_repo" />);

        expect(screen.getByTestId('dreams-disabled-by-flag')).toBeTruthy();
        expect(mocks.getRepo).not.toHaveBeenCalled();
        expect(mocks.listCards).not.toHaveBeenCalled();
    });

    it('requires a workspace opt-in before listing cards', async () => {
        mocks.getRepo.mockResolvedValue({ dreams: { enabled: false } });
        mocks.listCards.mockResolvedValue([]);

        render(<DreamsPanel workspaceId="ws-1" originId="gh_example_repo" />);

        await screen.findByTestId('dreams-workspace-disabled');
        expect(mocks.listCards).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('dreams-enable-workspace'));

        await waitFor(() => expect(mocks.patchRepo).toHaveBeenCalledWith('ws-1', { dreams: { enabled: true } }));
        await waitFor(() => expect(mocks.listCards).toHaveBeenCalledWith('ws-1', { statuses: ['visible'] }));
    });

    it('renders visible dream cards with source links and safe lifecycle actions', async () => {
        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dream-card-dream-1');
        expect(screen.getByText('Product')).toBeTruthy();
        expect(screen.getByText('92% confidence')).toBeTruthy();
        expect(screen.getByText(sampleCard.recommendation)).toBeTruthy();
        expect(screen.getByTestId('dream-source-link').getAttribute('href')).toBe('#repos/ws-1/activity/queue_task-1');

        mocks.listCards.mockResolvedValueOnce([]);
        fireEvent.click(screen.getByText('Approve'));

        await waitFor(() => expect(mocks.approve).toHaveBeenCalledWith('ws-1', 'dream-1'));
    });

    it('enqueues a manual dream pass and shows the queued task summary', async () => {
        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dream-card-dream-1');
        fireEvent.click(screen.getByTestId('dreams-run-now'));

        await waitFor(() => expect(mocks.runNow).toHaveBeenCalledWith('ws-1'));
        expect(await screen.findByTestId('dreams-run-summary')).toBeTruthy();
        expect(screen.getByText('Dream Run: Manual')).toBeTruthy();
        expect(screen.getByText('Open task').getAttribute('href')).toBe('#process/queue_dream-task-2');
    });

    it('records conversion links without creating external artifacts', async () => {
        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dream-card-dream-1');
        fireEvent.click(screen.getByTestId('dream-convert-dream-1'));

        fireEvent.change(screen.getByTestId('dream-convert-artifact-id'), { target: { value: 'WI-123' } });
        fireEvent.click(screen.getByTestId('dream-convert-submit'));

        await waitFor(() => expect(mocks.convert).toHaveBeenCalledWith('ws-1', 'dream-1', {
            artifactType: 'work-item',
            artifactId: 'WI-123',
        }));
    });

    it('queues a skill-hardening task from an approved skill dream and records conversion', async () => {
        const approvedSkillCard: DreamCard = {
            ...sampleCard,
            id: 'dream-skill',
            category: 'skill-or-prompt-improvement',
            status: 'approved',
            approvedAt: '2026-06-10T08:03:00.000Z',
        };
        mocks.listCards.mockResolvedValue([approvedSkillCard]);

        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dream-card-dream-skill');
        fireEvent.click(screen.getByTestId('dream-next-action-dream-skill'));
        expect(mocks.queueEnqueue).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('dream-next-action-submit'));

        await waitFor(() => expect(mocks.queueEnqueue).toHaveBeenCalledWith(expect.objectContaining({
            type: 'chat',
            priority: 'normal',
            repoId: 'ws-1',
            payload: expect.objectContaining({
                kind: 'chat',
                mode: 'ask',
                workspaceId: 'ws-1',
                context: expect.objectContaining({
                    skills: ['skill-hardening'],
                    dreamCardId: 'dream-skill',
                }),
            }),
        })));
        await waitFor(() => expect(mocks.convert).toHaveBeenCalledWith('ws-1', 'dream-skill', {
            artifactType: 'skill-hardening-task',
            artifactId: 'task-123',
        }));
    });

    it('saves an approved workflow dream to notes and records conversion', async () => {
        const approvedWorkflowCard: DreamCard = {
            ...sampleCard,
            id: 'dream-workflow',
            category: 'user-workflow-suggestion',
            status: 'approved',
            approvedAt: '2026-06-10T08:03:00.000Z',
        };
        mocks.listCards.mockResolvedValue([approvedWorkflowCard]);

        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dream-card-dream-workflow');
        fireEvent.click(screen.getByTestId('dream-next-action-dream-workflow'));
        fireEvent.click(screen.getByTestId('dream-next-action-submit'));

        await waitFor(() => expect(mocks.saveNoteContent).toHaveBeenCalledWith(
            'ws-1',
            'Dreams/dream-workflow.md',
            expect.stringContaining('Dream card dream-workflow'),
        ));
        await waitFor(() => expect(mocks.convert).toHaveBeenCalledWith('ws-1', 'dream-workflow', {
            artifactType: 'note',
            artifactId: 'Dreams/dream-workflow.md',
            artifactUrl: '#repos/ws-1/notes/Dreams/dream-workflow.md',
        }));
    });

    it('saves an approved workflow dream to memory and records conversion', async () => {
        const approvedWorkflowCard: DreamCard = {
            ...sampleCard,
            id: 'dream-memory',
            category: 'user-workflow-suggestion',
            status: 'approved',
            approvedAt: '2026-06-10T08:03:00.000Z',
        };
        mocks.listCards.mockResolvedValue([approvedWorkflowCard]);

        render(<DreamsPanel workspaceId="ws-1" />);

        await screen.findByTestId('dream-card-dream-memory');
        fireEvent.click(screen.getByTestId('dream-next-action-dream-memory'));
        fireEvent.change(screen.getByTestId('dream-next-action-kind'), { target: { value: 'memory' } });
        fireEvent.click(screen.getByTestId('dream-next-action-submit'));

        await waitFor(() => expect(mocks.createMemoryFact).toHaveBeenCalledWith('ws-1', expect.stringContaining('Recommendation:'), {
            importance: 0.92,
            tags: ['dream'],
            sourceProcessId: 'queue_task-1',
        }));
        await waitFor(() => expect(mocks.convert).toHaveBeenCalledWith('ws-1', 'dream-memory', {
            artifactType: 'memory',
            artifactId: 'memory-123',
        }));
    });

    it('creates a work item from an approved product dream and records conversion', async () => {
        const approvedProductCard: DreamCard = {
            ...sampleCard,
            status: 'approved',
            approvedAt: '2026-06-10T08:03:00.000Z',
        };
        mocks.listCards.mockResolvedValue([approvedProductCard]);

        render(<DreamsPanel workspaceId="ws-1" originId="gh_example_repo" />);

        await screen.findByTestId('dream-card-dream-1');
        fireEvent.click(screen.getByTestId('dream-next-action-dream-1'));
        fireEvent.click(screen.getByTestId('dream-next-action-submit'));

        await waitFor(() => expect(mocks.createWorkItem).toHaveBeenCalledWith('gh_example_repo', expect.objectContaining({
            title: sampleCard.recommendation,
            type: 'work-item',
            priority: 'normal',
            tags: ['dream'],
            source: 'manual',
            sourceId: 'dream-1',
            description: expect.stringContaining('Dream card dream-1'),
        }), { workspaceId: 'ws-1' }));
        await waitFor(() => expect(mocks.convert).toHaveBeenCalledWith('ws-1', 'dream-1', {
            artifactType: 'work-item',
            artifactId: 'WI-456',
            artifactUrl: '#repos/ws-1/work-items/WI-456',
        }));
    });

    it('updates an existing work item from an approved product dream and records conversion', async () => {
        const approvedProductCard: DreamCard = {
            ...sampleCard,
            status: 'approved',
            approvedAt: '2026-06-10T08:03:00.000Z',
        };
        mocks.listCards.mockResolvedValue([approvedProductCard]);

        render(<DreamsPanel workspaceId="ws-1" originId="gh_example_repo" />);

        await screen.findByTestId('dream-card-dream-1');
        fireEvent.click(screen.getByTestId('dream-next-action-dream-1'));
        fireEvent.change(screen.getByTestId('dream-next-action-kind'), { target: { value: 'work-item-update' } });
        fireEvent.change(screen.getByTestId('dream-next-action-existing-work-item-id'), { target: { value: 'WI-123' } });
        fireEvent.click(screen.getByTestId('dream-next-action-submit'));

        await waitFor(() => expect(mocks.getWorkItem).toHaveBeenCalledWith('gh_example_repo', 'WI-123', { workspaceId: 'ws-1' }));
        await waitFor(() => expect(mocks.updateWorkItem).toHaveBeenCalledWith('gh_example_repo', 'WI-123', {
            description: expect.stringContaining('Existing description'),
            tags: ['existing', 'dream'],
        }, { workspaceId: 'ws-1' }));
        expect(mocks.updateWorkItem.mock.calls[0][2].description).toContain('Dream recommendation dream-1');
        await waitFor(() => expect(mocks.convert).toHaveBeenCalledWith('ws-1', 'dream-1', {
            artifactType: 'work-item',
            artifactId: 'WI-123',
            artifactUrl: '#repos/ws-1/work-items/WI-123',
        }));
    });
});
