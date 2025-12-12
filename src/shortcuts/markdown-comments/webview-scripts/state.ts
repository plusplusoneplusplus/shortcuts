/**
 * Webview state management
 * 
 * Centralized state for the webview, including content, comments, and settings.
 */

import { MarkdownComment } from '../types';
import { 
    VsCodeApi, 
    WebviewSettings, 
    PendingSelection, 
    SavedSelection, 
    ActiveCommentBubble 
} from './types';

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
    
    // Mermaid state
    private _mermaidLoaded: boolean = false;
    private _mermaidLoading: boolean = false;
    private _pendingMermaidBlocks: Array<() => void> = [];
    
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

