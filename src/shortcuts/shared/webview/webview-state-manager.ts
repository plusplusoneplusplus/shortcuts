/**
 * WebviewStateManager
 * 
 * Provides centralized state management for webview panels including:
 * - Tracking active webview panels by key (usually file path)
 * - Storing/restoring webview state for serialization
 * - Managing dirty state (unsaved changes)
 * - Panel lifecycle management (dispose, visibility)
 * 
 * Generic type T represents the state shape stored per webview.
 */

import * as vscode from 'vscode';

/**
 * Event data for state change events
 */
export interface StateChangeEvent<T> {
    key: string;
    state: T | undefined;
    previousState: T | undefined;
}

/**
 * Event data for dirty state change events
 */
export interface DirtyStateChangeEvent {
    key: string;
    isDirty: boolean;
}

/**
 * Options for WebviewStateManager
 */
export interface WebviewStateManagerOptions {
    /** Whether to auto-dispose panels when they become orphaned */
    autoDisposeOrphanedPanels?: boolean;
}

/**
 * Manages state for multiple webview panels
 * @template T The type of state stored per webview
 */
export class WebviewStateManager<T> implements vscode.Disposable {
    /** Active webview panels keyed by identifier */
    private readonly panels = new Map<string, vscode.WebviewPanel>();
    
    /** State stored per panel keyed by identifier */
    private readonly states = new Map<string, T>();
    
    /** Dirty state per panel keyed by identifier */
    private readonly dirtyStates = new Map<string, boolean>();
    
    /** Original titles per panel for dirty indicator */
    private readonly originalTitles = new Map<string, string>();
    
    /** Disposables for cleanup */
    private readonly disposables: vscode.Disposable[] = [];
    
    /** Event emitters */
    private readonly _onDidChangeState = new vscode.EventEmitter<StateChangeEvent<T>>();
    readonly onDidChangeState = this._onDidChangeState.event;
    
    private readonly _onDidChangeDirtyState = new vscode.EventEmitter<DirtyStateChangeEvent>();
    readonly onDidChangeDirtyState = this._onDidChangeDirtyState.event;
    
    private readonly _onDidDisposePanel = new vscode.EventEmitter<string>();
    readonly onDidDisposePanel = this._onDidDisposePanel.event;

    constructor(private readonly options: WebviewStateManagerOptions = {}) {
        this.disposables.push(
            this._onDidChangeState,
            this._onDidChangeDirtyState,
            this._onDidDisposePanel
        );
    }

    /**
     * Register a webview panel with this manager
     * @param key Unique identifier for the panel (usually file path)
     * @param panel The webview panel
     * @param initialState Optional initial state
     */
    registerPanel(key: string, panel: vscode.WebviewPanel, initialState?: T): void {
        // Clean up any existing panel with same key
        const existing = this.panels.get(key);
        if (existing && existing !== panel) {
            this.unregisterPanel(key);
        }

        this.panels.set(key, panel);
        this.originalTitles.set(key, panel.title);
        
        if (initialState !== undefined) {
            this.setState(key, initialState);
        }

        // Set up dispose listener
        const disposeListener = panel.onDidDispose(() => {
            this.unregisterPanel(key);
            this._onDidDisposePanel.fire(key);
        });

        // Store the disposable so we can clean it up later
        // Note: We don't add to this.disposables as it's panel-specific
        panel.onDidDispose(() => disposeListener.dispose());
    }

    /**
     * Unregister a panel and clean up associated state
     * @param key Panel identifier
     */
    unregisterPanel(key: string): void {
        this.panels.delete(key);
        
        const previousState = this.states.get(key);
        this.states.delete(key);
        this.dirtyStates.delete(key);
        this.originalTitles.delete(key);

        if (previousState !== undefined) {
            this._onDidChangeState.fire({
                key,
                state: undefined,
                previousState
            });
        }
    }

    /**
     * Get a registered panel by key
     * @param key Panel identifier
     */
    getPanel(key: string): vscode.WebviewPanel | undefined {
        return this.panels.get(key);
    }

    /**
     * Check if a panel is registered
     * @param key Panel identifier
     */
    hasPanel(key: string): boolean {
        return this.panels.has(key);
    }

    /**
     * Get all registered panel keys
     */
    getPanelKeys(): string[] {
        return Array.from(this.panels.keys());
    }

    /**
     * Get total number of registered panels
     */
    get panelCount(): number {
        return this.panels.size;
    }

    /**
     * Set state for a panel
     * @param key Panel identifier
     * @param state New state
     */
    setState(key: string, state: T): void {
        const previousState = this.states.get(key);
        this.states.set(key, state);
        
        this._onDidChangeState.fire({
            key,
            state,
            previousState
        });
    }

    /**
     * Get state for a panel
     * @param key Panel identifier
     */
    getState(key: string): T | undefined {
        return this.states.get(key);
    }

    /**
     * Update partial state for a panel (merge with existing)
     * @param key Panel identifier
     * @param partialState Partial state to merge
     */
    updateState(key: string, partialState: Partial<T>): void {
        const currentState = this.states.get(key);
        if (currentState) {
            const newState = { ...currentState, ...partialState };
            this.setState(key, newState);
        }
    }

    /**
     * Set dirty state for a panel
     * @param key Panel identifier
     * @param isDirty Whether the panel has unsaved changes
     */
    setDirtyState(key: string, isDirty: boolean): void {
        const previousDirty = this.dirtyStates.get(key) ?? false;
        if (previousDirty !== isDirty) {
            this.dirtyStates.set(key, isDirty);
            this.updatePanelTitleDirtyIndicator(key, isDirty);
            
            this._onDidChangeDirtyState.fire({ key, isDirty });
        }
    }

    /**
     * Get dirty state for a panel
     * @param key Panel identifier
     */
    isDirty(key: string): boolean {
        return this.dirtyStates.get(key) ?? false;
    }

    /**
     * Update panel title to show dirty indicator (dot) following VS Code conventions
     * @param key Panel identifier
     * @param isDirty Whether to show dirty indicator
     */
    private updatePanelTitleDirtyIndicator(key: string, isDirty: boolean): void {
        const panel = this.panels.get(key);
        if (!panel) return;

        const originalTitle = this.originalTitles.get(key) ?? panel.title;

        if (isDirty) {
            // VS Code shows dirty indicator as a dot before the title
            panel.title = `● ${originalTitle}`;
        } else {
            panel.title = originalTitle;
        }
    }

    /**
     * Update the original title for a panel
     * Useful when the title should change (e.g., file renamed)
     * @param key Panel identifier
     * @param newTitle New title
     */
    updatePanelTitle(key: string, newTitle: string): void {
        const panel = this.panels.get(key);
        if (!panel) return;

        this.originalTitles.set(key, newTitle);
        const isDirty = this.isDirty(key);
        panel.title = isDirty ? `● ${newTitle}` : newTitle;
    }

    /**
     * Reveal a panel
     * @param key Panel identifier
     * @param viewColumn View column to reveal in
     */
    revealPanel(key: string, viewColumn?: vscode.ViewColumn): void {
        const panel = this.panels.get(key);
        if (panel) {
            panel.reveal(viewColumn);
        }
    }

    /**
     * Post a message to a panel's webview
     * @param key Panel identifier
     * @param message Message to send
     * @returns Whether the message was sent (panel exists)
     */
    postMessage(key: string, message: unknown): boolean {
        const panel = this.panels.get(key);
        if (panel) {
            panel.webview.postMessage(message);
            return true;
        }
        return false;
    }

    /**
     * Broadcast a message to all registered panels
     * @param message Message to send
     */
    broadcastMessage(message: unknown): void {
        for (const panel of this.panels.values()) {
            panel.webview.postMessage(message);
        }
    }

    /**
     * Iterate over all panels
     * @param callback Function to call for each panel
     */
    forEachPanel(callback: (key: string, panel: vscode.WebviewPanel, state: T | undefined) => void): void {
        for (const [key, panel] of this.panels) {
            callback(key, panel, this.states.get(key));
        }
    }

    /**
     * Dispose all panels and clean up
     */
    dispose(): void {
        // Dispose all panels
        for (const panel of this.panels.values()) {
            panel.dispose();
        }
        
        // Clear all maps
        this.panels.clear();
        this.states.clear();
        this.dirtyStates.clear();
        this.originalTitles.clear();
        
        // Dispose event emitters
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
}

/**
 * Preview panel manager for single-tab preview behavior
 * Similar to VS Code's preview mode (italic title) where clicking a new file
 * replaces the preview content rather than opening a new tab.
 * 
 * @template T State type
 */
export class PreviewPanelManager<T> implements vscode.Disposable {
    private stateManager: WebviewStateManager<T>;
    private previewPanel: vscode.WebviewPanel | undefined;
    private previewKey: string | undefined;
    private isPreviewMode: boolean = false;
    
    private readonly _onDidPinPreview = new vscode.EventEmitter<string>();
    readonly onDidPinPreview = this._onDidPinPreview.event;

    constructor(stateManager: WebviewStateManager<T>) {
        this.stateManager = stateManager;
    }

    /**
     * Check if currently in preview mode
     */
    get isInPreviewMode(): boolean {
        return this.isPreviewMode && this.previewPanel !== undefined;
    }

    /**
     * Get the current preview key
     */
    get currentPreviewKey(): string | undefined {
        return this.isPreviewMode ? this.previewKey : undefined;
    }

    /**
     * Get the current preview panel
     */
    get currentPreviewPanel(): vscode.WebviewPanel | undefined {
        return this.isPreviewMode ? this.previewPanel : undefined;
    }

    /**
     * Set a panel as the preview panel
     * @param key Panel identifier
     * @param panel The panel
     */
    setPreview(key: string, panel: vscode.WebviewPanel): void {
        this.previewPanel = panel;
        this.previewKey = key;
        this.isPreviewMode = true;
    }

    /**
     * Clear the preview panel state without disposing
     * Called when a new non-preview panel is created
     */
    clearPreview(): void {
        this.previewPanel = undefined;
        this.previewKey = undefined;
        this.isPreviewMode = false;
    }

    /**
     * Pin the current preview panel (convert to permanent tab)
     */
    pinPreview(): void {
        if (!this.isPreviewMode || !this.previewKey) return;

        const key = this.previewKey;
        this._onDidPinPreview.fire(key);
        this.clearPreview();
    }

    /**
     * Check if a specific panel is the current preview
     * @param panel Panel to check
     */
    isPreviewPanel(panel: vscode.WebviewPanel): boolean {
        return this.isPreviewMode && this.previewPanel === panel;
    }

    /**
     * Replace preview content with new content
     * Returns true if preview was reused, false if not in preview mode
     * @param key New key for the content
     * @param state New state
     * @param updatePanel Callback to update the panel content
     */
    reusePreview(
        key: string,
        state: T,
        updatePanel: (panel: vscode.WebviewPanel) => void
    ): boolean {
        if (!this.isPreviewMode || !this.previewPanel || !this.previewKey) {
            return false;
        }

        // Unregister old key
        this.stateManager.unregisterPanel(this.previewKey);

        // Update to new key
        this.previewKey = key;
        this.stateManager.registerPanel(key, this.previewPanel, state);

        // Update panel content
        updatePanel(this.previewPanel);

        return true;
    }

    dispose(): void {
        this._onDidPinPreview.dispose();
    }
}
