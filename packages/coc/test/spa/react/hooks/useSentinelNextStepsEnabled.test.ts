import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSentinelNextStepsEnabled } from '../../../../src/server/spa/client/react/hooks/feature-flags/useSentinelNextStepsEnabled';

const { local } = vi.hoisted(() => ({ local: { enabled: false } }));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getFeatureValue: () => local.enabled,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'config-updated',
}));
afterEach(() => { local.enabled = false; vi.unstubAllGlobals(); });

describe('Sentinel next-step owner gate', () => {
    it('defaults off locally and follows runtime config events', () => {
        const { result } = renderHook(() => useSentinelNextStepsEnabled());
        expect(result.current).toBe(false);
        act(() => { local.enabled = true; window.dispatchEvent(new Event('config-updated')); });
        expect(result.current).toBe(true);
    });

    it('keeps remote gates isolated and discards obsolete owner responses', async () => {
        local.enabled = true;
        let answerA!: (value: unknown) => void;
        const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { answerA = resolve; }))
            .mockResolvedValueOnce({ ok: true, json: async () => ({ features: { sentinelNextStepsEnabled: true } }) });
        vi.stubGlobal('fetch', fetch);
        const { result, rerender } = renderHook(({ url }) => useSentinelNextStepsEnabled(url), { initialProps: { url: 'https://a.example' } });
        expect(result.current).toBe(false);
        rerender({ url: 'https://b.example' });
        expect(result.current).toBe(false);
        await waitFor(() => expect(result.current).toBe(true));
        await act(async () => answerA({ ok: true, json: async () => ({ features: { sentinelNextStepsEnabled: false } }) }));
        expect(result.current).toBe(true);
        expect(fetch.mock.calls.map(call => call[0])).toEqual(['https://a.example/api/config/runtime', 'https://b.example/api/config/runtime']);
    });

    it.each(['missing', 'unavailable'])('keeps %s remote owners off even when local is enabled', async failure => {
        local.enabled = true;
        const fetch = vi.fn();
        if (failure === 'missing') fetch.mockResolvedValue({ ok: true, json: async () => ({ features: {} }) });
        else fetch.mockRejectedValue(new Error('offline'));
        vi.stubGlobal('fetch', fetch);
        const { result } = renderHook(() => useSentinelNextStepsEnabled('https://owner.example'));
        await act(async () => { await Promise.resolve(); });
        expect(result.current).toBe(false);
    });
});
