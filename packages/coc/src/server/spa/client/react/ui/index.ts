/**
 * ui/ — Pure UI primitives for the CoC SPA.
 *
 * These are dependency-free (or near-dependency-free) presentational
 * components. Feature-level shared components remain in ../shared/.
 */

// ── Core primitives ────────────────────────────────────────────────────
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
export { ErrorBoundary } from './ErrorBoundary';
export { cn } from './cn';
export { usePortalContainer } from './usePortalContainer';

// ── Layout primitives ──────────────────────────────────────────────────
export { BottomSheet } from './BottomSheet';
export type { BottomSheetProps } from './BottomSheet';
export { ResponsiveSidebar } from './ResponsiveSidebar';
export type { ResponsiveSidebarProps } from './ResponsiveSidebar';
export { SectionHeader } from './SectionHeader';
export type { SectionHeaderProps } from './SectionHeader';

// ── Buttons / toggles ──────────────────────────────────────────────────
export { SendButton, SplitSendButton } from './SplitSendButton';
export type { SendButtonProps, SplitSendButtonProps } from './SplitSendButton';
export { QueueFollowUpButton } from './QueueFollowUpButton';
export type { QueueFollowUpButtonProps } from './QueueFollowUpButton';
export { ModeToggleToolbar } from './ModeToggleToolbar';
export type { ModeOption, ModeToggleToolbarProps } from './ModeToggleToolbar';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlOption, SegmentedControlProps } from './SegmentedControl';
export { SuggestionChips } from './SuggestionChips';
export type { SuggestionChipsProps } from './SuggestionChips';

// ── Display / data components ──────────────────────────────────────────
export { CapacityBar } from './CapacityBar';
export { ContextWindowIndicator } from './ContextWindowIndicator';
export { CopySectionBtn } from './CopySectionBtn';
export { JsonResponseView } from './JsonResponseView';
export { isJsonResponse } from './json-utils';
export { FilePathLink } from './FilePathLink';
export type { FilePathLinkProps } from './FilePathLink';
export { TruncatedPath } from './TruncatedPath';
export type { TruncatedPathProps } from './TruncatedPath';
export { FilterDropdown } from './FilterDropdown';
export type { FilterDropdownProps, FilterItem } from './FilterDropdown';

// ── Skeleton / loading ─────────────────────────────────────────────────
export { SkeletonLine, SkeletonCard, SkeletonList, SkeletonListItem } from './SkeletonLoader';

// ── Image components ───────────────────────────────────────────────────
export { ImagePreviews } from './ImagePreviews';
export type { ImagePreviewsProps } from './ImagePreviews';
export { ImageGallery } from './ImageGallery';
export type { ImageGalleryProps } from './ImageGallery';
export { ImageLightbox } from './ImageLightbox';
export type { ImageLightboxProps } from './ImageLightbox';

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

// ── Dialogs ────────────────────────────────────────────────────────────
export { RenameDialog } from './RenameDialog';
export type { RenameDialogProps } from './RenameDialog';

// ── Adapters ───────────────────────────────────────────────────────────
export { CommentPanelAdapter } from './CommentPanelAdapter';
export type { CommentPanelAdapterProps, NotesCommentPanelProps, TaskCommentPanelProps } from './CommentPanelAdapter';
