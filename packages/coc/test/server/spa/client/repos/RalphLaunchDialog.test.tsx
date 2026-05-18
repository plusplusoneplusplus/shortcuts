/**
 * @vitest-environment jsdom
 *
 * Tests for RalphLaunchDialog component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => true,
}));

const mockModels = [
    { id: 'model-a', name: 'Model A', enabled: true, tokenLimit: 100000 },
    { id: 'model-b', name: 'Model B', enabled: true, tokenLimit: 200000 },
    { id: 'model-c', name: 'Disabled Model', enabled: false, tokenLimit: 100000 },
];

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: mockModels, loading: false, error: null, reload: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { RalphLaunchDialog } from '../../../../../src/server/spa/client/react/shared/RalphLaunchDialog';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RalphLaunchDialog', () => {
    const defaultProps = {
        open: true,
        workspaceId: 'ws-123',
        sourceLabel: 'auth-refactor.goal.md',
        goalSpec: '## Goal\nRefactor auth module',
        onClose: vi.fn(),
        onLaunched: vi.fn(),
    };

    beforeEach(() => {
        defaultProps.onClose.mockClear();
        defaultProps.onLaunched.mockClear();
        vi.stubGlobal('fetch', vi.fn());
    });

    it('renders nothing when open is false', () => {
        const { container } = render(<RalphLaunchDialog {...defaultProps} open={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders dialog with source label and goal preview', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        expect(screen.getByTestId('ralph-launch-dialog')).toBeDefined();
        expect(screen.getByText('auth-refactor.goal.md')).toBeDefined();
        expect(screen.getByTestId('ralph-goal-preview')).toHaveValue('## Goal\nRefactor auth module');
    });

    it('goal preview is read-only', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        const textarea = screen.getByTestId('ralph-goal-preview') as HTMLTextAreaElement;
        expect(textarea.readOnly).toBe(true);
    });

    it('renders model selector with only enabled models', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        const select = screen.getByTestId('ralph-model-select') as HTMLSelectElement;
        const options = Array.from(select.options);
        // Default + 2 enabled models (model-c is disabled)
        expect(options).toHaveLength(3);
        expect(options[0].value).toBe('');
        expect(options[0].textContent).toBe('Default');
        expect(options[1].textContent).toBe('Model A');
        expect(options[2].textContent).toBe('Model B');
    });

    it('calls onClose when Cancel is clicked', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when ✕ is clicked', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        fireEvent.click(screen.getByLabelText('Close'));
        expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });

    it('posts to ralph-launch and calls onLaunched on success', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processId: 'new-pid-123' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} />);
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(defaultProps.onLaunched).toHaveBeenCalledWith('new-pid-123');
        });

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:4000/api/ralph-launch',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }),
        );

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.goalSpec).toBe('## Goal\nRefactor auth module');
        expect(body.workspaceId).toBe('ws-123');
    });

    it('includes model in config when selected', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processId: 'pid-456' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} />);

        // Select a model
        const select = screen.getByTestId('ralph-model-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'model-b' } });

        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(defaultProps.onLaunched).toHaveBeenCalledWith('pid-456');
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.config).toEqual({ model: 'model-b' });
    });

    it('includes folderPath when provided', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processId: 'pid-789' }),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} folderPath="/repo/notes" />);
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(defaultProps.onLaunched).toHaveBeenCalled();
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.folderPath).toBe('/repo/notes');
    });

    it('shows error on fetch failure', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve(JSON.stringify({ error: 'Server exploded' })),
        });
        vi.stubGlobal('fetch', mockFetch);

        render(<RalphLaunchDialog {...defaultProps} />);
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('ralph-launch-error')).toBeDefined();
            expect(screen.getByTestId('ralph-launch-error').textContent).toBe('Server exploded');
        });
        expect(defaultProps.onLaunched).not.toHaveBeenCalled();
    });

    it('shows error when goalSpec is empty', async () => {
        render(<RalphLaunchDialog {...defaultProps} goalSpec="   " />);
        fireEvent.click(screen.getByTestId('ralph-launch-confirm-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('ralph-launch-error')).toBeDefined();
            expect(screen.getByTestId('ralph-launch-error').textContent).toContain('empty');
        });
    });

    it('closes on backdrop click', () => {
        render(<RalphLaunchDialog {...defaultProps} />);
        const backdrop = screen.getByTestId('ralph-launch-dialog');
        fireEvent.mouseDown(backdrop);
        expect(defaultProps.onClose).toHaveBeenCalledOnce();
    });
});
