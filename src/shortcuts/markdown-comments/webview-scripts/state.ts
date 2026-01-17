/**
 * Webview state management
 * 
 * Centralized state for the webview, including content, comments, and settings.
 */

import { MarkdownComment } from '../types';
import { LineChange } from '../line-change-tracker';
import {
    VsCodeApi,
    WebviewSettings,
    PendingSelection,
    SavedSelection,
    ActiveCommentBubble
} from './types';

/**
 * View mode for the editor
 * - 'review': Rich markdown rendering with comments support
 * - 'source': Plain text source view (raw markdown)
 */
export type ViewMode = 'review' | 'source';

/**
 * Webview state singleton
 */
class WebviewStateManager {
    // VS Code API
    private _vscode: VsCodeApi | null = null;
    
    // Content state
    private _currentContent: string = '';
    private _comments: MarkdownComment[] = [];
    private _filePath: string = '';
    private _fileDir: string = '';
    private _workspaceRoot: string = '';
    
    // Settings
    private _settings: WebviewSettings = { showResolved: true };
    
    // UI state
    private _pendingSelection: PendingSelection | null = null;
    private _editingCommentId: string | null = null;
    private _activeCommentBubble: ActiveCommentBubble | null = null;
    private _savedSelectionForContextMenu: SavedSelection | null = null;
    
    // View mode state
    private _viewMode: ViewMode = 'review';
    
    // Mermaid state
    private _mermaidLoaded: boolean = false;
    private _mermaidLoading: boolean = false;
    private _pendingMermaidBlocks: Array<() => void> = [];
    
    // Interaction state (for preventing click-to-close during resize/drag)
    private _isInteracting: boolean = false;
    private _interactionEndTimeout: ReturnType<typeof setTimeout> | null = null;

    // Line change tracking (for showing change indicators on external edits)
    private _lineChanges: Map<number, 'added' | 'modified'> = new Map();
    
    // Getters
    get vscode(): VsCodeApi {
        if (!this._vscode) {
            throw new Error('VS Code API not initialized');
        }
        return this._vscode;
    }
    
    get currentContent(): string {
        return this._currentContent;
    }
    
    get comments(): MarkdownComment[] {
        return this._comments;
    }
    
    get filePath(): string {
        return this._filePath;
    }
    
    get fileDir(): string {
        return this._fileDir;
    }
    
    get workspaceRoot(): string {
        return this._workspaceRoot;
    }
    
    get settings(): WebviewSettings {
        return this._settings;
    }
    
    get pendingSelection(): PendingSelection | null {
        return this._pendingSelection;
    }
    
    get editingCommentId(): string | null {
        return this._editingCommentId;
    }
    
    get activeCommentBubble(): ActiveCommentBubble | null {
        return this._activeCommentBubble;
    }
    
    get savedSelectionForContextMenu(): SavedSelection | null {
        return this._savedSelectionForContextMenu;
    }
    
    get mermaidLoaded(): boolean {
        return this._mermaidLoaded;
    }
    
    get mermaidLoading(): boolean {
        return this._mermaidLoading;
    }
    
    get pendingMermaidBlocks(): Array<() => void> {
        return this._pendingMermaidBlocks;
    }
    
    get isInteracting(): boolean {
        return this._isInteracting;
    }
    
    get viewMode(): ViewMode {
        return this._viewMode;
    }

    /**
     * Check if there are any line changes being tracked
     */
    get hasLineChanges(): boolean {
        return this._lineChanges.size > 0;
    }

    // Setters
    setVscode(api: VsCodeApi): void {
        this._vscode = api;
    }
    
    setCurrentContent(content: string): void {
        this._currentContent = content;
    }
    
    setComments(comments: MarkdownComment[]): void {
        this._comments = comments;
    }
    
    setFilePath(path: string): void {
        this._filePath = path;
    }
    
    setFileDir(dir: string): void {
        this._fileDir = dir;
    }
    
    setWorkspaceRoot(root: string): void {
        this._workspaceRoot = root;
    }
    
    setSettings(settings: Partial<WebviewSettings>): void {
        this._settings = { ...this._settings, ...settings };
    }
    
    setPendingSelection(selection: PendingSelection | null): void {
        this._pendingSelection = selection;
    }
    
    setEditingCommentId(id: string | null): void {
        this._editingCommentId = id;
    }
    
    setActiveCommentBubble(bubble: ActiveCommentBubble | null): void {
        this._activeCommentBubble = bubble;
    }
    
    setSavedSelectionForContextMenu(selection: SavedSelection | null): void {
        this._savedSelectionForContextMenu = selection;
    }
    
    setMermaidLoaded(loaded: boolean): void {
        this._mermaidLoaded = loaded;
    }
    
    setMermaidLoading(loading: boolean): void {
        this._mermaidLoading = loading;
    }
    
    addPendingMermaidBlock(callback: () => void): void {
        this._pendingMermaidBlocks.push(callback);
    }
    
    clearPendingMermaidBlocks(): void {
        this._pendingMermaidBlocks = [];
    }
    
    setViewMode(mode: ViewMode): void {
        this._viewMode = mode;
    }
    
    /**
     * Mark the start of a user interaction (resize/drag) that should prevent click-to-close
     */
    startInteraction(): void {
        if (this._interactionEndTimeout) {
            clearTimeout(this._interactionEndTimeout);
            this._interactionEndTimeout = null;
        }
        this._isInteracting = true;
    }
    
    /**
     * Mark the end of a user interaction, with a small delay to prevent click events
     */
    endInteraction(): void {
        // Delay clearing the interaction flag to allow click events to be ignored
        this._interactionEndTimeout = setTimeout(() => {
            this._isInteracting = false;
            this._interactionEndTimeout = null;
        }, 100);
    }

    /**
     * Set line changes from an external edit.
     * Replaces any existing line changes.
     */
    setLineChanges(changes: LineChange[]): void {
        this._lineChanges.clear();
        for (const change of changes) {
            this._lineChanges.set(change.line, change.type);
        }
    }

    /**
     * Get the change type for a specific line.
     * @returns 'added', 'modified', or null if unchanged
     */
    getLineChangeType(line: number): 'added' | 'modified' | null {
        return this._lineChanges.get(line) || null;
    }

    /**
     * Clear all line change indicators.
     * Called when user makes an edit (acknowledging they've seen the changes).
     */
    clearLineChanges(): void {
        this._lineChanges.clear();
    }

    // Utility methods
    findCommentById(id: string): MarkdownComment | undefined {
        return this._comments.find(c => c.id === id);
    }
    
    getCommentsForLine(lineNum: number): MarkdownComment[] {
        return this._comments.filter(c => 
            c.selection.startLine <= lineNum && 
            c.selection.endLine >= lineNum
        );
    }
    
    getVisibleCommentsForLine(lineNum: number): MarkdownComment[] {
        return this.getCommentsForLine(lineNum).filter(c => 
            this._settings.showResolved || c.status !== 'resolved'
        );
    }
}

// Export singleton instance
export const state = new WebviewStateManager();

