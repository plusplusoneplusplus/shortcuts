/**
 * Tests for the PromotePanel component.
 * Covers model dropdown, cancel via cocClient.queue.cancel, and
 * process result fetching via cocClient.processes.get.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PromotePanel } from '../../../../../src/server/spa/client/react/features/memory/PromotePanel';

// Mock useModels hook
const mockModels = [
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', enabled: true, tokenLimit: 200000, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 200000 } } },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', enabled: true, tokenLimit: 200000, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 200000 } } },
    { id: 'gpt-5.1', name: 'GPT 5.1', enabled: false, tokenLimit: 128000, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
];

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: mockModels, loading: false, error: null, reload: vi.fn() }),
}));

const mocks = vi.hoisted(() => ({
    memory: {
        getRepoOverview: vi.fn(),
        promoteRepo: vi.fn(),
    },
    queue: {
        cancel: vi.fn(),
    },
    processes: {
        get: vi.fn(),
        streamUrl: vi.fn().mockReturnValue('/api/processes/mock/stream'),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getSpaCocClient: () => ({ memory: mocks.memory, queue: mocks.queue, processes: mocks.processes }),
    };
});

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.memory.getRepoOverview.mockReset();
    mocks.memory.promoteRepo.mockReset();
    mocks.queue.cancel.mockReset().mockResolvedValue({});
    mocks.processes.get.mockReset();
});

describe('PromotePanel model dropdown', () => {
    const defaultProps = {
        repoId: 'ws-abc',
        onClose: vi.fn(),
        onDone: vi.fn(),
    };

    it('renders a select dropdown instead of a text input', () => {
        render(<PromotePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select');
        expect(select.tagName).toBe('SELECT');
    });

    it('has a Default option as the first choice', () => {
        render(<PromotePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select') as HTMLSelectElement;
        const options = select.querySelectorAll('option');
        expect(options[0].value).toBe('');
        expect(options[0].textContent).toBe('Default');
    });

    it('shows only enabled models when some are enabled', () => {
        render(<PromotePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select') as HTMLSelectElement;
        const options = Array.from(select.querySelectorAll('option'));
        const modelOptions = options.filter(o => o.value !== '');
        // Only the 2 enabled models should appear
        expect(modelOptions).toHaveLength(2);
        expect(modelOptions.map(o => o.value)).toEqual(['claude-sonnet-4.6', 'claude-haiku-4.5']);
    });

    it('allows selecting a model from the dropdown', () => {
        render(<PromotePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select') as HTMLSelectElement;
        expect(select.value).toBe(''); // Default initially
        fireEvent.change(select, { target: { value: 'claude-haiku-4.5' } });
        expect(select.value).toBe('claude-haiku-4.5');
    });

    it('sends selected model when Run is clicked', async () => {
        mocks.memory.promoteRepo.mockResolvedValue({ processId: 'p1', taskId: 't1', operation: 'promotion', status: 'queued' });

        render(<PromotePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'claude-sonnet-4.6' } });
        fireEvent.click(screen.getByTestId('aggregate-run-btn'));

        await waitFor(() => {
            expect(mocks.memory.promoteRepo).toHaveBeenCalledWith('ws-abc', { model: 'claude-sonnet-4.6', target: undefined });
        });
    });
});

describe('PromotePanel cancel', () => {
    const defaultProps = {
        repoId: 'ws-abc',
        onClose: vi.fn(),
        onDone: vi.fn(),
    };

    it('uses cocClient.queue.cancel to cancel a queued task', async () => {
        mocks.memory.promoteRepo.mockResolvedValue({ processId: 'p1', taskId: 't-cancel', operation: 'promotion', status: 'queued' });

        render(<PromotePanel {...defaultProps} />);
        fireEvent.click(screen.getByTestId('aggregate-run-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('aggregate-queued')).toBeInTheDocument();
        });

        const cancelBtn = screen.getByTestId('aggregate-cancel-btn');
        fireEvent.click(cancelBtn);

        await waitFor(() => {
            expect(mocks.queue.cancel).toHaveBeenCalledWith('t-cancel');
        });
    });
});

describe('PromotePanel fetchProcessResult', () => {
    it('transitions to done when process is completed', async () => {
        mocks.memory.promoteRepo.mockResolvedValue({ processId: 'p-done', taskId: 't1', operation: 'promotion', status: 'queued' });
        mocks.memory.getRepoOverview.mockResolvedValue({ promotionStatus: 'running', promotionProcessId: 'p-done' });
        mocks.processes.get.mockResolvedValue({ process: { status: 'completed' } });

        // Stub EventSource so the streaming phase doesn't throw in jsdom
        const closeFn = vi.fn();
        vi.stubGlobal('EventSource', class {
            addEventListener = vi.fn();
            close = closeFn;
            set onerror(fn: any) { /* trigger fallback to fetchProcessResult */ fn(); }
        });

        const onDone = vi.fn();
        const { unmount } = render(<PromotePanel repoId="ws-abc" onClose={vi.fn()} onDone={onDone} />);

        // Start promotion
        await act(async () => {
            fireEvent.click(screen.getByTestId('aggregate-run-btn'));
        });

        // Let the queued→streaming transition happen via poll
        await waitFor(() => {
            expect(mocks.memory.getRepoOverview).toHaveBeenCalled();
        }, { timeout: 5000 });

        unmount();
        vi.unstubAllGlobals();
    });

    it('shows error when process fetch fails', async () => {
        const { CocApiError } = await import('@plusplusoneplusplus/coc-client');
        mocks.processes.get.mockRejectedValue(new CocApiError(500, 'Internal Server Error', null));

        // Verify the component source uses cocClient, not raw fetch
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.resolve(__dirname, '../../../../../src/server/spa/client/react/features/memory/PromotePanel.tsx'),
            'utf-8',
        );
        expect(source).not.toMatch(/\bfetch\s*\(/);
        expect(source).toContain('getSpaCocClient');
        expect(source).toContain('queue.cancel');
        expect(source).toContain('processes.get');
    });
});
