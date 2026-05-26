/**
 * @vitest-environment jsdom
 *
 * Tests for hooks/usePromptAutocompleteEnabled.ts
 *
 * Regression: the inline ghost-text feature is OFF by default. It is enabled
 * only when the server explicitly reports `promptAutocomplete.enabled === true`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    preferences: {
        getGlobal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: mocks.preferences }),
}));

describe('usePromptAutocompleteEnabled', () => {
    beforeEach(() => {
        vi.resetModules();
        mocks.preferences.getGlobal.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('defaults to disabled when the preference is absent', async () => {
        mocks.preferences.getGlobal.mockResolvedValueOnce({});
        const { usePromptAutocompleteEnabled } = await import(
            '../../../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled'
        );
        const { result } = renderHook(() => usePromptAutocompleteEnabled());

        // Initial synchronous value is false.
        expect(result.current).toBe(false);

        // After the preferences fetch resolves it stays false because the
        // server returned no `promptAutocomplete` entry.
        await waitFor(() => {
            expect(mocks.preferences.getGlobal).toHaveBeenCalled();
        });
        expect(result.current).toBe(false);
    });

    it('stays disabled when promptAutocomplete.enabled is false', async () => {
        mocks.preferences.getGlobal.mockResolvedValueOnce({
            promptAutocomplete: { enabled: false },
        });
        const { usePromptAutocompleteEnabled } = await import(
            '../../../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled'
        );
        const { result } = renderHook(() => usePromptAutocompleteEnabled());
        await waitFor(() => {
            expect(mocks.preferences.getGlobal).toHaveBeenCalled();
        });
        expect(result.current).toBe(false);
    });

    it('becomes enabled when promptAutocomplete.enabled is true', async () => {
        mocks.preferences.getGlobal.mockResolvedValueOnce({
            promptAutocomplete: { enabled: true },
        });
        const { usePromptAutocompleteEnabled } = await import(
            '../../../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled'
        );
        const { result } = renderHook(() => usePromptAutocompleteEnabled());
        await waitFor(() => {
            expect(result.current).toBe(true);
        });
    });

    it('stays disabled when the preferences fetch fails', async () => {
        mocks.preferences.getGlobal.mockRejectedValueOnce(new Error('network'));
        const { usePromptAutocompleteEnabled } = await import(
            '../../../../../src/server/spa/client/react/hooks/usePromptAutocompleteEnabled'
        );
        const { result } = renderHook(() => usePromptAutocompleteEnabled());
        await waitFor(() => {
            expect(mocks.preferences.getGlobal).toHaveBeenCalled();
        });
        expect(result.current).toBe(false);
    });
});
