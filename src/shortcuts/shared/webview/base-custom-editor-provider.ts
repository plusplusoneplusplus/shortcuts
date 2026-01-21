/**
 * BaseCustomEditorProvider
 * 
 * Abstract base class for VSCode Custom Text Editor providers using the
 * Template Method pattern. Provides common functionality for:
 * - Webview setup and configuration
 * - State management (active panels, dirty tracking)
 * - Message handling
 * - Lifecycle management
 * - Theme and configuration change handling
 * 
 * Subclasses implement abstract methods to customize behavior while
 * reusing the shared infrastructure.
 * 
 * @example
 * ```typescript
 * class MyEditorProvider extends BaseCustomEditorProvider<MyState, MyMessage> {
 *     public static readonly viewType = 'myEditor';
 *     
 *     protected async getInitialState(document: vscode.TextDocument): Promise<MyState> {
 *         return { content: document.getText() };
 *     }
 *     
 *     protected getWebviewContent(webview: vscode.Webview): string {
 *         return `<html>...</html>`;
 *     }
 *     
 *     protected setupMessageHandlers(router: WebviewMessageRouter<MyMessage>): void {
 *         router.on('save', async (msg) => { ... });
 *     }
 * }
 * ```
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getWorkspaceRoot, getWorkspaceRootUri } from '../workspace-utils';
import { WebviewSetupHelper, WebviewSetupOptions, WebviewThemeKind } from './webview-setup-helper';
import { WebviewStateManager, PreviewPanelManager } from './webview-state-manager';
import { BaseWebviewMessage, WebviewMessageRouter } from './webview-message-router';

/**
 * Context passed to message handlers
 */
export interface MessageHandlerContext<TState> {
    /** The document being edited */
    document: vscode.TextDocument;
    /** Relative path from workspace root */
    relativePath: string;
    /** Absolute path to the file's directory */
    fileDir: string;
    /** Workspace root path */
    workspaceRoot: string;
    /** The webview panel */
    panel: vscode.WebviewPanel;
    /** Current state */
    state: TState | undefined;
    /** Update the webview with new state */
    updateWebview: () => void;
    /** Mark the document as having changes from the webview */
    setWebviewEdit: () => void;
}

/**
 * Options for the base custom editor provider
 */
export interface BaseEditorProviderOptions extends WebviewSetupOptions {
    /** Whether to support preview mode (single reusable tab) */
    enablePreviewMode?: boolean;
    /** Whether to track dirty state */
    trackDirtyState?: boolean;
    /** Timeout in ms for debouncing webview-initiated edits */
    webviewEditDebounceMs?: number;
}

/**
 * Default options for base editor provider
 */
const DEFAULT_EDITOR_OPTIONS: Required<BaseEditorProviderOptions> = {
    enableScripts: true,
    retainContextWhenHidden: true,
    enableFindWidget: true,
    enableCommandUris: false,
    additionalResourceRoots: undefined as unknown as vscode.Uri[],
    enablePreviewMode: false,
    trackDirtyState: true,
    webviewEditDebounceMs: 200
};

/**
 * Abstract base class for custom text editor providers
 * @template TState Type of state stored per editor
 * @template TMessage Type of messages from webview (must have 'type' field)
 */
export abstract class BaseCustomEditorProvider<
    TState,
    TMessage extends BaseWebviewMessage
> implements vscode.CustomTextEditorProvider, vscode.Disposable {
    
    /** State manager for tracking panels and state */
    protected readonly stateManager: WebviewStateManager<TState>;
    
    /** Preview panel manager (only used if enablePreviewMode is true) */
    protected readonly previewManager?: PreviewPanelManager<TState>;
    
    /** Webview setup helper */
    protected readonly setupHelper: WebviewSetupHelper;
    
    /** Disposables for cleanup */
    protected readonly disposables: vscode.Disposable[] = [];
    
    /** Merged options */
    protected readonly options: Required<BaseEditorProviderOptions>;

    /** Scroll requests pending for when file opens */
    private pendingScrollRequests = new Map<string, string>();

    constructor(
        protected readonly context: vscode.ExtensionContext,
        options: BaseEditorProviderOptions = {}
    ) {
        this.options = { ...DEFAULT_EDITOR_OPTIONS, ...options };
        this.stateManager = new WebviewStateManager<TState>();
        this.setupHelper = new WebviewSetupHelper(context.extensionUri);
        
        if (this.options.enablePreviewMode) {
            this.previewManager = new PreviewPanelManager<TState>(this.stateManager);
            this.disposables.push(this.previewManager);
        }
        
        this.disposables.push(this.stateManager);
    }

    /**
     * Get the view type for this editor (must be unique)
     * Subclasses should define this as a static property
     */
    protected abstract get viewType(): string;

    /**
     * Get initial state for a document
     * Called when the editor is first opened
     */
    protected abstract getInitialState(document: vscode.TextDocument): Promise<TState>;

    /**
     * Generate the HTML content for the webview
     * @param webview The webview to generate content for
     * @param state Current state
     */
    protected abstract getWebviewContent(webview: vscode.Webview, state: TState): string;

    /**
     * Setup message handlers for the router
     * @param router The message router
     * @param context Context for message handling
     */
    protected abstract setupMessageHandlers(
        router: WebviewMessageRouter<TMessage, MessageHandlerContext<TState>>,
        context: MessageHandlerContext<TState>
    ): void;

    /**
     * Create the update message to send to webview
     * @param state Current state
     * @param filePath Relative file path
     * @param additionalData Additional data to include
     */
    protected abstract createUpdateMessage(
        state: TState,
        filePath: string,
        additionalData?: Record<string, unknown>
    ): object;

    /**
     * Get additional resource roots beyond the defaults
     * Override to add file-specific roots (e.g., file directory for images)
     */
    protected getAdditionalResourceRoots(_document: vscode.TextDocument): vscode.Uri[] {
        return [];
    }

    /**
     * Called when a custom editor is opened
     * Implements the Template Method pattern
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const workspaceRoot = getWorkspaceRoot() || '';
        const workspaceUri = getWorkspaceRootUri();
        const relativePath = path.relative(workspaceRoot, document.uri.fsPath);
        const normalizedFilePath = document.uri.fsPath.replace(/\\/g, '/');
        const fileDir = path.dirname(document.uri.fsPath);

        // Setup webview with resource roots
        const additionalRoots = this.getAdditionalResourceRoots(document);
        if (workspaceUri) {
            additionalRoots.push(workspaceUri);
        }
        additionalRoots.push(vscode.Uri.file(fileDir));

        this.setupHelper.configureWebviewOptions(webviewPanel.webview, {
            ...this.options,
            additionalResourceRoots: additionalRoots
        });

        // Set tab title
        const fileName = path.basename(document.uri.fsPath);
        webviewPanel.title = this.getTabTitle(fileName);

        // Get initial state
        const initialState = await this.getInitialState(document);

        // Register with state manager
        this.stateManager.registerPanel(normalizedFilePath, webviewPanel, initialState);

        // Track webview-initiated edits
        let webviewEditUntil = 0;
        const setWebviewEdit = () => {
            webviewEditUntil = Date.now() + this.options.webviewEditDebounceMs;
        };

        // Create update function
        const updateWebview = () => {
            const state = this.stateManager.getState(normalizedFilePath);
            if (state) {
                const message = this.createUpdateMessage(state, relativePath);
                webviewPanel.webview.postMessage(message);
            }
        };

        // Create message handler context
        // Use a closure to capture the stateManager reference for the getter
        const stateManager = this.stateManager;
        const handlerContext: MessageHandlerContext<TState> = {
            document,
            relativePath,
            fileDir,
            workspaceRoot,
            panel: webviewPanel,
            get state() { return stateManager.getState(normalizedFilePath); },
            updateWebview,
            setWebviewEdit
        };

        // Create message router
        const router = new WebviewMessageRouter<TMessage, MessageHandlerContext<TState>>({
            logUnhandledMessages: true
        });

        // Setup standard handlers
        this.setupStandardMessageHandlers(router, handlerContext, normalizedFilePath);

        // Setup custom handlers from subclass
        this.setupMessageHandlers(router, handlerContext);

        // Listen for messages
        const messageDisposable = webviewPanel.webview.onDidReceiveMessage(
            (message: TMessage) => router.route(message, handlerContext)
        );

        // Set initial HTML
        webviewPanel.webview.html = this.getWebviewContent(webviewPanel.webview, initialState);

        // Setup document change listener
        const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                const now = Date.now();
                if (now < webviewEditUntil) {
                    // Skip re-rendering for webview-initiated edits
                    return;
                }
                // Handle external changes
                this.onDocumentChanged(document, normalizedFilePath);
            }
        });

        // Setup config change listener
        const configChangeDisposable = this.createConfigurationChangeListener(
            normalizedFilePath,
            webviewPanel,
            updateWebview
        );

        // Setup theme change listener
        const themeChangeDisposable = this.createThemeChangeListener(
            normalizedFilePath,
            webviewPanel,
            initialState,
            updateWebview
        );

        // Cleanup on dispose
        webviewPanel.onDidDispose(() => {
            messageDisposable.dispose();
            documentChangeDisposable.dispose();
            configChangeDisposable.dispose();
            themeChangeDisposable.dispose();
            router.dispose();
        });
    }

    /**
     * Setup standard message handlers for common operations
     */
    private setupStandardMessageHandlers(
        router: WebviewMessageRouter<TMessage, MessageHandlerContext<TState>>,
        context: MessageHandlerContext<TState>,
        filePath: string
    ): void {
        // Handle 'ready' and 'requestState' messages
        const handleReady = (_msg: TMessage, ctx: MessageHandlerContext<TState>) => {
            ctx.updateWebview();
            
            // Check for pending scroll requests
            const pendingScrollId = this.pendingScrollRequests.get(filePath);
            if (pendingScrollId) {
                this.pendingScrollRequests.delete(filePath);
                setTimeout(() => {
                    ctx.panel.webview.postMessage({
                        type: 'scrollToComment',
                        commentId: pendingScrollId
                    });
                }, 100);
            }
        };

        // Type assertion needed for generic compatibility
        router.on('ready' as TMessage['type'], handleReady as any);
        router.on('requestState' as TMessage['type'], handleReady as any);
    }

    /**
     * Handle document changes from external sources
     * Override to implement custom behavior (e.g., comment relocation)
     */
    protected onDocumentChanged(
        _document: vscode.TextDocument,
        _filePath: string
    ): void {
        // Default implementation does nothing
        // Subclasses can override for custom behavior
    }

    /**
     * Create configuration change listener
     * Override to watch for specific config sections
     */
    protected createConfigurationChangeListener(
        _filePath: string,
        _panel: vscode.WebviewPanel,
        _updateWebview: () => void
    ): vscode.Disposable {
        // Default: no configuration watching
        return { dispose: () => {} };
    }

    /**
     * Create theme change listener
     * Override to handle theme changes (e.g., for 'auto' theme mode)
     */
    protected createThemeChangeListener(
        _filePath: string,
        _panel: vscode.WebviewPanel,
        _state: TState,
        _updateWebview: () => void
    ): vscode.Disposable {
        // Default: no theme watching
        return { dispose: () => {} };
    }

    /**
     * Get the tab title for a file
     * Override to customize title format
     */
    protected getTabTitle(fileName: string): string {
        return fileName;
    }

    /**
     * Request to scroll to a comment when file opens
     * @param filePath File path (normalized)
     * @param commentId Comment ID to scroll to
     */
    public requestScrollToComment(filePath: string, commentId: string): void {
        const normalizedPath = filePath.replace(/\\/g, '/');
        
        const existingPanel = this.stateManager.getPanel(normalizedPath);
        if (existingPanel) {
            existingPanel.webview.postMessage({
                type: 'scrollToComment',
                commentId
            });
        } else {
            this.pendingScrollRequests.set(normalizedPath, commentId);
        }
    }

    /**
     * Get a panel by file path
     */
    public getPanel(filePath: string): vscode.WebviewPanel | undefined {
        const normalizedPath = filePath.replace(/\\/g, '/');
        return this.stateManager.getPanel(normalizedPath);
    }

    /**
     * Post message to a panel
     */
    public postMessage(filePath: string, message: unknown): boolean {
        const normalizedPath = filePath.replace(/\\/g, '/');
        return this.stateManager.postMessage(normalizedPath, message);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
        this.pendingScrollRequests.clear();
    }
}

/**
 * Mixin for AI integration in custom editors
 * Provides common AI clarification handling
 */
export interface AIIntegrationMixin {
    /** AI process manager reference */
    aiProcessManager?: import('../../ai-service').IAIProcessManager;
}

/**
 * Utility function to check if a directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
    try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(dirPath));
        return (stat.type & vscode.FileType.Directory) !== 0;
    } catch {
        return false;
    }
}
