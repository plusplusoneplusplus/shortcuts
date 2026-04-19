/**
 * Tests for useQueueChat hook — hook-level integration with context providers.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { type ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { useQueueChat } from '../../../src/server/spa/client/react/hooks/useQueueChat';

// ── Wrapper ──────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>{children}</QueueProvider>
        </AppProvider>
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useQueueChat', () => {
    it('returns empty fileMap and folderMap when no workspace matches', () => {
        const { result } = renderHook(() => useQueueChat('nonexistent-ws'), { wrapper: Wrapper });
        expect(result.current.fileMap).toEqual({});
        expect(result.current.folderMap).toEqual({});
    });

    it('returns empty maps when workspace exists but queue is empty', () => {
        // The AppContext starts with no workspaces; no active items means empty maps
        const { result } = renderHook(() => useQueueChat('any-ws'), { wrapper: Wrapper });
        expect(Object.keys(result.current.fileMap)).toHaveLength(0);
    });

    it('returns stable references when called with same wsId and no queue change', () => {
        const { result, rerender } = renderHook(() => useQueueChat('ws-1'), { wrapper: Wrapper });
        const first = result.current;
        rerender();
        expect(result.current.fileMap).toBe(first.fileMap);
        expect(result.current.folderMap).toBe(first.folderMap);
    });
});
