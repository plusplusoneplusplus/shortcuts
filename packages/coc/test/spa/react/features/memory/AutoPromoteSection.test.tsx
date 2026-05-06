import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AutoPromoteSection } from '../../../../../src/server/spa/client/react/features/memory/AutoPromoteSection';

const mockPreferences = vi.hoisted(() => ({
    getWorkspacePreferences: vi.fn(),
    patchWorkspacePreferences: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi', () => ({
    getWorkspacePreferences: mockPreferences.getWorkspacePreferences,
    patchWorkspacePreferences: mockPreferences.patchWorkspacePreferences,
}));

describe('AutoPromoteSection', () => {
    beforeEach(() => {
        mockPreferences.getWorkspacePreferences.mockReset().mockResolvedValue({
            boundedMemory: {
                enabled: true,
                writeFrequency: 'medium',
                autoPromote: {
                    mode: 'threshold',
                    thresholdCount: 10,
                    minIntervalMs: 600_000,
                    gates: {
                        minScore: 0.8,
                        minRecallCount: 4,
                        minUniqueQueries: 3,
                    },
                },
            },
        });
        mockPreferences.patchWorkspacePreferences.mockReset().mockResolvedValue(undefined);
    });

    it('renders current auto-promotion status and saves edited settings', async () => {
        const onSaved = vi.fn();
        render(
            <AutoPromoteSection
                repoId="ws-test"
                enabled={true}
                onSaved={onSaved}
                stats={{
                    charCount: 0,
                    charLimit: 100,
                    lastModified: null,
                    pendingRawCount: 12,
                    claimedRawCount: 0,
                    consolidatedAt: null,
                    autoPromote: {
                        mode: 'threshold',
                        nextRunAt: null,
                        lastTrigger: 'auto-threshold',
                        lastSkipReason: 'promotion-already-active',
                    },
                }}
            />,
        );

        expect(await screen.findByTestId('auto-promote-section')).toBeInTheDocument();
        expect(screen.getByText('Last skip: promotion-already-active')).toBeInTheDocument();

        fireEvent.change(screen.getByTestId('auto-promote-mode'), { target: { value: 'cron+threshold' } });
        fireEvent.change(screen.getByTestId('auto-promote-threshold'), { target: { value: '25' } });
        fireEvent.click(screen.getByTestId('auto-promote-save'));

        await waitFor(() => expect(mockPreferences.patchWorkspacePreferences).toHaveBeenCalledWith('ws-test', {
            boundedMemory: expect.objectContaining({
                enabled: true,
                autoPromote: expect.objectContaining({
                    mode: 'cron+threshold',
                    thresholdCount: 25,
                    minIntervalMs: 600_000,
                    gates: {
                        minScore: 0.8,
                        minRecallCount: 4,
                        minUniqueQueries: 3,
                    },
                }),
            }),
        }));
        expect(onSaved).toHaveBeenCalled();
    });
});
