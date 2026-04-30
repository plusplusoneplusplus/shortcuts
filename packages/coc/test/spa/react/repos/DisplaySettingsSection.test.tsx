import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplaySettingsSection } from '../../../../src/server/spa/client/react/features/repo-settings/DisplaySettingsSection';

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

const mockFetch = vi.fn();

beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch;
});

describe('DisplaySettingsSection', () => {
    it('renders HTML embeds disabled by default', async () => {
        mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

        render(<DisplaySettingsSection workspaceId="ws1" />);

        const toggle = await screen.findByTestId('html-embed-toggle');
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(toggle.textContent).toContain('Off');
    });

    it('persists HTML embed toggle changes', async () => {
        mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
            if (init?.method === 'PATCH') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ htmlEmbed: { enabled: false } }) });
        });

        render(<DisplaySettingsSection workspaceId="ws1" />);
        fireEvent.click(await screen.findByTestId('html-embed-toggle'));

        await waitFor(() => {
            const patchCall = mockFetch.mock.calls.find(([, init]) => init?.method === 'PATCH');
            expect(patchCall?.[1]?.body).toBe(JSON.stringify({ htmlEmbed: { enabled: true } }));
        });
    });
});
