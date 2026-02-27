/**
 * PipelinesTab — two-panel layout: left list + right detail/placeholder.
 */

import { useState } from 'react';
import { Button } from '../shared';
import { useApp } from '../context/AppContext';
import type { RepoData, PipelineInfo } from './repoGrouping';
import { PipelineDetail } from './PipelineDetail';
import { AddPipelineDialog } from './AddPipelineDialog';

interface PipelinesTabProps {
    repo: RepoData;
}

export function PipelinesTab({ repo }: PipelinesTabProps) {
    const { state, dispatch } = useApp();
    const pipelines = repo.pipelines || [];
    const [showAddDialog, setShowAddDialog] = useState(false);

    const selectedPipeline: PipelineInfo | null =
        pipelines.find(p => p.name === state.selectedPipelineName) ?? null;

    const handleSelect = (p: PipelineInfo) => {
        dispatch({ type: 'SET_SELECTED_PIPELINE', name: p.name });
        location.hash = '#repos/' + encodeURIComponent(repo.workspace.id) + '/pipelines/' + encodeURIComponent(p.name);
    };

    const handleClose = () => {
        dispatch({ type: 'SET_SELECTED_PIPELINE', name: null });
        location.hash = '#repos/' + encodeURIComponent(repo.workspace.id) + '/pipelines';
    };

    const handleDeleted = () => {
        handleClose();
    };

    const handleRunSuccess = () => {
        dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'queue' });
        location.hash = '#repos/' + encodeURIComponent(repo.workspace.id) + '/queue';
    };

    return (
        <div className="flex h-full overflow-hidden">
            {/* Left panel — pipeline list */}
            <div className="w-72 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <span className="text-xs text-[#848484]">
                        {pipelines.length} pipeline{pipelines.length !== 1 ? 's' : ''}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => setShowAddDialog(true)}>+ New Pipeline</Button>
                </div>
                {pipelines.length === 0 ? (
                    <div className="empty-state p-4 text-center">
                        <div className="text-2xl mb-2">📋</div>
                        <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">No pipelines found</div>
                        <div className="text-xs text-[#848484] mt-1">
                            Create your first pipeline by describing what it should do, or add YAML files to .vscode/pipelines/.
                        </div>
                    </div>
                ) : (
                    <ul className="repo-pipeline-list px-4 pb-4 flex flex-col gap-1 overflow-y-auto">
                        {pipelines.map(p => {
                            const isActive = p.name === state.selectedPipelineName;
                            return (
                                <li
                                    key={p.name}
                                    className={
                                        'repo-pipeline-item flex items-center justify-between gap-2 py-1.5 px-2 rounded cursor-pointer hover:bg-[#e8e8e8] dark:hover:bg-[#333]'
                                        + (isActive ? ' bg-[#e8e8e8] dark:bg-[#2a2d2e] border-l-2 border-[#0078d4]' : '')
                                    }
                                    role="option"
                                    aria-selected={isActive}
                                    onClick={() => handleSelect(p)}
                                >
                                    <span className={'pipeline-name text-sm text-[#1e1e1e] dark:text-[#cccccc]' + (isActive ? ' font-medium' : '')}>
                                        📋 {p.name}
                                    </span>
                                    <span className="repo-pipeline-actions shrink-0" onClick={e => e.stopPropagation()}>
                                        <Button variant="secondary" size="sm" className="action-btn" onClick={() => handleSelect(p)}>View</Button>
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {/* Right panel — detail or placeholder */}
            <div className="flex-1 min-w-0 overflow-hidden">
                {selectedPipeline ? (
                    <PipelineDetail
                        workspaceId={repo.workspace.id}
                        pipeline={selectedPipeline}
                        onClose={handleClose}
                        onDeleted={handleDeleted}
                        onRunSuccess={handleRunSuccess}
                    />
                ) : (
                    <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                        Select a pipeline
                    </div>
                )}
            </div>

            {showAddDialog && (
                <AddPipelineDialog
                    workspaceId={repo.workspace.id}
                    onCreated={(createdName?: string) => {
                        setShowAddDialog(false);
                        if (createdName) {
                            dispatch({ type: 'SET_SELECTED_PIPELINE', name: createdName });
                            location.hash = '#repos/' + encodeURIComponent(repo.workspace.id) + '/pipelines/' + encodeURIComponent(createdName);
                        }
                    }}
                    onClose={() => setShowAddDialog(false)}
                />
            )}
        </div>
    );
}
