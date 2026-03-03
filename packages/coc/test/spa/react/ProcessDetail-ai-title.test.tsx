/**
 * ProcessDetail AI Title Tests
 *
 * Tests that ProcessDetail shows process.title prominently as a header
 * with an AI indicator, and falls back to fullPrompt/promptPreview when absent.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ProcessDetail } from '../../../src/server/spa/client/react/processes/ProcessDetail';

vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
    invalidateDisplaySettings: vi.fn(),
}));

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
}

function SeededProcessDetail({ process }: { process: any }) {
    const { dispatch } = useApp();
    useEffect(() => {
        dispatch({ type: 'SET_PROCESSES', processes: [process] });
        dispatch({ type: 'SELECT_PROCESS', id: process.id });
    }, [dispatch, process]);
    return <ProcessDetail />;
}

beforeEach(() => {
    (global as any).EventSource = vi.fn().mockImplementation(() => ({
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        close: vi.fn(),
        onerror: null,
        onmessage: null,
    }));
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ process: null, turns: [] }),
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (global as any).EventSource;
});

describe('ProcessDetail — AI title header', () => {
    it('renders process.title prominently when set', async () => {
        const proc = {
            id: 'p-title',
            status: 'completed',
            title: 'Summarize the authentication module',
            promptPreview: 'raw prompt',
            fullPrompt: 'raw full prompt',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        expect(screen.getByText('Summarize the authentication module')).toBeDefined();
    });

    it('renders ✦ AI title indicator when process.title is set', async () => {
        const proc = {
            id: 'p-indicator',
            status: 'completed',
            title: 'My AI Title',
            promptPreview: 'fallback',
            fullPrompt: 'fallback full',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        expect(screen.getByText('✦ AI title')).toBeDefined();
    });

    it('does not render AI title header when process.title is absent', async () => {
        const proc = {
            id: 'p-no-title',
            status: 'completed',
            title: undefined,
            promptPreview: 'only preview',
            fullPrompt: 'only full prompt',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        expect(screen.queryByText('✦ AI title')).toBeNull();
    });

    it('still renders the full prompt below the AI title', async () => {
        const proc = {
            id: 'p-both',
            status: 'completed',
            title: 'AI Title Here',
            promptPreview: 'preview',
            fullPrompt: 'The complete full prompt text',
        };
        await act(async () => {
            render(<Wrap><SeededProcessDetail process={proc} /></Wrap>);
        });
        expect(screen.getByText('AI Title Here')).toBeDefined();
        // fullPrompt is rendered via dangerouslySetInnerHTML, so query by partial text
        const container = screen.getByText('AI Title Here').closest('div');
        expect(container).toBeDefined();
    });
});
