import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    client: vi.fn(),
    attachWorkspace: vi.fn(),
    sendRequestTo: vi.fn(),
    release: vi.fn(),
    getInfos: vi.fn(),
}));
vi.mock('../../../../../../src/server/spa/client/react/features/language-servers/languageServerClient', () => ({
    getLanguageServerClient: mocks.client,
}));

import { createCurrentCodeDefinitions } from '../../../../../../src/server/spa/client/react/features/git/diff/currentCodeDefinitions';

const symbol = (name = 'run', path = 'src/a.ts', workspace = 'ws-1', line = 2) => ({
    name,
    kind: 12,
    location: {
        uri: `coc-file://${workspace}/${path}`,
        range: { start: { line, character: 4 }, end: { line, character: 7 } },
    },
});
const info = (definitionId: string, supported = true) => ({
    definitionId,
    state: { capabilities: { workspaceSymbolProvider: supported } },
});

beforeEach(() => {
    vi.resetAllMocks();
    mocks.client.mockReturnValue({ attachWorkspace: mocks.attachWorkspace });
    mocks.attachWorkspace.mockReturnValue({
        getInfos: mocks.getInfos,
        sendRequestTo: mocks.sendRequestTo,
        release: mocks.release,
    });
    mocks.getInfos.mockReturnValue([info('coc-symbols')]);
    mocks.sendRequestTo.mockResolvedValue([symbol()]);
});

describe('current-code definitions for historical diffs', () => {
    it('uses a routed workspace attachment without opening a working-copy document', async () => {
        const lookup = createCurrentCodeDefinitions('ws-1', 'remote:ws-1');
        expect(mocks.client).toHaveBeenCalledWith('ws-1', undefined, 'remote:ws-1');
        expect(mocks.attachWorkspace).toHaveBeenCalledOnce();
        expect(await lookup.lookup('run')).toEqual([{
            workspaceId: 'ws-1', path: 'src/a.ts', line: 3, column: 5, symbolCandidate: true,
        }]);
        expect(mocks.sendRequestTo).toHaveBeenCalledWith(
            'coc-symbols', 'workspace/symbol', { query: 'run' }, { signal: expect.any(AbortSignal) },
        );
        lookup.dispose();
    });

    it('keeps exact-name matches and distinct locations from all capable servers', async () => {
        mocks.getInfos.mockReturnValue([info('coc-symbols'), info('typescript'), info('unsupported', false)]);
        mocks.sendRequestTo.mockImplementation(async (id: string) => id === 'coc-symbols'
            ? [symbol(), symbol('runner'), symbol('run', 'src/b.ts'), symbol('run', 'src/a.ts', 'ws-1', 9)]
            : [symbol()]);
        const lookup = createCurrentCodeDefinitions('ws-1');
        expect(await lookup.lookup('run')).toEqual([
            expect.objectContaining({ path: 'src/a.ts', line: 3 }),
            expect.objectContaining({ path: 'src/b.ts', line: 3 }),
            expect.objectContaining({ path: 'src/a.ts', line: 10 }),
        ]);
        expect(mocks.sendRequestTo).toHaveBeenCalledTimes(2);
        lookup.dispose();
    });

    it('rejects foreign-workspace and malformed results before stamping ownership', async () => {
        mocks.sendRequestTo.mockResolvedValue([
            symbol('run', 'src/foreign.ts', 'ws-2'), null, {},
            { name: 'run', location: { uri: 'file:///outside.ts' } }, symbol(),
        ]);
        const lookup = createCurrentCodeDefinitions('ws-1', null);
        expect(await lookup.lookup('run')).toHaveLength(1);
        expect(mocks.client).toHaveBeenCalledWith('ws-1', undefined, null);
        lookup.dispose();
    });

    it('retains useful results if another server fails', async () => {
        mocks.getInfos.mockReturnValue([info('coc-symbols'), info('failed')]);
        mocks.sendRequestTo.mockImplementation(async (id: string) => {
            if (id === 'failed') throw new Error('unavailable');
            return [symbol()];
        });
        const lookup = createCurrentCodeDefinitions('ws-1');
        expect(await lookup.lookup('run')).toHaveLength(1);
        lookup.dispose();
    });

    it('returns no matches for empty input, unavailable servers and errors', async () => {
        const lookup = createCurrentCodeDefinitions('ws-1');
        expect(await lookup.lookup('  ')).toEqual([]);
        expect(mocks.sendRequestTo).not.toHaveBeenCalled();
        mocks.getInfos.mockReturnValue([]);
        expect(await lookup.lookup('run')).toEqual([]);
        mocks.getInfos.mockReturnValue([info('coc-symbols')]);
        mocks.sendRequestTo.mockRejectedValue(new Error('offline'));
        expect(await lookup.lookup('run')).toEqual([]);
        lookup.dispose();
    });

    it.each(['cancel', 'dispose'])('revokes late results after %s even when transport ignores abort', async action => {
        let finish!: (value: unknown) => void;
        mocks.sendRequestTo.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const lookup = createCurrentCodeDefinitions('ws-1');
        const abort = new AbortController();
        const pending = lookup.lookup('run', abort.signal);
        const requestSignal = mocks.sendRequestTo.mock.calls[0][3].signal as AbortSignal;
        if (action === 'cancel') abort.abort('left diff');
        else lookup.dispose();
        expect(requestSignal.aborted).toBe(true);
        finish([symbol()]);
        expect(await pending).toEqual([]);
        lookup.dispose();
        lookup.dispose();
        expect(mocks.release).toHaveBeenCalledOnce();
        expect(await lookup.lookup('run')).toEqual([]);
        expect(mocks.sendRequestTo).toHaveBeenCalledOnce();
    });

    it('does not query for an already aborted request', async () => {
        const lookup = createCurrentCodeDefinitions('ws-1');
        const abort = new AbortController();
        abort.abort();
        expect(await lookup.lookup('run', abort.signal)).toEqual([]);
        expect(mocks.sendRequestTo).not.toHaveBeenCalled();
        lookup.dispose();
    });

    it('cancels one lookup without cancelling another on the shared attachment', async () => {
        const finish: ((value: unknown) => void)[] = [];
        mocks.sendRequestTo.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
        const lookup = createCurrentCodeDefinitions('ws-1');
        const abort = new AbortController();
        const first = lookup.lookup('run', abort.signal);
        const second = lookup.lookup('other');
        abort.abort();
        expect(mocks.sendRequestTo.mock.calls[1][3].signal.aborted).toBe(false);
        finish[0]([symbol()]);
        finish[1]([symbol('other')]);
        expect(await first).toEqual([]);
        expect(await second).toHaveLength(1);
        expect(mocks.attachWorkspace).toHaveBeenCalledOnce();
        lookup.dispose();
    });
});
