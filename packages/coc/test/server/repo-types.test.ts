import { expectTypeOf, it } from 'vitest';
import type {
    ContentMatch, ContentSearchOptions, ContentSearchResult,
    FileSearchResult, SearchFilesResult, TreeEntry, TreeListResult,
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
