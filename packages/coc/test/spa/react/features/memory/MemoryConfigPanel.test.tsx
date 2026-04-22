/**
 * Tests for MemoryConfigPanel refresh button.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryConfigPanel } from '../../../../../src/server/spa/client/react/features/memory/MemoryConfigPanel';

const defaultConfig = {
    storageDir: '~/.coc/memory',
    backend: 'file' as const,
    maxEntries: 10000,
    ttlDays: 90,
    autoInject: false,
    recording: { enabled: false },
};

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(defaultConfig),
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('MemoryConfigPanel', () => {
    it('renders a refresh button after loading', async () => {
        render(<MemoryConfigPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-config-refresh-btn')).toBeTruthy();
        });
    });

    it('calls fetch again when refresh button is clicked', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(defaultConfig),
        });
        vi.stubGlobal('fetch', mockFetch);
        render(<MemoryConfigPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-config-refresh-btn')).toBeTruthy();
        });
        const callsBefore = mockFetch.mock.calls.length;
        fireEvent.click(screen.getByTestId('memory-config-refresh-btn'));
        await waitFor(() => {
            expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });
});
