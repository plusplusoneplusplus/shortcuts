/**
 * Tests for MarkdownPopOutContext.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useContext, createContext } from 'react';
import {
    MarkdownPopOutProvider,
    useMarkdownPopOut,
    MD_POPOUT_CHANNEL,
} from '../../../../src/server/spa/client/react/context/MarkdownPopOutContext';

// Helper to capture context value
function ContextCapture({ onValue }: { onValue: (v: ReturnType<typeof useMarkdownPopOut>) => void }) {
    const value = useMarkdownPopOut();
    onValue(value);
    return null;
}

describe('MarkdownPopOutContext', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('provides default empty state', () => {
        let captured: ReturnType<typeof useMarkdownPopOut> | null = null;
        render(
            <MarkdownPopOutProvider>
                <ContextCapture onValue={(v) => { captured = v; }} />
            </MarkdownPopOutProvider>
        );
        expect(captured).not.toBeNull();
        expect(captured!.poppedOutFiles.size).toBe(0);
    });

    it('markPoppedOut adds a key to poppedOutFiles', () => {
        let captured: ReturnType<typeof useMarkdownPopOut> | null = null;
        render(
            <MarkdownPopOutProvider>
                <ContextCapture onValue={(v) => { captured = v; }} />
            </MarkdownPopOutProvider>
        );
        act(() => {
            captured!.markPoppedOut('ws1::file.md');
        });
        expect(captured!.poppedOutFiles.has('ws1::file.md')).toBe(true);
    });

    it('markRestored removes a key from poppedOutFiles', () => {
        let captured: ReturnType<typeof useMarkdownPopOut> | null = null;
        render(
            <MarkdownPopOutProvider>
                <ContextCapture onValue={(v) => { captured = v; }} />
            </MarkdownPopOutProvider>
        );
        act(() => {
            captured!.markPoppedOut('ws1::file.md');
        });
        expect(captured!.poppedOutFiles.has('ws1::file.md')).toBe(true);
        act(() => {
            captured!.markRestored('ws1::file.md');
        });
        expect(captured!.poppedOutFiles.has('ws1::file.md')).toBe(false);
    });

    it('useMarkdownPopOut returns default values outside provider', () => {
        let captured: ReturnType<typeof useMarkdownPopOut> | null = null;
        render(
            <ContextCapture onValue={(v) => { captured = v; }} />
        );
        expect(captured).not.toBeNull();
        expect(captured!.poppedOutFiles.size).toBe(0);
        // Should not throw when calling no-op functions
        captured!.markPoppedOut('test');
        captured!.markRestored('test');
    });
});
