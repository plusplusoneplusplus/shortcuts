import { useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Button } from '../shared';
import { fetchApi } from '../hooks/useApi';

interface RepoWikiTabProps {
    workspaceId: string;
    workspacePath?: string;
}

export function RepoWikiTab({ workspaceId: _workspaceId, workspacePath }: RepoWikiTabProps) {
    const { state } = useApp();

    const repoWikis = useMemo(
        () => state.wikis.filter((w: any) => w.repoPath === workspacePath),
        [state.wikis, workspacePath],
    );

    const handleGenerateWiki = useCallback(async () => {
        if (!workspacePath) return;
        const res = await fetchApi('/api/wikis', {
            method: 'POST',
            body: JSON.stringify({ repoPath: workspacePath }),
        });
        if (res.ok) {
            const wiki = await res.json();
            location.hash = '#wiki/' + encodeURIComponent(wiki.id) + '/admin';
        }
    }, [workspacePath]);

    if (repoWikis.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="text-4xl mb-3">📚</div>
                <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">
                    No Wiki Found
                </div>
                <div className="text-xs text-[#848484] mb-4 max-w-xs">
                    No wiki has been generated for this workspace yet.
                    Generate one to get auto-documented architecture, components, and code insights.
                </div>
                <Button
                    size="sm"
                    disabled={!workspacePath}
                    title={!workspacePath ? 'A repository path is required to generate a wiki' : undefined}
                    onClick={handleGenerateWiki}
                >
                    Generate Wiki
                </Button>
            </div>
        );
    }

    return null;
}
