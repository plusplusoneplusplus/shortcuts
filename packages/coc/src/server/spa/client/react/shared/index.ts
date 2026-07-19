// ── Feature-level shared components (canonical source: this directory) ──
export { SkillDetailPanel } from './SkillDetailPanel';
export type { SkillDetailPanelProps, SkillInfo } from './SkillDetailPanel';
export { SkillListItem } from './SkillListItem';
export type { SkillListItemProps } from './SkillListItem';
export { RichTextInput } from './RichTextInput';
export type { RichTextInputProps, RichTextInputHandle } from './RichTextInput';
export { MarkdownView } from './MarkdownView';
export type { MarkdownViewProps } from './MarkdownView';
export { InteractiveTable } from './InteractiveTable';
export type { InteractiveTableProps } from './InteractiveTable';
export { ExcalidrawPreview } from './ExcalidrawPreview';
export type { ExcalidrawPreviewProps } from './ExcalidrawPreview';
export { CanvasEmbed } from './CanvasEmbed';
export type { CanvasEmbedProps } from './CanvasEmbed';
export { extractTablesFromHtml, MIN_ROWS, MIN_COLS } from './extractTablesFromHtml';
export type { ExtractedTable, ExtractedTableData, ColumnAlignment } from './extractTablesFromHtml';
export { mountHtmlEmbeds } from './htmlEmbedMount';
export { mountMapEmbeds } from './mapEmbedMount';
export { SourceEditor } from './SourceEditor';
export type { SourceEditorProps } from './SourceEditor';
export { RunSkillPanel } from './RunSkillPanel';
export type { RunSkillPanelProps, SkillItem } from './RunSkillPanel';
export { FollowPromptDialog } from './FollowPromptDialog';
export type { FollowPromptDialogProps } from './FollowPromptDialog';
export { BulkFollowPromptDialog } from './BulkFollowPromptDialog';
export type { BulkFollowPromptDialogProps } from './BulkFollowPromptDialog';
export { ResolveContextDialog, shouldSkipResolveDialog, resetSkipResolveDialog } from './ResolveContextDialog';
export type { ResolveContextDialogProps } from './ResolveContextDialog';
export { UpdateDocumentDialog } from './UpdateDocumentDialog';
export type { UpdateDocumentDialogProps } from './UpdateDocumentDialog';
export { MarkdownReviewEditor, parseFrontmatterStatus } from './MarkdownReviewEditor';
export type { MarkdownReviewEditorProps } from './MarkdownReviewEditor';
export { FilePreview } from './FilePreview';
export type { FilePreviewProps } from './FilePreview';
export { NotificationBell } from './NotificationBell';
export { agentProviderQuotaIndicator } from './AgentProviderQuotaIndicator';
export { collectDreamProviderActivity, getTaskProvider, loadDreamProviderActivity } from './providerActivity';
export type { AgentProviderWorkActivity } from './providerActivity';
export { PROVIDER_LABELS, PROVIDER_ICONS, ProviderAvatar } from './providerVisuals';
export type { Provider } from './providerVisuals';
export { DASHBOARD_AI_COMMANDS } from './ai-commands';
export type { DashboardAICommand } from './ai-commands';
export { shortenFilePath, linkifyFilePaths, FILE_PATH_RE, parseFilePathRef } from './file-path-utils';
export type { FilePathRef } from './file-path-utils';
export { RalphLaunchDialog } from './RalphLaunchDialog';
export type { RalphLaunchDialogProps } from './RalphLaunchDialog';
export {
    RalphExecutionRepoSelector,
    getRalphExecutionRepoApiBase,
    getRalphExecutionRepoTargetKey,
    isSameRalphExecutionTarget,
    useRalphExecutionRepoTargets,
} from './RalphExecutionRepoSelector';
export type {
    RalphExecutionRepoSelectorProps,
    RalphExecutionRepoTarget,
    RalphExecutionRepoTargetGroup,
    UseRalphExecutionRepoTargetsOptions,
    UseRalphExecutionRepoTargetsResult,
} from './RalphExecutionRepoSelector';
export { isGoalFile } from './goal-file-utils';
export { resolveInlineImageSrc, useInlineImageLightbox } from './useInlineImageLightbox';
export { useUndoRedo } from './useUndoRedo';
export type { HistorySnapshot } from './useUndoRedo';
export {
    formatQuotaTypeLabel,
    getQuotaPercent,
    getQuotaUsedPercent,
    getQuotaRiskClasses,
    getFiniteQuotaTypes,
    getUnlimitedQuotaTypes,
    getTightestFiniteQuotaType,
    getMostConstrainedProviderQuota,
} from './quotaUtils';
export type { QuotaRiskClasses, MostConstrainedQuota } from './quotaUtils';
export { ModalJobAiControls, useModalJobAiSelection, isChatProvider, isSelectableProvider } from './ModalJobAiControls';
export type {
    ModalJobAiControlsProps,
    ResolvedModalJobAiSelection,
    UseModalJobAiSelectionOptions,
    UseModalJobAiSelectionResult,
} from './ModalJobAiControls';
export { useAnchoredPanelPosition } from './useAnchoredPanelPosition';
export type {
    AnchoredPanelPlacement,
    AnchoredPanelPositionOptions,
    AnchoredPanelPosition,
} from './useAnchoredPanelPosition';
export { WorktreeChip } from './WorktreeChip';
export type { WorktreeChipProps } from './WorktreeChip';
export {
    buildWorktreeRequest,
    useWorktreeLaunchControls,
    useWorktreeCapability,
    WorktreeLaunchControls,
} from './WorktreeLaunchControls';
export type { WorktreeLaunchState, WorktreeLaunchControlsProps } from './WorktreeLaunchControls';
export { useWorktreeCleanup } from './useWorktreeCleanup';
export type { WorktreeCleanupState } from './useWorktreeCleanup';
