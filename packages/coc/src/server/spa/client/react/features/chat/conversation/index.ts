// Conversation rendering components and utilities
export { ConversationTurnBubble, chatMarkdownToHtml, toContentHtml, mergeConsecutiveContentChunks, inferParentToolCalls, _buildRawContent, formatCostTime, formatShortTimestamp } from './ConversationTurnBubble';
export { ConversationMiniMap, buildStrips, getTurnColor, computeStripHeights, getLandmark, MIN_TURNS_TO_SHOW } from './ConversationMiniMap';
export type { ConversationMiniMapProps, StripInfo } from './ConversationMiniMap';
export { ConversationMetadataPopover, getSessionIdFromProcess, buildRows } from './ConversationMetadataPopover';
export { ToolCallView } from './tool-calls/ToolCallView';
export { ToolCallGroupView, groupStartLabel, groupDuration } from './tool-calls/ToolCallGroupView';
export type { RenderToolCall, ToolCallGroupViewProps } from './tool-calls/ToolCallGroupView';
export { ToolResultPopover } from './tool-calls/ToolResultPopover';
export { WhisperCollapsedGroup } from './tool-calls/WhisperCollapsedGroup';
export { CommitStrip } from './CommitStrip';
export { PrStatusCard, describeAutoMerge, autoMergeLabel, prProviderFromUrl } from './PrStatusCard';
export type {
    PrStatusCardProps, PrStatusCardItem, PrStatusCardItemState, PrStatusCardPr,
    PrAutoMergeInfo, AutoMergeIndicatorModel, PrProvider,
} from './PrStatusCard';
export { ChatPrStatusCard } from './ChatPrStatusCard';
export type { ChatPrStatusCardProps } from './ChatPrStatusCard';
export { usePrChatStatusItems, mapPrDetailToCardPr, parseAutoMerge } from './usePrChatStatusItems';
export type { UsePrChatStatusItemsOptions, UsePrChatStatusItemsResult } from './usePrChatStatusItems';
export { JsonResponseView } from '../../../ui/JsonResponseView';
export { NoteEditCard } from './NoteEditCard';
export { ScriptTerminalBlock, highlightTerminalLine } from './ScriptTerminalBlock';
export { parseScriptOutput, describeScriptExit } from './scriptOutputParser';
export type { ParsedScriptOutput, ScriptStatus } from './scriptOutputParser';
export { getConversationTurns } from './chatConversationUtils';

// Utilities
export { detectCommitsInToolGroup } from './commitDetection';
export { detectPullRequestsInToolGroup } from './pullRequestDetection';
export type { DetectedPullRequest } from './pullRequestDetection';
export {
    collectToolCallsFromTurns, gatherDetectedPrsFromTurns, originIdForDetectedPr,
    unionAssociations, detectedPrsNeedingBinding,
} from './prChatAssociation';
export type { PrAssociation, PrChatBindingLike, UnionAssociationsInput } from './prChatAssociation';
export type { DetectedCommit } from './commitDetection';
export { isJsonResponse } from '../../../ui/json-utils';
export { mergeConsecutiveContentItems } from './timeline-utils';
export {
    CATEGORY_MAP, CATEGORY_ICONS,
    getToolGroupCategory, getCategoryLabel,
    getToolGroupStatus, isSingleLineHtml,
    groupConsecutiveToolChunks, filterWhisperChunks,
    computeNetDiff, computeFileEditTotals,
} from './tool-calls/toolGroupUtils';
export type {
    ToolGroupCategory, GroupContentItem, GroupOrderedItem,
    ToolGroupStatus, GroupOptions, FileEdit,
    WhisperSummary, WhisperGroupChunk,
} from './tool-calls/toolGroupUtils';
