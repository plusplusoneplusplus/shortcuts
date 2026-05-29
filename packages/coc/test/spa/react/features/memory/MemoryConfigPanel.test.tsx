/**
 * Tests for MemoryConfigPanel refresh button.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryConfigPanel } from '../../../../../src/server/spa/client/react/features/memory/MemoryConfigPanel';

const mockMemoryApi = vi.hoisted(() => ({
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/memory/memoryApi', () => ({
    memoryApi: mockMemoryApi,
}));

const defaultConfig = {
    storageDir: '~/.coc/memory',
    backend: 'file' as const,
    maxEntries: 10000,
    ttlDays: 90,
    autoInject: false,
    recording: { enabled: false },
};

beforeEach(() => {
    mockMemoryApi.getConfig.mockReset();
    mockMemoryApi.saveConfig.mockReset();
    mockMemoryApi.getConfig.mockResolvedValue(defaultConfig);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('MemoryConfigPanel', () => {
    it('renders a refresh button after loading', async () => {
        render(<MemoryConfigPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-config-refresh-btn')).toBeTruthy();
        });
    });

    it('calls fetch again when refresh button is clicked', async () => {
        render(<MemoryConfigPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('memory-config-refresh-btn')).toBeTruthy();
        });
        const callsBefore = mockMemoryApi.getConfig.mock.calls.length;
        fireEvent.click(screen.getByTestId('memory-config-refresh-btn'));
        await waitFor(() => {
            expect(mockMemoryApi.getConfig.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });
});
