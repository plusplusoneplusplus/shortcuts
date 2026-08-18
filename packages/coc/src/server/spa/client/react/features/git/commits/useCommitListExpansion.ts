/**
 * useCommitListExpansion — owns the inline file list under a commit row.
 *
 * Responsibilities: which commit is expanded, the lazily fetched per-commit
 * file cache, the loading indicator, the one-time deep-link auto-expansion,
 * and the filePath → active-comment-count map used to badge file rows.
 *
 * Every fetch carries a request generation. The generation bumps whenever the
 * workspace changes, so a `listCommitFiles` response that arrives after the
 * user switched repos is dropped instead of poisoning the new workspace's
 * cache with files from the old one.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import type { FileChange } from '../diff/FileTree';
import { useFileCommentCounts } from '../hooks/useFileCommentCounts';
import { computeDiffCommentKey } from '../../../../comments/diff-comment-utils';
import type { GitCommitItem } from './commitListTypes';

export interface CommitListExpansion {
    expandedHash: string | null;
    fileCache: Record<string, FileChange[]>;
    filesLoading: string | null;
    fileCommentMap: Map<string, number>;
    /** Expand `commit` and lazily fetch its files, or collapse it if already expanded. */
    toggleExpansion: (commit: GitCommitItem) => void;
}

export function useCommitListExpansion(
    workspaceId: string | undefined,
    initialExpandedHash: string | null | undefined,
): CommitListExpansion {
    // Expanded file list state: hash -> files (cached)
    const [expandedHash, setExpandedHash] = useState<string | null>(null);
    const [fileCache, setFileCache] = useState<Record<string, FileChange[]>>({});
    const [filesLoading, setFilesLoading] = useState<string | null>(null);
    // Track whether we've already performed the one-time deep-link auto-expansion
    const hasAutoExpanded = useRef(false);

    // Bumped whenever the workspace changes; in-flight fetches captured the
    // previous value and drop their result rather than writing a stale cache.
    const requestGenRef = useRef(0);
    const workspaceRef = useRef(workspaceId);
    if (workspaceRef.current !== workspaceId) {
        workspaceRef.current = workspaceId;
        requestGenRef.current += 1;
    }

    // Drop cached files when the workspace changes: hashes are not unique across repos.
    useEffect(() => {
        setFileCache({});
        setFilesLoading(null);
    }, [workspaceId]);

    const loadFiles = useCallback((hash: string, activeWorkspaceId: string) => {
        const gen = requestGenRef.current;
        const isStale = () => gen !== requestGenRef.current;
        setFilesLoading(hash);
        getCocClientForWorkspace(activeWorkspaceId).git.listCommitFiles(activeWorkspaceId, hash)
            .then(data => {
                if (isStale()) return;
                setFileCache(prev => ({ ...prev, [hash]: data.files || [] }));
            })
            .catch(() => {
                if (isStale()) return;
                setFileCache(prev => ({ ...prev, [hash]: [] }));
            })
            .finally(() => {
                if (isStale()) return;
                // Only clear the indicator if this request still owns it; a newer
                // expansion may already be loading a different commit.
                setFilesLoading(prev => (prev === hash ? null : prev));
            });
    }, []);

    // Deep-link: auto-expand the initially-selected commit once when its hash is first available
    useEffect(() => {
        if (!initialExpandedHash || hasAutoExpanded.current) return;
        hasAutoExpanded.current = true;
        setExpandedHash(initialExpandedHash);
        if (workspaceId) {
            loadFiles(initialExpandedHash, workspaceId);
        }
    }, [initialExpandedHash, workspaceId, loadFiles]);

    const toggleExpansion = useCallback((commit: GitCommitItem) => {
        if (expandedHash === commit.hash) {
            setExpandedHash(null);
            return;
        }
        setExpandedHash(commit.hash);
        if (!fileCache[commit.hash] && workspaceId) {
            loadFiles(commit.hash, workspaceId);
        }
    }, [expandedHash, fileCache, workspaceId, loadFiles]);

    // Fetch active comment counts for the currently expanded commit
    const commentCounts = useFileCommentCounts(
        workspaceId ?? '',
        expandedHash ? `${expandedHash}^` : null,
        expandedHash,
    );
    const [fileCommentMap, setFileCommentMap] = useState<Map<string, number>>(new Map());

    // Pre-compute storageKey → count lookup keyed by filePath for render-time access
    useEffect(() => {
        if (commentCounts.size === 0 || !expandedHash) {
            setFileCommentMap(new Map());
            return;
        }
        const files = fileCache[expandedHash] ?? [];
        if (files.length === 0) {
            setFileCommentMap(new Map());
            return;
        }
        let cancelled = false;
        const oldRef = `${expandedHash}^`;
        const computeMap = async () => {
            const map = new Map<string, number>();
            for (const file of files) {
                const key = await computeDiffCommentKey(workspaceId ?? '', oldRef, expandedHash, file.path);
                const count = commentCounts.get(key) ?? 0;
                if (count > 0) map.set(file.path, count);
            }
            if (!cancelled) setFileCommentMap(map);
        };
        void computeMap();
        return () => { cancelled = true; };
    }, [fileCache, expandedHash, commentCounts, workspaceId]);

    return { expandedHash, fileCache, filesLoading, fileCommentMap, toggleExpansion };
}
