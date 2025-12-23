/**
 * Webview state management
 */

import {
    DiffComment,
    DiffCommentsSettings,
    DiffGitContext,
    SelectionState
} from './types';

/**
 * View mode type
 */
export type ViewMode = 'split' | 'inline';

/**
 * Application state
 */
export interface AppState {
    filePath: string;
    oldContent: string;
    newContent: string;
    gitContext: DiffGitContext;
    comments: DiffComment[];
    settings: DiffCommentsSettings;
    currentSelection: SelectionState | null;
    isCommentPanelOpen: boolean;
    editingCommentId: string | null;
    viewMode: ViewMode;
    ignoreWhitespace: boolean;
    /** Whether the new content is editable (uncommitted changes) */
    isEditable: boolean;
}

/**
 * Default settings
 */
const DEFAULT_SETTINGS: DiffCommentsSettings = {
    showResolved: true,
    highlightColor: 'rgba(255, 235, 59, 0.3)',
    resolvedHighlightColor: 'rgba(76, 175, 80, 0.2)'
};

/**
 * Create initial state from window data
 */
export function createInitialState(): AppState {
    const initialData = window.initialData || {
        filePath: '',
        oldContent: '',
        newContent: '',
        gitContext: {
            repositoryRoot: '',
            repositoryName: '',
            oldRef: '',
            newRef: '',
            wasStaged: false
        },
        isEditable: false
    };

    return {
        filePath: initialData.filePath,
        oldContent: initialData.oldContent,
        newContent: initialData.newContent,
        gitContext: initialData.gitContext,
        comments: [],
        settings: DEFAULT_SETTINGS,
        currentSelection: null,
        isCommentPanelOpen: false,
        editingCommentId: null,
        viewMode: 'split' as ViewMode,
        ignoreWhitespace: false,
        isEditable: initialData.isEditable || false
    };
}

/**
 * Global state instance
 */
let state: AppState = createInitialState();

/**
 * Get current state
 */
export function getState(): AppState {
    return state;
}

/**
 * Update state
 */
export function updateState(updates: Partial<AppState>): void {
    state = { ...state, ...updates };
}

/**
 * Set comments
 */
export function setComments(comments: DiffComment[]): void {
    state.comments = comments;
}

/**
 * Set settings
 */
export function setSettings(settings: DiffCommentsSettings): void {
    state.settings = settings;
}

/**
 * Set current selection
 */
export function setCurrentSelection(selection: SelectionState | null): void {
    state.currentSelection = selection;
}

/**
 * Set comment panel state
 */
export function setCommentPanelOpen(isOpen: boolean): void {
    state.isCommentPanelOpen = isOpen;
}

/**
 * Set editing comment ID
 */
export function setEditingCommentId(id: string | null): void {
    state.editingCommentId = id;
}

/**
 * Get comments for a specific line
 */
export function getCommentsForLine(
    side: 'old' | 'new',
    lineNumber: number
): DiffComment[] {
    return state.comments.filter(comment => {
        if (side === 'old') {
            const startLine = comment.selection.oldStartLine;
            const endLine = comment.selection.oldEndLine;
            if (startLine !== null && endLine !== null) {
                return lineNumber >= startLine && lineNumber <= endLine;
            }
        } else {
            const startLine = comment.selection.newStartLine;
            const endLine = comment.selection.newEndLine;
            if (startLine !== null && endLine !== null) {
                return lineNumber >= startLine && lineNumber <= endLine;
            }
        }
        return false;
    });
}

/**
 * Get visible comments (respecting showResolved setting)
 */
export function getVisibleComments(): DiffComment[] {
    if (state.settings.showResolved) {
        return state.comments;
    }
    return state.comments.filter(c => c.status !== 'resolved');
}

/**
 * Get current view mode
 */
export function getViewMode(): ViewMode {
    return state.viewMode;
}

/**
 * Set view mode
 */
export function setViewMode(mode: ViewMode): void {
    state.viewMode = mode;
}

/**
 * Toggle view mode between split and inline
 */
export function toggleViewMode(): ViewMode {
    state.viewMode = state.viewMode === 'split' ? 'inline' : 'split';
    return state.viewMode;
}

/**
 * Get ignore whitespace setting
 */
export function getIgnoreWhitespace(): boolean {
    return state.ignoreWhitespace;
}

/**
 * Set ignore whitespace setting
 */
export function setIgnoreWhitespace(ignore: boolean): void {
    state.ignoreWhitespace = ignore;
}

/**
 * Toggle ignore whitespace setting
 */
export function toggleIgnoreWhitespace(): boolean {
    state.ignoreWhitespace = !state.ignoreWhitespace;
    return state.ignoreWhitespace;
}

/**
 * Get whether content is editable
 */
export function getIsEditable(): boolean {
    return state.isEditable;
}

/**
 * Set whether content is editable
 */
export function setIsEditable(editable: boolean): void {
    state.isEditable = editable;
}

