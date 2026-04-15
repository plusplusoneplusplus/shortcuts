export { createResolveCommentTool } from './resolve-comment-tool';
export { createSearchConversationsTool, stripMarkTags, type SearchConversationsArgs } from './search-conversations-tool';
export { createSuggestFollowUpsTool, type FollowUpSuggestion } from './suggest-follow-ups-tool';
export { createUpdateTaskStatusTool, type UpdateTaskStatusArgs } from './update-task-status-tool';
export { createAddDiffCommentTool, type AddDiffCommentArgs, type AddDiffCommentDeps } from './add-diff-comment-tool';
export {
    getFileDiff,
    parseUnifiedDiff,
    mapLinesToDiffIndices,
    extractTextFromDiffLines,
    type DiffLineMapping,
    type ParsedDiffLine,
} from './diff-line-mapper';
