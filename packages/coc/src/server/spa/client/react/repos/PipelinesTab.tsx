/**
 * PipelinesTab — lists pipeline packages for a workspace.
 */

import type { RepoData } from './repoGrouping';

interface PipelinesTabProps {
    repo: RepoData;
}

export function PipelinesTab({ repo }: PipelinesTabProps) {
    const pipelines = repo.pipelines || [];

    if (pipelines.length === 0) {
        return (
            <div className="p-4 text-center">
                <div className="text-2xl mb-2">📋</div>
                <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">No pipelines found</div>
                <div className="text-xs text-[#848484] mt-1">
                    Add pipeline YAML files to .vscode/pipelines/ in this repository.
                </div>
            </div>
        );
    }

    return (
        <ul className="p-4 flex flex-col gap-1">
            {pipelines.map(p => (
                <li key={p.name} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#e8e8e8] dark:hover:bg-[#333]">
                    <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">📋 {p.name}</span>
                    <button className="text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline">
                        View
                    </button>
                </li>
            ))}
        </ul>
    );
}
