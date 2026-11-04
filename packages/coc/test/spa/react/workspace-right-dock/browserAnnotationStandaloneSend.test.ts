import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCocClientFor } from '../../../../src/server/spa/client/react/api/cocClient';
import { registerCloneBaseUrls, setActiveCloneForRouting } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { BrowserAnnotationSession, type BrowserAnnotationSelection } from '../../../../src/server/spa/client/react/shared/file-path/browser-annotation';
import { applyBrowserAnnotationEvents, getBrowserAnnotationChips, removeBrowserAnnotationChip,
    resetBrowserAnnotationChipsForTest, sendImmediateBrowserAnnotation, usePublishBrowserAnnotationSend,
} from '../../../../src/server/spa/client/react/shared/file-path/browser-annotation-chips';
import { sendStandaloneBrowserAnnotation } from '../../../../src/server/spa/client/react/shared/file-path/browser-annotation-standalone-send';

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({ getCocClientFor: vi.fn() }));
const owner = { workspaceId: 'workspace-a', routingRef: 'remote:server-a:workspace-a', processId: 'chat-a' };
const png = 'data:image/png;base64,aGVsbG8=';
const selection: BrowserAnnotationSelection = {
    type: 'selection', kind: 'element', captureId: '1', immediate: true,
    rect: { x: 1, y: 2, width: 30, height: 40 },
    page: { url: 'https://example.com', title: 'Example', viewport: { width: 800, height: 600, devicePixelRatio: 2 } },
    element: { tag: 'button', id: 'target', classes: [], selector: '#target', shadowHosts: [], text: 'Target', outerHTML: '<button id="target">Target</button>' },
};
const process = () => ({ id: owner.processId, type: 'chat', status: 'completed', sdkSessionId: 'session',
    metadata: { workspaceId: owner.workspaceId, mode: 'autopilot', provider: 'codex' } });
const client = { processes: { get: vi.fn(), sendMessage: vi.fn() } };
function fixture(target = owner) {
    const remove = vi.fn(async () => {});
    const session = new BrowserAnnotationSession({ supported: true, start: async () => true, stop: async () => {},
        remove, setEnabled: async () => {}, onEvent: () => () => {} }, 'view', target.routingRef, vi.fn());
    const save = (comment = 'Send this', id = '1') => applyBrowserAnnotationEvents(target, session, [
        { ...selection, image: { dataUrl: png, width: 60, height: 80 } },
        { type: 'comment', id, number: Number(id), comment, selection },
    ]);
    save();
    return { chip: getBrowserAnnotationChips(target)[0], session, save, remove };
}
const send = (chip: ReturnType<typeof fixture>['chip']) => sendImmediateBrowserAnnotation(chip, sendStandaloneBrowserAnnotation);
beforeEach(() => {
    vi.clearAllMocks(); resetBrowserAnnotationChipsForTest(); setActiveCloneForRouting(null);
    registerCloneBaseUrls([{ ...owner, serverId: 'server-a', baseUrl: 'https://server-a.example' }]);
    vi.mocked(getCocClientFor).mockReturnValue(client as never);
    client.processes.get.mockResolvedValue({ process: process() });
    client.processes.sendMessage.mockResolvedValue({});
});

describe('unmounted linked-chat modifier sends', () => {
    it.each(['completed', 'running'])('sends one numbered text/PNG snapshot on its exact server (%s)', async status => {
        const f = fixture(); await f.session.start(); f.save('Queued', '2');
        client.processes.get.mockResolvedValue({ process: { ...process(), status } });
        await send(f.chip);
        expect(getCocClientFor).toHaveBeenCalledExactlyOnceWith('https://server-a.example');
        expect(client.processes.get).toHaveBeenCalledWith('chat-a', {
            workspace: 'workspace-a', exclude: ['conversation', 'toolCalls'],
        }, { signal: expect.any(AbortSignal) });
        expect(client.processes.sendMessage).toHaveBeenCalledExactlyOnceWith('chat-a', {
            content: expect.stringContaining('Send this'), deliveryMode: 'enqueue', images: [png],
            attachments: [expect.objectContaining({ name: 'browser-annotation-group-1-pin-1.png', dataUrl: png })],
        }, { workspace: 'workspace-a' });
        expect(client.processes.sendMessage.mock.calls[0][1]).not.toHaveProperty('mode');
        expect(client.processes.sendMessage.mock.calls[0][1]).not.toHaveProperty('provider');
        expect(getBrowserAnnotationChips(owner)).toMatchObject([{ comment: 'Queued', number: 1 }]);
        expect(f.remove).toHaveBeenCalledExactlyOnceWith(f.session.identity, '1');
    });

    it('keeps explicit local owners local when an active remote has the same workspace ID', async () => {
        setActiveCloneForRouting(owner.routingRef);
        await send(fixture({ ...owner, routingRef: owner.workspaceId }).chip);
        expect(getCocClientFor).toHaveBeenCalledExactlyOnceWith(undefined);
    });

    it.each(['unresolved', 'malformed', 'draft'])('refuses unavailable %s destinations without any request', async kind => {
        const target = kind === 'draft' ? { ...owner, processId: '__browser_annotation_new_chat__' }
            : { ...owner, routingRef: kind === 'malformed' ? 'remote:broken' : 'remote:missing:workspace-a' };
        await expect(send(fixture(target).chip)).rejects.toThrow('Open the annotation chat');
        expect(getCocClientFor).not.toHaveBeenCalled();
    });

    it.each([
        { id: 'foreign' }, { type: 'agent' }, { status: 'queued' }, { status: 'cancelling' },
        { metadata: { workspaceId: 'foreign' } }, { metadata: { workspaceId: owner.workspaceId, mode: 'ralph' } },
        { metadata: { workspaceId: owner.workspaceId, compaction: { state: 'queued' } } },
        { metadata: { workspaceId: owner.workspaceId, compaction: { state: 'running' } } },
    ])('refuses mismatched or unavailable process metadata: %j', async override => {
        const f = fixture(); client.processes.get.mockResolvedValue({ process: { ...process(), ...override } });
        await expect(send(f.chip)).rejects.toThrow('Open the annotation chat');
        expect(client.processes.sendMessage).not.toHaveBeenCalled();
        expect(getBrowserAnnotationChips(owner)).toEqual([f.chip]);
    });

    it('rejects route replacement during preflight without posting to either server', async () => {
        client.processes.get.mockImplementationOnce(async () => {
            registerCloneBaseUrls([{ ...owner, serverId: 'server-a', baseUrl: 'https://replacement.example' }]);
            return { process: process() };
        });
        await expect(send(fixture().chip)).rejects.toThrow('Open the annotation chat');
        expect(client.processes.sendMessage).not.toHaveBeenCalled();
    });

    it('uses the owning server\'s canonical process ID for a queue alias', async () => {
        await send(fixture({ ...owner, processId: 'queue_chat-a' }).chip);
        expect(client.processes.get.mock.calls[0][0]).toBe('queue_chat-a');
        expect(client.processes.sendMessage.mock.calls[0][0]).toBe('chat-a');
    });

    it('retains a concurrent edit after acceptance', async () => {
        const f = fixture();
        client.processes.sendMessage.mockImplementationOnce(async () => { f.save('Edited'); return {}; });
        await send(f.chip);
        expect(getBrowserAnnotationChips(owner)).toMatchObject([{ comment: 'Edited', image: { dataUrl: png } }]);
    });

    it.each(['read', 'post'])('retains the chip and never retries a failed or uncertain %s', async stage => {
        const f = fixture();
        (stage === 'read' ? client.processes.get : client.processes.sendMessage).mockRejectedValueOnce(new Error('Uncertain outcome'));
        await expect(send(f.chip)).rejects.toThrow('Uncertain outcome');
        expect(getBrowserAnnotationChips(owner)).toEqual([f.chip]);
        expect(client.processes.get).toHaveBeenCalledTimes(1);
        expect(client.processes.sendMessage).toHaveBeenCalledTimes(stage === 'read' ? 0 : 1);
    });

    it('does not post a removed or edited snapshot during preflight', async () => {
        const f = fixture();
        client.processes.get.mockImplementationOnce(async () => { await removeBrowserAnnotationChip(f.chip.key); return { process: process() }; });
        await expect(send(f.chip)).rejects.toThrow('chat changed');
        expect(client.processes.sendMessage).not.toHaveBeenCalled();
    });

    it('uses mounted senders first and never falls back on admission failure or ambiguity', async () => {
        const f = fixture(); const mountedSend = vi.fn(async () => { throw new Error('Read only'); });
        const mounted = renderHook(() => usePublishBrowserAnnotationSend(owner, mountedSend));
        await expect(send(f.chip)).rejects.toThrow('Read only');
        const duplicate = renderHook(() => usePublishBrowserAnnotationSend(owner, mountedSend));
        await expect(send(f.chip)).rejects.toThrow('Open the annotation chat');
        expect(getCocClientFor).not.toHaveBeenCalled();
        duplicate.unmount(); mounted.unmount();
    });

    it('prevents overlapping sends and stops preflight if its composer mounts meanwhile', async () => {
        const f = fixture(); let resolve!: (value: unknown) => void;
        client.processes.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
        const pending = send(f.chip);
        await expect(send(f.chip)).rejects.toThrow('being sent');
        const mounted = renderHook(() => usePublishBrowserAnnotationSend(owner, vi.fn()));
        await act(async () => { resolve({ process: process() }); await expect(pending).rejects.toThrow('chat changed'); });
        expect(client.processes.sendMessage).not.toHaveBeenCalled(); mounted.unmount();
    });

    it('reports accepted pin cleanup failures without retaining a retryable chip', async () => {
        const f = fixture(); await f.session.start(); f.remove.mockRejectedValueOnce(new Error('Guest gone'));
        await expect(send(f.chip)).rejects.toThrow('Annotation sent, but its page pin');
        expect(getBrowserAnnotationChips(owner)).toEqual([]);
        await send(f.chip);
        expect(client.processes.sendMessage).toHaveBeenCalledTimes(1);
    });
});
