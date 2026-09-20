/**
 * The symbol fan-out (AC-03, AC-06).
 *
 * The rules worth pinning are the ones a screenshot cannot show: a slow server
 * must not hold up a fast one, a server that never answers must not fail the
 * query, and a late merge must not reorder what is already on screen.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    normalizeSymbols,
    queryWorkspaceSymbols,
    supportsWorkspaceSymbols,
    type WorkspaceSymbolTarget,
} from '../../../../src/server/spa/client/react/features/language-servers/workspaceSymbols';
import type {
    LanguageServerAttachedInfo,
    LanguageServerAttachment,
} from '../../../../src/server/spa/client/react/features/language-servers/languageServerClient';

function info(definitionId: string, capabilities: unknown = { workspaceSymbolProvider: true }): LanguageServerAttachedInfo {
    return {
        attachmentId: `a-${definitionId}`,
        sessionKey: `s-${definitionId}`,
        documentUri: 'coc-file://ws/',
        languageId: 'cpp',
        definitionId,
        displayName: definitionId,
        state: { status: 'ready', definitionId, displayName: definitionId, capabilities },
    };
}

function symbol(name: string, path: string, line = 0, extra: Record<string, unknown> = {}) {
    return {
        name,
        kind: 12,
        location: { uri: `coc-file://ws-a/${path}`, range: { start: { line, character: 2 } } },
        ...extra,
    };
}

/** An attachment whose servers answer from `answers`, keyed by definition id. */
function fakeAttachment(
    infos: LanguageServerAttachedInfo[],
    answers: Record<string, unknown | Promise<unknown>>,
): LanguageServerAttachment {
    return {
        getInfos: () => infos,
        sendRequestTo: (definitionId: string) => Promise.resolve(answers[definitionId]),
    } as unknown as LanguageServerAttachment;
}

describe('supportsWorkspaceSymbols', () => {
    it('accepts a boolean and an options object, and rejects an explicit no', () => {
        expect(supportsWorkspaceSymbols(info('a', { workspaceSymbolProvider: true }))).toBe(true);
        expect(supportsWorkspaceSymbols(info('a', { workspaceSymbolProvider: { resolve: true } }))).toBe(true);
        expect(supportsWorkspaceSymbols(info('a', { workspaceSymbolProvider: false }))).toBe(false);
        expect(supportsWorkspaceSymbols(info('a', { hoverProvider: true }))).toBe(false);
    });

    it('asks a server that has not handshaken yet rather than skipping it', () => {
        expect(supportsWorkspaceSymbols(info('a', undefined))).toBe(true);
    });
});

describe('normalizeSymbols', () => {
    it('flattens SymbolInformation into palette rows, one-based', () => {
        expect(normalizeSymbols([symbol('compute', 'src/a.cpp', 4, { containerName: 'Widget' })], 'coc-symbols'))
            .toEqual([{
                name: 'compute',
                containerName: 'Widget',
                kind: 12,
                path: 'src/a.cpp',
                line: 5,
                col: 3,
                definitionId: 'coc-symbols',
                indices: undefined,
            }]);
    });

    it('reads the scorer match indices when a server sends them, and shrugs when it does not', () => {
        const [scored] = normalizeSymbols([symbol('fwc', 'a.cpp', 0, { cocMatchIndices: [0, 4, 13] })], 'coc-symbols');
        expect(scored.indices).toEqual([0, 4, 13]);
        const [plain] = normalizeSymbols([symbol('fwc', 'a.cpp', 0, { cocMatchIndices: 'nonsense' })], 'x');
        expect(plain.indices).toBeUndefined();
    });

    it('drops anything that is not a symbol in a workspace document', () => {
        expect(normalizeSymbols(null, 'x')).toEqual([]);
        expect(normalizeSymbols([null, 7, {}], 'x')).toEqual([]);
        expect(normalizeSymbols([{ name: 'x', location: { uri: 'file:///etc/passwd' } }], 'x')).toEqual([]);
    });

    it('stamps the member identity in group scope', () => {
        const [row] = normalizeSymbols([symbol('a', 'a.cpp')], 'x', { workspaceId: 'ws-b', repoName: 'api' });
        expect(row).toMatchObject({ workspaceId: 'ws-b', repoName: 'api' });
    });
});

describe('queryWorkspaceSymbols', () => {
    it('renders the fast server before the slow one has answered', async () => {
        let releaseSlow: (value: unknown) => void = () => {};
        const slow = new Promise(resolve => { releaseSlow = resolve; });
        const targets: WorkspaceSymbolTarget[] = [{
            attachment: fakeAttachment([info('coc-symbols'), info('tsserver')], {
                'coc-symbols': [symbol('fast', 'a.cpp', 0, { cocMatchIndices: [0] })],
                tsserver: slow,
            }),
        }];
        const emitted: { names: string[]; pending: number }[] = [];
        const running = queryWorkspaceSymbols({
            targets,
            query: 'f',
            onResults: (results, pending) => emitted.push({ names: results.map(r => r.name), pending }),
        });

        await vi.waitFor(() => expect(emitted.length).toBe(1));
        expect(emitted[0]).toEqual({ names: ['fast'], pending: 1 });

        releaseSlow([symbol('slower', 'b.cpp')]);
        const outcome = await running;
        expect(outcome.status).toBe('complete');
        // The already-rendered hit keeps its place; the unscored row folds in below.
        expect(outcome.results.map(r => r.name)).toEqual(['fast', 'slower']);
    });

    it('treats a server that throws as no answer, and reports partial', async () => {
        const attachment = {
            getInfos: () => [info('coc-symbols'), info('broken')],
            sendRequestTo: (definitionId: string) => definitionId === 'broken'
                ? Promise.reject(new Error('dead session'))
                : Promise.resolve([symbol('kept', 'a.cpp')]),
        } as unknown as LanguageServerAttachment;

        const outcome = await queryWorkspaceSymbols({ targets: [{ attachment }], query: 'k' });
        expect(outcome.status).toBe('partial');
        expect(outcome.results.map(r => r.name)).toEqual(['kept']);
    });

    it('separates every server failing from every server answering nothing', async () => {
        const dead = {
            getInfos: () => [info('a')],
            sendRequestTo: () => Promise.reject(new Error('gone')),
        } as unknown as LanguageServerAttachment;
        expect((await queryWorkspaceSymbols({ targets: [{ attachment: dead }], query: 'k' })).status).toBe('failed');

        const empty = fakeAttachment([info('a')], { a: [] });
        const quiet = await queryWorkspaceSymbols({ targets: [{ attachment: empty }], query: 'k' });
        expect(quiet.status).toBe('complete');
        expect(quiet.results).toEqual([]);
    });

    it('reports no searchable members when nothing can answer', async () => {
        expect((await queryWorkspaceSymbols({ targets: [], query: 'k' })).status).toBe('no-searchable-members');
        const unsupported = fakeAttachment([info('a', { workspaceSymbolProvider: false })], {});
        expect((await queryWorkspaceSymbols({ targets: [{ attachment: unsupported }], query: 'k' })).status)
            .toBe('no-searchable-members');
    });

    it('dedupes the same location answered by two servers and badges each repo', async () => {
        const shared = symbol('compute', 'src/a.cpp', 4);
        const outcome = await queryWorkspaceSymbols({
            targets: [
                {
                    workspaceId: 'ws-a',
                    repoName: 'core',
                    attachment: fakeAttachment([info('coc-symbols'), info('clangd')], {
                        'coc-symbols': [shared],
                        clangd: [shared],
                    }),
                },
                {
                    workspaceId: 'ws-b',
                    repoName: 'api',
                    attachment: fakeAttachment([info('coc-symbols')], { 'coc-symbols': [shared] }),
                },
            ],
            query: 'compute',
        });
        // Same path and line, but two different repos: two rows, not one.
        expect(outcome.results).toHaveLength(2);
        expect(outcome.results.map(r => r.repoName).sort()).toEqual(['api', 'core']);
    });

    it('answers an empty query with nothing, without asking any server', async () => {
        const sendRequestTo = vi.fn();
        const attachment = { getInfos: () => [info('a')], sendRequestTo } as unknown as LanguageServerAttachment;
        expect((await queryWorkspaceSymbols({ targets: [{ attachment }], query: '   ' })).results).toEqual([]);
        expect(sendRequestTo).not.toHaveBeenCalled();
    });

    it('honours the render limit', async () => {
        const rows = Array.from({ length: 10 }, (_, i) => symbol(`name${i}`, `f${i}.cpp`));
        const attachment = fakeAttachment([info('a')], { a: rows });
        const outcome = await queryWorkspaceSymbols({ targets: [{ attachment }], query: 'n', limit: 3 });
        expect(outcome.results).toHaveLength(3);
    });
});
