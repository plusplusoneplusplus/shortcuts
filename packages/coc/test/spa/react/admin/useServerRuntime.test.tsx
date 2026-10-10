// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AdminConfigResponse } from '@plusplusoneplusplus/coc-client';
import { useServerRuntime } from '../../../../src/server/spa/client/react/admin/useServerRuntime';
import { useAdminSaveShortcut } from '../../../../src/server/spa/client/react/admin/useAdminSaveShortcut';

const mocks = vi.hoisted(() => ({ updateConfig: vi.fn(), restart: vi.fn() }));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ admin: mocks }),
    getSpaCocClientErrorMessage: (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback,
}));

function deferred() {
    let resolve!: (value: AdminConfigResponse) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<AdminConfigResponse>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function renderController() {
    const addToast = vi.fn();
    const onSaved = vi.fn();
    const view = renderHook(() => {
        const runtime = useServerRuntime({ addToast, onSaved });
        useAdminSaveShortcut(true, [{
            dirty: runtime.serverNameDirty,
            saving: runtime.serverNameSaving,
            onSave: runtime.handleSaveServerName,
        }]);
        return runtime;
    });
    return { ...view, addToast, onSaved };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateConfig.mockResolvedValue({ resolved: { serve: { serverName: 'new' } } });
});

describe('useServerRuntime display-name saving', () => {
    it('does not write before hydration or when clean, including whitespace-only edits', async () => {
        const { result } = renderController();
        await act(async () => { await result.current.handleSaveServerName(); });
        act(() => { result.current.hydrateServerName('old'); result.current.setServerName(' old '); });
        expect(result.current.serverNameDirty).toBe(false);
        await act(async () => { await result.current.handleSaveServerName(); });
        expect(mocks.updateConfig).not.toHaveBeenCalled();
        act(() => { result.current.setServerName('other'); result.current.setServerName('old'); });
        expect(result.current.serverNameDirty).toBe(false);
    });

    it.each(['ctrlKey', 'metaKey'] as const)('locks %s, button and Enter handlers in the same tick and until deferred success', async (modifier) => {
        const pending = deferred();
        mocks.updateConfig.mockReturnValue(pending.promise);
        const { result, onSaved } = renderController();
        act(() => { result.current.hydrateServerName('old'); result.current.setServerName(' new '); });
        const save = result.current.handleSaveServerName;
        const events = Array.from({ length: 3 }, () => new KeyboardEvent('keydown', {
            key: 's', [modifier]: true, cancelable: true,
        }));
        act(() => {
            for (const event of events) window.dispatchEvent(event);
            void save();
            void save();
        });
        expect(events.every(event => event.defaultPrevented)).toBe(true);
        expect(mocks.updateConfig).toHaveBeenCalledTimes(1);
        expect(mocks.updateConfig).toHaveBeenCalledWith({ 'serve.serverName': 'new' });
        expect(result.current.serverNameSaving).toBe(true);
        expect(result.current.serverName).toBe(' new ');
        expect(result.current.serverNameDirty).toBe(true);
        expect(onSaved).not.toHaveBeenCalled();
        await act(async () => { pending.resolve({ resolved: { serve: { serverName: 'new' } } }); await pending.promise; });
        expect(result.current.serverName).toBe('new');
        expect(result.current.serverNameDirty).toBe(false);
        expect(result.current.serverNameSaving).toBe(false);
        await act(async () => { await save(); });
        expect(mocks.updateConfig).toHaveBeenCalledTimes(1);
        expect(onSaved).toHaveBeenCalledTimes(1);
        expect(mocks.restart).not.toHaveBeenCalled();
    });

    it('keeps exact draft and baseline after deferred failure, then allows retry', async () => {
        const pending = deferred();
        mocks.updateConfig.mockReturnValueOnce(pending.promise);
        const { result, addToast, onSaved } = renderController();
        act(() => { result.current.hydrateServerName('old'); result.current.setServerName(' new '); });
        let save!: Promise<void>;
        act(() => { save = result.current.handleSaveServerName(); });
        await act(async () => { pending.reject(new Error('Name save failed')); await save; });
        expect(result.current.serverName).toBe(' new ');
        expect(result.current.serverNameDirty).toBe(true);
        expect(result.current.serverNameSaving).toBe(false);
        expect(addToast).toHaveBeenCalledWith('Name save failed', 'error');
        expect(onSaved).not.toHaveBeenCalled();
        await act(async () => { await result.current.handleSaveServerName(); });
        expect(mocks.updateConfig).toHaveBeenCalledTimes(2);
        expect(result.current.serverNameDirty).toBe(false);
    });

    it.each(['', ' \t '])('clears the stored override with null for %j and becomes clean', async (draft) => {
        mocks.updateConfig.mockResolvedValue({ resolved: { serve: {} } });
        const { result } = renderController();
        act(() => { result.current.hydrateServerName('old'); result.current.setServerName(draft); });
        await act(async () => { await result.current.handleSaveServerName(); });
        expect(mocks.updateConfig).toHaveBeenCalledWith({ 'serve.serverName': null });
        expect(result.current.serverName).toBe('');
        expect(result.current.serverNameDirty).toBe(false);
    });

    it('preserves edits made while saving and saves them separately', async () => {
        const pending = deferred();
        mocks.updateConfig.mockReturnValueOnce(pending.promise);
        const { result } = renderController();
        act(() => { result.current.hydrateServerName('old'); result.current.setServerName('first'); });
        let save!: Promise<void>;
        act(() => { save = result.current.handleSaveServerName(); });
        act(() => { result.current.setServerName(' second '); result.current.hydrateServerName('stale'); });
        await act(async () => { pending.resolve({ resolved: { serve: { serverName: 'first' } } }); await save; });
        expect(result.current.serverName).toBe(' second ');
        expect(result.current.serverNameDirty).toBe(true);
        await act(async () => { await result.current.handleSaveServerName(); });
        expect(mocks.updateConfig).toHaveBeenLastCalledWith({ 'serve.serverName': 'second' });
    });

    it('rehydrates a clean field but preserves unsaved drafts during config refresh', () => {
        const { result } = renderController();
        act(() => { result.current.hydrateServerName('old'); });
        act(() => { result.current.hydrateServerName('remote'); });
        expect(result.current.serverName).toBe('remote');
        act(() => { result.current.setServerName('draft'); });
        act(() => { result.current.hydrateServerName('refreshed'); });
        expect(result.current.serverName).toBe('draft');
        expect(result.current.serverNameDirty).toBe(true);
        act(() => { result.current.setServerName('refreshed'); });
        expect(result.current.serverNameDirty).toBe(false);
    });
});
