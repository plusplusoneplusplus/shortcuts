/**
 * useRemoteShell — tests for the localStorage-backed remote-shell flag.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useRemoteShell,
    getRemoteShellEnabled,
    setRemoteShellEnabled,
    __resetRemoteShellForTesting,
} from '../../../../src/server/spa/client/react/hooks/preferences/useRemoteShell';

const STORAGE_KEY = 'coc-remote-shell-enabled';

describe('useRemoteShell', () => {
    beforeEach(() => {
        localStorage.clear();
        __resetRemoteShellForTesting();
    });

    it('defaults to disabled', () => {
        const { result } = renderHook(() => useRemoteShell());
        expect(result.current[0]).toBe(false);
        expect(getRemoteShellEnabled()).toBe(false);
    });

    it('enabling updates the value and persists to localStorage', () => {
        const { result } = renderHook(() => useRemoteShell());
        act(() => result.current[1](true));
        expect(result.current[0]).toBe(true);
        expect(getRemoteShellEnabled()).toBe(true);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
    });

    it('disabling persists the off value', () => {
        const { result } = renderHook(() => useRemoteShell());
        act(() => result.current[1](true));
        act(() => result.current[1](false));
        expect(result.current[0]).toBe(false);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('0');
    });

    it('keeps multiple hook instances in sync via the shared store', () => {
        const a = renderHook(() => useRemoteShell());
        const b = renderHook(() => useRemoteShell());
        act(() => setRemoteShellEnabled(true));
        expect(a.result.current[0]).toBe(true);
        expect(b.result.current[0]).toBe(true);
    });
});
