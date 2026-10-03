import { expectTypeOf, it } from 'vitest';
import type { ExplorerSearchResponse, RepoInfo as ClientRepoInfo } from '@plusplusoneplusplus/coc-client';
import type { RepoGroupSearchResult } from '../../src/server/workspaces/repo-group-handler';
import type {
    GroupContentSearchService, RepoGroupContentSearchMemberResult,
    RepoGroupContentSearchFailure, RepoGroupContentSearchResult,
} from '../../src/server/workspaces/repo-group-content-search';
import type {
    ContentMatch, ContentSearchOptions, ContentSearchResult,
    FileSearchResult, RepoInfo, SearchFilesResult, TreeEntry, TreeListResult,
} from '../../src/server/repos/types';

it('keeps repository result contracts and HTTP options independent of native handle methods', () => {
    expectTypeOf<TreeEntry>().toEqualTypeOf<{
        name: string;
        type: 'file' | 'dir';
        size?: number;
        path: string;
        children?: TreeEntry[];
    }>();
    expectTypeOf<TreeListResult>().toEqualTypeOf<{ entries: TreeEntry[]; truncated: boolean }>();
    expectTypeOf<FileSearchResult>().toEqualTypeOf<{ path: string; score: number; indices: number[] }>();
    expectTypeOf<SearchFilesResult>().toEqualTypeOf<{ results: FileSearchResult[]; truncated: boolean }>();
    expectTypeOf<ContentMatch>().toEqualTypeOf<{
        path: string;
        line: number;
        text: string;
        startColumn: number;
        endColumn: number;
        group?: number;
        before: string[];
        after: string[];
    }>();
    expectTypeOf<ContentSearchResult>().toEqualTypeOf<{ matches: ContentMatch[]; truncated: boolean }>();
    expectTypeOf<ContentSearchOptions>().toEqualTypeOf<{
        path?: string;
        caseSensitive?: boolean;
        wholeWord?: boolean;
        regex?: boolean;
        showIgnored?: boolean;
        fileScope?: 'tracked';
        includeUntracked?: boolean;
        include?: string[];
        exclude?: string[];
        limit?: number;
    }>();
});

it('keeps group search wire shapes and the native-backed service boundary', () => {
    type Counts = {
        memberCount: number;
        searchableMemberCount: number;
        searchedMemberCount: number;
        unavailableMemberCount: number;
        failedMemberCount: number;
    };
    type Wire<T> = { [K in keyof T]: T[K] };
    type Status = 'complete' | 'partial' | 'failed' | 'no-searchable-members';
    expectTypeOf<RepoGroupSearchResult>().toEqualTypeOf<Wire<Counts & {
        status: Status;
        results: Array<{ workspaceId: string; repoName: string; path: string; score: number; indices: number[] }>;
    }>>();
    expectTypeOf<RepoGroupContentSearchMemberResult>().toEqualTypeOf<{
        workspaceId: string;
        repoName: string;
        matches: ContentMatch[];
        totalMatches: number;
        truncated: boolean;
    }>();
    expectTypeOf<RepoGroupContentSearchFailure>().toEqualTypeOf<{
        workspaceId: string;
        repoName?: string;
        reason: 'stale' | 'unavailable' | 'error';
        message: string;
    }>();
    expectTypeOf<RepoGroupContentSearchResult>().toEqualTypeOf<Wire<Counts & {
        status: Status;
        members: RepoGroupContentSearchMemberResult[];
        failures: RepoGroupContentSearchFailure[];
        truncated: boolean;
        totalMatches: number;
        limit: number;
    }>>();
    expectTypeOf<GroupContentSearchService['searchContent']>().toEqualTypeOf<
        (repoId: string, query: string, options?: ContentSearchOptions) => Promise<ContentSearchResult>
    >();
});

it('keeps shared repo metadata and HTTP search envelopes compatible with native results', () => {
    type Metadata = {
        id: string;
        name: string;
        localPath: string;
        headSha: string;
        clonedAt: string;
        remoteUrl?: string;
    };
    expectTypeOf<RepoInfo>().toEqualTypeOf<Metadata>();
    expectTypeOf<ClientRepoInfo>().toEqualTypeOf<Metadata>();
    expectTypeOf<ExplorerSearchResponse['results'][number]>().toEqualTypeOf<FileSearchResult>();
    expectTypeOf<SearchFilesResult['results'][number]>().toEqualTypeOf<FileSearchResult>();
});
