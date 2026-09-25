/**
 * The overlay's repo-group fan-out (AC-03 client side).
 *
 * The group scope must send ONE query to the group-owning server and turn the
 * aggregate answer into overlay rows that each remember which member they came
 * from, so a later open reads through the right workspace. A member that fails
 * is named, not swallowed, and never costs the members that did answer.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

const searchContent = vi.fn();
const searchRepoGroupContent = vi.fn();
vi.mock(
    '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi',
    () => ({ explorerApi: { searchContent: (...args: unknown[]) => searchContent(...args) } }),
);
vi.mock(
    '../../../../src/server/spa/client/react/repos/repoGroupService',
    () => ({ searchRepoGroupContent: (...args: unknown[]) => searchRepoGroupContent(...args) }),
);

import { ContentSearchOverlayHost } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlayHost';
import { resetContentSearchMemoryForTests } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchStateStore';
import {
    toGroupOverlayMatches,
    toGroupResultState,
    describeContentSearchResults,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchRequest';

const GROUP_ID = 'group-alpha';

/** Only the match rows — the repo and file rows are treeitems too. */
function matchRows(): HTMLElement[] {
    return screen.queryAllByTestId(/^content-search-overlay-match-/);
}

beforeEach(() => {
    localStorage.clear();
    resetContentSearchMemoryForTests();
    searchContent.mockReset();
    searchRepoGroupContent.mockReset();
    searchRepoGroupContent.mockResolvedValue(groupResponse({}));
});

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

function serverMatch(path: string, line: number, text: string) {
    return { path, line, text, startColumn: 0, endColumn: text.length, before: [], after: [] };
}

function groupResponse(overrides: Record<string, unknown>) {
    return {
        status: 'complete',
        members: [],
        failures: [],
        truncated: false,
        totalMatches: 0,
        limit: 500,
        memberCount: 0,
        searchableMemberCount: 0,
        searchedMemberCount: 0,
        unavailableMemberCount: 0,
        failedMemberCount: 0,
        ...overrides,
    } as never;
}

function pressShortcut(): void {
    act(() => {
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'F',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
    });
}

function type(testId: string, value: string): void {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function submit(): void {
    fireEvent.keyDown(screen.getByTestId('content-search-overlay'), { key: 'Enter' });
}

function renderGroupHost(props: Record<string, unknown> = {}) {
    return render(
        <ContentSearchOverlayHost
            workspaceId={GROUP_ID}
            routingRef="remote:hub"
            baseUrl="https://hub.example/api"
            {...props}
        />,
    );
}

describe('repo-group dispatch', () => {
    it('sends one tracked query to the group owner and never to the repo route', async () => {
        renderGroupHost();
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();

        await waitFor(() => expect(searchRepoGroupContent).toHaveBeenCalledTimes(1));
        expect(searchContent).not.toHaveBeenCalled();
        const [groupId, query, options, baseUrl] = searchRepoGroupContent.mock.calls[0];
        expect(groupId).toBe(GROUP_ID);
        expect(query).toBe('needle');
        expect(options).toMatchObject({ fileScope: 'tracked' });
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(baseUrl).toBe('https://hub.example/api');
    });

    it('keeps a repo scope on the single-repo route', async () => {
        searchContent.mockResolvedValue({ matches: [], truncated: false });
        render(<ContentSearchOverlayHost workspaceId="repo-a" routingRef="remote:hub" />);
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();

        await waitFor(() => expect(searchContent).toHaveBeenCalledTimes(1));
        expect(searchRepoGroupContent).not.toHaveBeenCalled();
    });

    it('renders every member row, in membership order, labelled by member', async () => {
        searchRepoGroupContent.mockResolvedValue(groupResponse({
            members: [
                {
                    workspaceId: 'repo-a',
                    repoName: 'Alpha',
                    matches: [serverMatch('src/app.ts', 3, 'needle one')],
                    totalMatches: 1,
                    truncated: false,
                },
                {
                    workspaceId: 'repo-b',
                    repoName: 'Beta',
                    matches: [serverMatch('src/app.ts', 3, 'needle two')],
                    totalMatches: 1,
                    truncated: false,
                },
            ],
            totalMatches: 2,
            memberCount: 2,
            searchableMemberCount: 2,
            searchedMemberCount: 2,
        }));
        renderGroupHost();
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();

        await waitFor(() => {
            const repos = matchRows().length === 2
                ? [
                    screen.getByTestId('content-search-overlay-repo-repo-a'),
                    screen.getByTestId('content-search-overlay-repo-repo-b'),
                ]
                : [];
            expect(repos).toHaveLength(2);
            expect(repos[0].textContent).toContain('Alpha');
            expect(repos[1].textContent).toContain('Beta');
            // The same relative path in two members stays two file groups.
            expect(screen.getByTestId('content-search-overlay-file-repo-a src/app.ts')).toBeTruthy();
            expect(screen.getByTestId('content-search-overlay-file-repo-b src/app.ts')).toBeTruthy();
        });
    });

    it('names the members that could not be searched while keeping the rest', async () => {
        searchRepoGroupContent.mockResolvedValue(groupResponse({
            status: 'partial',
            members: [
                {
                    workspaceId: 'repo-a',
                    repoName: 'Alpha',
                    matches: [serverMatch('src/app.ts', 3, 'needle one')],
                    totalMatches: 1,
                    truncated: false,
                },
            ],
            failures: [
                { workspaceId: 'repo-b', repoName: 'Beta', reason: 'error', message: 'search failed' },
            ],
            totalMatches: 1,
            memberCount: 2,
            searchableMemberCount: 2,
            searchedMemberCount: 1,
            failedMemberCount: 1,
        }));
        renderGroupHost();
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();

        await waitFor(() => {
            expect(matchRows()).toHaveLength(1);
            expect(screen.getByTestId('content-search-overlay-status').textContent).toContain('Beta');
        });
        // The dropped member is named in its own list, not only in the summary.
        expect(
            screen.getByTestId('content-search-overlay-failure-repo-b').textContent,
        ).toContain('Beta');
    });

    it('lets a newer submission supersede an in-flight group answer', async () => {
        const first = { resolve: (_value: unknown) => {} };
        searchRepoGroupContent.mockImplementationOnce(
            () => new Promise(resolve => { first.resolve = resolve; }),
        );
        searchRepoGroupContent.mockResolvedValueOnce(groupResponse({
            members: [{
                workspaceId: 'repo-b',
                repoName: 'Beta',
                matches: [serverMatch('b.ts', 1, 'second')],
                totalMatches: 1,
                truncated: false,
            }],
            totalMatches: 1,
        }));
        renderGroupHost();
        pressShortcut();
        type('content-search-overlay-query', 'first');
        submit();
        await waitFor(() => expect(searchRepoGroupContent).toHaveBeenCalledTimes(1));
        type('content-search-overlay-query', 'second');
        submit();
        await waitFor(() => expect(searchRepoGroupContent).toHaveBeenCalledTimes(2));

        // The stale answer lands last and must not replace the newer one.
        await act(async () => {
            first.resolve(groupResponse({
                members: [{
                    workspaceId: 'repo-a',
                    repoName: 'Alpha',
                    matches: [serverMatch('a.ts', 1, 'first')],
                    totalMatches: 1,
                    truncated: false,
                }],
                totalMatches: 1,
            }));
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(matchRows()).toHaveLength(1);
            expect(screen.getByTestId('content-search-overlay-repo-repo-b').textContent)
                .toContain('Beta');
        });
    });
});

describe('toGroupOverlayMatches', () => {
    const response = groupResponse({
        members: [
            {
                workspaceId: 'repo-a',
                repoName: 'Alpha',
                matches: [serverMatch('src/app.ts', 3, 'one')],
                totalMatches: 1,
                truncated: false,
            },
            {
                workspaceId: 'repo-b',
                repoName: 'Beta',
                matches: [serverMatch('src/app.ts', 3, 'two')],
                totalMatches: 1,
                truncated: false,
            },
        ],
    });

    it('stamps each row with its member, owner route, and exact offsets', () => {
        const rows = toGroupOverlayMatches(response, 'remote:hub');
        expect(rows.map(row => row.workspaceId)).toEqual(['repo-a', 'repo-b']);
        expect(rows.map(row => row.repoLabel)).toEqual(['Alpha', 'Beta']);
        expect(rows.every(row => row.routingRef === 'remote:hub')).toBe(true);
        expect(rows.map(row => [row.startColumn, row.endColumn])).toEqual([[0, 3], [0, 3]]);
    });

    it('keeps the same relative path in two members as distinct rows', () => {
        const rows = toGroupOverlayMatches(response, null);
        expect(new Set(rows.map(row => row.id)).size).toBe(2);
    });
});

describe('toGroupResultState', () => {
    it('treats a partial answer as a success that names its failures', () => {
        const state = toGroupResultState(
            groupResponse({
                status: 'partial',
                members: [{
                    workspaceId: 'repo-a',
                    repoName: 'Alpha',
                    matches: [serverMatch('a.ts', 1, 'hit')],
                    totalMatches: 1,
                    truncated: true,
                }],
                failures: [{ workspaceId: 'repo-b', repoName: 'Beta', reason: 'unavailable', message: 'not a git repository' }],
                truncated: true,
            }),
            null,
            'needle',
        );
        expect(state.status).toBe('success');
        expect(state.truncated).toBe(true);
        expect(state.failures).toEqual([
            { workspaceId: 'repo-b', repoLabel: 'Beta', reason: 'unavailable', message: 'not a git repository' },
        ]);
        expect(describeContentSearchResults(state)).toContain('Beta');
    });

    it('reports an all-failed answer as a retryable error', () => {
        const state = toGroupResultState(
            groupResponse({
                status: 'failed',
                failures: [{ workspaceId: 'repo-a', repoName: 'Alpha', reason: 'error', message: 'boom' }],
            }),
            null,
            'needle',
        );
        expect(state.status).toBe('error');
        expect(state.errorKind).toBe('request');
        expect(state.matches).toEqual([]);
    });

    it('reports a group with no live member as unavailable', () => {
        const state = toGroupResultState(
            groupResponse({ status: 'no-searchable-members' }),
            null,
            'needle',
        );
        expect(state.status).toBe('unavailable');
        expect(state.errorKind).toBe('unavailable');
    });

    it('is empty, not failed, when every member answered with nothing', () => {
        const state = toGroupResultState(groupResponse({ status: 'complete' }), null, 'needle');
        expect(state.status).toBe('empty');
        expect(describeContentSearchResults(state)).toBe('No results.');
    });
});
