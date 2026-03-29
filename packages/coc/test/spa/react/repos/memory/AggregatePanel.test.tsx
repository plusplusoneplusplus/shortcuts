/**
 * Tests for the AggregatePanel model dropdown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AggregatePanel } from '../../../../../src/server/spa/client/react/repos/memory/AggregatePanel';

// Mock useModels hook
const mockModels = [
    { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', enabled: true, tokenLimit: 200000, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 200000 } } },
    { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', enabled: true, tokenLimit: 200000, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 200000 } } },
    { id: 'gpt-5.1', name: 'GPT 5.1', enabled: false, tokenLimit: 128000, capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } },
];

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: mockModels, loading: false, error: null, reload: vi.fn() }),
}));

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
});

describe('AggregatePanel model dropdown', () => {
    const defaultProps = {
        repoId: 'ws-abc',
        onClose: vi.fn(),
        onDone: vi.fn(),
    };

    it('renders a select dropdown instead of a text input', () => {
        render(<AggregatePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select');
        expect(select.tagName).toBe('SELECT');
    });

    it('has a Default option as the first choice', () => {
        render(<AggregatePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select') as HTMLSelectElement;
        const options = select.querySelectorAll('option');
        expect(options[0].value).toBe('');
        expect(options[0].textContent).toBe('Default');
    });

    it('shows only enabled models when some are enabled', () => {
        render(<AggregatePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select') as HTMLSelectElement;
        const options = Array.from(select.querySelectorAll('option'));
        const modelOptions = options.filter(o => o.value !== '');
        // Only the 2 enabled models should appear
        expect(modelOptions).toHaveLength(2);
        expect(modelOptions.map(o => o.value)).toEqual(['claude-sonnet-4.6', 'claude-haiku-4.5']);
    });

    it('allows selecting a model from the dropdown', () => {
        render(<AggregatePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select') as HTMLSelectElement;
        expect(select.value).toBe(''); // Default initially
        fireEvent.change(select, { target: { value: 'claude-haiku-4.5' } });
        expect(select.value).toBe('claude-haiku-4.5');
    });

    it('sends selected model when Run is clicked', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ processId: 'p1', taskId: 't1' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        render(<AggregatePanel {...defaultProps} />);
        const select = screen.getByTestId('aggregate-model-select') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'claude-sonnet-4.6' } });
        fireEvent.click(screen.getByTestId('aggregate-run-btn'));

        await waitFor(() => {
            const aggregateCall = fetchMock.mock.calls.find(
                (call: any[]) => typeof call[0] === 'string' && call[0].includes('/memory/aggregate')
            );
            expect(aggregateCall).toBeTruthy();
            const body = JSON.parse(aggregateCall![1].body);
            expect(body.model).toBe('claude-sonnet-4.6');
        });
    });
});
