/**
 * PipelinesTab — lists pipeline packages for a workspace.
 */

import { useState } from 'react';
import { Button } from '../shared';
import type { RepoData, PipelineInfo } from './repoGrouping';
import { PipelineDetail } from './PipelineDetail';
import { AddPipelineDialog } from './AddPipelineDialog';

interface PipelinesTabProps {
    repo: RepoData;
}

export function PipelinesTab({ repo }: PipelinesTabProps) {
    const pipelines = repo.pipelines || [];
    const [selectedPipeline, setSelectedPipeline] = useState<PipelineInfo | null>(null);
    const [showAddDialog, setShowAddDialog] = useState(false);

    if (selectedPipeline) {
        return (
            <PipelineDetail
                workspaceId={repo.workspace.id}
                pipeline={selectedPipeline}
                onClose={() => setSelectedPipeline(null)}
                onDeleted={() => setSelectedPipeline(null)}
            />
        );
    }

    if (pipelines.length === 0) {
        return (
            <div className="p-4 text-center">
                <div className="text-2xl mb-2">📋</div>
                <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">No pipelines found</div>
                <div className="text-xs text-[#848484] mt-1 mb-3">
                    Add pipeline YAML files to .vscode/pipelines/ in this repository.
                </div>
                <Button variant="secondary" size="sm" onClick={() => setShowAddDialog(true)}>+ New Pipeline</Button>
                {showAddDialog && (
                    <AddPipelineDialog
                        workspaceId={repo.workspace.id}
                        onCreated={() => setShowAddDialog(false)}
                        onClose={() => setShowAddDialog(false)}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-xs text-[#848484]">{pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''}</span>
                <Button variant="secondary" size="sm" onClick={() => setShowAddDialog(true)}>+ New Pipeline</Button>
            </div>
            <ul className="px-4 pb-4 flex flex-col gap-1">
                {pipelines.map(p => (
                    <li key={p.name} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#e8e8e8] dark:hover:bg-[#333]">
                        <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">📋 {p.name}</span>
                        <button
                            className="text-xs text-[#0078d4] dark:text-[#3794ff] hover:underline"
                            onClick={() => setSelectedPipeline(p)}
                        >
                            View
                        </button>
                    </li>
                ))}
            </ul>
            {showAddDialog && (
                <AddPipelineDialog
                    workspaceId={repo.workspace.id}
                    onCreated={() => setShowAddDialog(false)}
                    onClose={() => setShowAddDialog(false)}
                />
            )}
        </div>
    );
}
