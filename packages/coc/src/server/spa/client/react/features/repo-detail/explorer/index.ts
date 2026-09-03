export { ExplorerPanel } from './ExplorerPanel';
export type { ExplorerPanelProps } from './ExplorerPanel';
export { FileTree, flattenVisibleNodes, filterEntries, hasMatchingDescendant } from './FileTree';
export type { FileTreeProps } from './FileTree';
export { TreeNode } from './TreeNode';
export type { TreeNodeProps } from './TreeNode';
export { PreviewPane } from './PreviewPane';
export type { PreviewPaneProps } from './PreviewPane';
export { MonacoFileEditor, getMonacoLanguage, revealEditorLine, buildHighlightDecorations, EDITOR_HIGHLIGHT_CLASS } from './MonacoFileEditor';
export type { MonacoFileEditorProps, EditorHighlightRange } from './MonacoFileEditor';
export { SearchBar, autoGrowRows, SEARCH_BAR_MAX_ROWS } from './SearchBar';
export type { SearchBarProps, SearchBarToggle } from './SearchBar';
export { SearchFilters } from './SearchFilters';
export type { SearchFiltersProps } from './SearchFilters';
export { ReplaceRow } from './ReplaceRow';
export type { ReplaceRowProps } from './ReplaceRow';
export { ContentSearchToolbar } from './ContentSearchToolbar';
export type { ContentSearchToolbarProps } from './ContentSearchToolbar';
export { ContentSearchPanel, SEARCH_DEBOUNCE_MS, MULTILINE_REPLACE_NOTICE, REPLACE_CONFIRM_THRESHOLD, classifySearchError, keepCollapsedPaths } from './ContentSearchPanel';
export { buildReplaceFiles, countReplaceTargets, replaceConfirmMessage, describeReplaceResult } from './contentReplaceRequest';
export type { ContentSearchPanelProps } from './ContentSearchPanel';
export { ContentSearchResults, groupMatchesByFile, splitMatchText, trimMatchIndent, toggleCollapsedPath, buildSearchTree, collapsibleTreePaths, matchDismissKey, applyDismissals, dismissRow, flattenVisibleRows, rowAfterDismissal, stepToMatch, dirRowKey, fileRowKey, matchRowKey } from './ContentSearchResults';
export type { ContentSearchResultsProps, ContentSearchFileGroup, MatchTextParts, ContentSearchTreeNode, ContentSearchDirNode, ContentSearchFileNode, ContentSearchRow, ContentSearchRowKind } from './ContentSearchResults';
export { SearchEditorPane } from './SearchEditorPane';
export type { SearchEditorPaneProps } from './SearchEditorPane';
export { buildSearchEditorText } from './searchEditorText';
export type { SearchEditorInput } from './searchEditorText';
export { QuickOpen, highlightMatches, splitIndices } from './QuickOpen';
export type { QuickOpenProps } from './QuickOpen';
export { ExactOpen, exactMatchScore } from './ExactOpen';
export type { ExactOpenProps } from './ExactOpen';
export { Breadcrumbs } from './Breadcrumbs';
export type { BreadcrumbsProps } from './Breadcrumbs';
export {
    EMPTY_EXPLORER_TABS,
    fileTabId,
    searchTabId,
    activeTab,
    findTab,
    hasFileTab,
    previewTab,
    openFileTab,
    openSearchTab,
    activateTab,
    pinTab,
    clearTabRevealLine,
    closeTab,
    closeTabs,
    otherTabIds,
    tabIdsToRight,
    allTabIds,
    moveTab,
    cycleTabs,
    tabLabels,
    serializeExplorerTabs,
    parseExplorerTabs,
} from './explorerTabsModel';
export type { ExplorerTab, ExplorerTabKind, ExplorerTabsState, TabCycleDirection, OpenFileTabInput, OpenSearchTabInput } from './explorerTabsModel';
export { ExplorerTabStrip, tabTooltip } from './ExplorerTabStrip';
export type { ExplorerTabStripProps } from './ExplorerTabStrip';
export { useExplorerTabs } from './useExplorerTabs';
export type { ExplorerTabsApi } from './useExplorerTabs';
export type { TreeEntry, ExplorerView, ContentSearchModes, ContentSearchFilters, ContentSearchReplaceState, ContentSearchResultView, ContentSearchStatus, ContentSearchErrorKind } from './types';
export { DEFAULT_CONTENT_SEARCH_MODES, DEFAULT_CONTENT_SEARCH_FILTERS, DEFAULT_CONTENT_SEARCH_REPLACE, DEFAULT_CONTENT_SEARCH_RESULT_VIEW, parseGlobList, contentSearchFiltersActive, isMultiLineQuery } from './types';
