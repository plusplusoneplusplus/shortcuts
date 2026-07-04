/**
 * RepoTemplatesTab — workspace-scoped commit-template management with CRUD and replicate.
 * Follows the RepoSchedulesTab split-panel pattern.
 *
 * List/detail loading, WebSocket refresh, workspace reset, delete, and the create/edit/
 * replicate selection state live in the shared useCommitTemplatesController; the list item,
 * detail view, create form, and replicate dialog come from the shared commit-templates module
 * so this surface and the combined TemplatesTab stay in sync.
 */

import { Button, Spinner } from '../../ui';
import {
    TemplateListItem,
    TemplateDetailView,
    CreateTemplateForm,
    ReplicateDialog,
    useCommitTemplatesController,
} from './commit-templates';

// ── Props ──

interface RepoTemplatesTabProps {
    workspaceId: string;
}

// ── Main Component ──

export function RepoTemplatesTab({ workspaceId }: RepoTemplatesTabProps) {
    const {
        templates,
        loading,
        selectedName,
        detail,
        detailLoading,
        showCreate,
        editingName,
        replicateTarget,
        editingTemplate,
        setReplicateTarget,
        fetchTemplates,
        handleDelete,
        selectTemplate,
        openCreate,
        openEdit,
        closeForm,
    } = useCommitTemplatesController(workspaceId);

    // ── Render ──

    return (
        <div className="flex h-full overflow-hidden" data-testid="templates-tab">
            {/* ── LEFT PANEL ── */}
            <div className="w-72 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#2d2d2d] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#2d2d2d]">
                    <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                        Templates
                        {templates.length > 0 && (
                            <span className="ml-1.5 text-xs text-[#6e6e6e] dark:text-[#888]" data-testid="templates-count">
                                ({templates.length})
                            </span>
                        )}
                    </span>
                    <Button size="sm" onClick={openCreate} data-testid="templates-new-btn">
                        + New
                    </Button>
                </div>

                {/* Loading state */}
                {loading && (
                    <div className="flex-1 flex items-center justify-center">
                        <Spinner />
                    </div>
                )}

                {/* Empty state */}
                {!loading && templates.length === 0 && (
                    <div className="flex-1 flex items-center justify-center text-center px-4" data-testid="templates-empty">
                        <div>
                            <div className="text-2xl mb-2">📋</div>
                            <div className="text-sm text-[#6e6e6e] dark:text-[#888]">
                                No templates yet
                            </div>
                            <div className="text-xs text-[#999] dark:text-[#666] mt-1">
                                Create a template from a commit to replicate patterns
                            </div>
                        </div>
                    </div>
                )}

                {/* Scrollable list */}
                {!loading && templates.length > 0 && (
                    <ul className="flex-1 overflow-y-auto" data-testid="templates-list">
                        {templates.map(t => (
                            <TemplateListItem
                                key={t.name}
                                template={t}
                                isSelected={selectedName === t.name}
                                onSelect={() => selectTemplate(t.name)}
                                onEdit={() => openEdit(t.name)}
                                onReplicate={() => setReplicateTarget(t)}
                                onDelete={() => handleDelete(t.name)}
                            />
                        ))}
                    </ul>
                )}
            </div>

            {/* ── RIGHT PANEL ── */}
            <div className="flex-1 min-w-0 overflow-y-auto">
                {showCreate || editingName ? (
                    <CreateTemplateForm
                        workspaceId={workspaceId}
                        editingTemplate={editingTemplate}
                        onClose={closeForm}
                        onSaved={() => {
                            closeForm();
                            fetchTemplates();
                        }}
                    />
                ) : selectedName && detail ? (
                    <TemplateDetailView
                        template={detail}
                        loading={detailLoading}
                        onEdit={() => openEdit(detail.name)}
                        onReplicate={() => setReplicateTarget(detail)}
                        onDelete={() => handleDelete(detail.name)}
                    />
                ) : (
                    <div className="h-full flex items-center justify-center text-[#6e6e6e] dark:text-[#888] text-sm" data-testid="templates-empty-detail">
                        Select a template to view details
                    </div>
                )}
            </div>

            {/* ── REPLICATE DIALOG (modal) ── */}
            {replicateTarget && (
                <ReplicateDialog
                    workspaceId={workspaceId}
                    template={replicateTarget}
                    onClose={() => setReplicateTarget(null)}
                />
            )}
        </div>
    );
}
