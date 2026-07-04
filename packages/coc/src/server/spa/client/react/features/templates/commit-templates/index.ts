/**
 * Shared commit-template management module — presentational components, pure helpers,
 * the list/detail controller hook, and the combined-tab selection reducer.
 */

export {
    enc,
    statusColor,
    validateTemplateName,
    parseTemplateHints,
    getTemplateErrorMessage,
} from './helpers';
export { ContextMenu } from './ContextMenu';
export type { ContextMenuItem, ContextMenuProps } from './ContextMenu';
export {
    TemplateListItem,
    TemplateDetailView,
    CreateTemplateForm,
    ReplicateDialog,
} from './components';
export type {
    TemplateListItemProps,
    TemplateDetailViewProps,
    CreateTemplateFormProps,
    ReplicateDialogProps,
} from './components';
export { useCommitTemplatesController } from './useCommitTemplatesController';
export type { CommitTemplatesController } from './useCommitTemplatesController';
export {
    EMPTY_TEMPLATES_PANEL_SELECTION,
    reduceTemplatesPanel,
    templatesPanelHash,
} from './templatesPanelSelection';
export type {
    TemplatesPanelSelection,
    TemplatesPanelAction,
} from './templatesPanelSelection';
