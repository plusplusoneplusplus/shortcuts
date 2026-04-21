// ── UI primitives ──────────────────────────────────────────────────────
export { Button } from './Button';
export type { ButtonProps } from './Button';
export { Card } from './Card';
export type { CardProps } from './Card';
export { Dialog } from './Dialog';
export type { DialogProps } from './Dialog';
export { FloatingDialog } from './FloatingDialog';
export type { FloatingDialogProps } from './FloatingDialog';
export { Badge } from './Badge';
export type { BadgeProps } from './Badge';
export { Spinner } from './Spinner';
export type { SpinnerProps } from './Spinner';
export { ToastContainer, useToast } from './Toast';
export type { ToastProps } from './Toast';
export { SourceEditor } from './SourceEditor';
export type { SourceEditorProps } from './SourceEditor';
export { cn } from './cn';
export { ImagePreviews } from './ImagePreviews';
export type { ImagePreviewsProps } from './ImagePreviews';
export { ImageGallery } from './ImageGallery';
export type { ImageGalleryProps } from './ImageGallery';
export { ImageLightbox } from './ImageLightbox';
export type { ImageLightboxProps } from './ImageLightbox';
export { SuggestionChips } from './SuggestionChips';
export type { SuggestionChipsProps } from './SuggestionChips';
export { ResponsiveSidebar } from './ResponsiveSidebar';
export type { ResponsiveSidebarProps } from './ResponsiveSidebar';
export { BottomSheet } from './BottomSheet';
export type { BottomSheetProps } from './BottomSheet';
export { FilePathLink } from './FilePathLink';
export type { FilePathLinkProps } from './FilePathLink';
export { shortenFilePath, linkifyFilePaths, FILE_PATH_RE } from './file-path-utils';
export { TruncatedPath } from './TruncatedPath';
export type { TruncatedPathProps } from './TruncatedPath';
export { FilterDropdown } from './FilterDropdown';
export type { FilterDropdownProps, FilterItem } from './FilterDropdown';
export { SkillDetailPanel } from './SkillDetailPanel';
export type { SkillDetailPanelProps, SkillInfo } from './SkillDetailPanel';
export { SkillListItem } from './SkillListItem';
export type { SkillListItemProps } from './SkillListItem';
export { RichTextInput } from './RichTextInput';
export type { RichTextInputProps, RichTextInputHandle } from './RichTextInput';
export { SectionHeader } from './SectionHeader';
export type { SectionHeaderProps } from './SectionHeader';
export { ErrorBoundary } from './ErrorBoundary';
export { SendButton, SplitSendButton } from './SplitSendButton';
export type { SendButtonProps, SplitSendButtonProps } from './SplitSendButton';
export { CommentPanelAdapter } from './CommentPanelAdapter';
export type { CommentPanelAdapterProps, NotesCommentPanelProps, TaskCommentPanelProps } from './CommentPanelAdapter';
export { MarkdownView } from './MarkdownView';
export type { MarkdownViewProps } from './MarkdownView';
export { CopySectionBtn } from './CopySectionBtn';
export { ContextWindowIndicator } from './ContextWindowIndicator';
export { JsonResponseView } from './JsonResponseView';
export { isJsonResponse } from './json-utils';
export { SkeletonLine, SkeletonCard, SkeletonList, SkeletonListItem } from './SkeletonLoader';
export { CapacityBar } from './CapacityBar';
export { ModeToggleToolbar } from './ModeToggleToolbar';
export type { ModeOption, ModeToggleToolbarProps } from './ModeToggleToolbar';

// ── Attachment / paste previews ────────────────────────────────────────
export { AttachmentPreviews } from './AttachmentPreviews';
export type { AttachmentPreviewsProps } from './AttachmentPreviews';
export { AttachedContextPreviews } from './AttachedContextPreviews';
export type { AttachedContextPreviewsProps } from './AttachedContextPreviews';
export { PastePreview } from './PastePreview';
export type { PastePreviewProps } from './PastePreview';

// ── Dropdowns ──────────────────────────────────────────────────────────
export { CreatedFilesDropdown } from './CreatedFilesDropdown';
export { ReferencesDropdown, ReferenceList, normalizeRefPath, deduplicateReferenceFiles } from './ReferencesDropdown';
export type { ReferencesDropdownProps } from './ReferencesDropdown';

// ── Feature-level shared dialogs / editors ─────────────────────────────
export { FollowPromptDialog } from './FollowPromptDialog';
export type { FollowPromptDialogProps } from './FollowPromptDialog';
export { BulkFollowPromptDialog } from './BulkFollowPromptDialog';
export type { BulkFollowPromptDialogProps } from './BulkFollowPromptDialog';
export { ResolveContextDialog, shouldSkipResolveDialog, resetSkipResolveDialog } from './ResolveContextDialog';
export type { ResolveContextDialogProps } from './ResolveContextDialog';
export { UpdateDocumentDialog } from './UpdateDocumentDialog';
export type { UpdateDocumentDialogProps } from './UpdateDocumentDialog';
export { RenameDialog } from './RenameDialog';
export type { RenameDialogProps } from './RenameDialog';
export { MarkdownReviewEditor, parseFrontmatterStatus } from './MarkdownReviewEditor';
export type { MarkdownReviewEditorProps } from './MarkdownReviewEditor';
export { FilePreview } from './FilePreview';
export type { FilePreviewProps } from './FilePreview';

// ── Misc shared components ─────────────────────────────────────────────
export { NotificationBell } from './NotificationBell';
export { DASHBOARD_AI_COMMANDS } from './ai-commands';
export type { DashboardAICommand } from './ai-commands';
