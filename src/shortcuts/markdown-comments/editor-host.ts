/**
 * Platform abstraction for editor operations.
 * Implementations wrap VS Code APIs or HTTP/WS transports.
 * The router never touches platform APIs directly — it calls host methods instead.
 */

/**
 * Platform abstraction for editor operations.
 * Implementations wrap VS Code APIs or HTTP/WS transports.
 */
export interface EditorHost {
    // --- Notifications ---
    showInfo(message: string, ...actions: string[]): Promise<string | undefined>;
    showWarning(message: string, options?: { modal?: boolean }, ...actions: string[]): Promise<string | undefined>;
    showError(message: string): void;

    // --- Clipboard ---
    copyToClipboard(text: string): Promise<void>;

    // --- File operations ---
    openFile(uri: string, lineNumber?: number): Promise<void>;
    openExternalUrl(url: string): Promise<void>;
    readFile(filePath: string): Promise<string | undefined>;
    fileExists(filePath: string): Promise<boolean>;

    // --- Document editing ---
    replaceDocumentContent(documentUri: string, content: string): Promise<void>;

    // --- Dialogs ---
    showInputBox(options: { prompt: string; placeHolder?: string; ignoreFocusOut?: boolean }): Promise<string | undefined>;
    showQuickPick<T extends { label: string }>(items: T[], options?: { placeHolder?: string; matchOnDescription?: boolean; matchOnDetail?: boolean }): Promise<T | undefined>;

    // --- Webview communication ---
    postMessage(message: unknown): void;

    // --- VS Code commands (abstracted) ---
    executeCommand(command: string, ...args: unknown[]): Promise<void>;

    // --- Document creation ---
    openUntitledDocument(content: string, language: string): Promise<void>;

    // --- Image resolution ---
    resolveImageToWebviewUri(absolutePath: string): string | null;

    // --- State persistence ---
    getState<T>(key: string, defaultValue: T): T;
    setState(key: string, value: unknown): Promise<void>;

    // --- Configuration ---
    getConfig<T>(section: string, key: string, defaultValue: T): T;
}

/**
 * Pure-data context for message dispatching.
 * Constructed by the provider from VS Code types, consumed by the router.
 */
export interface MessageContext {
    /** Full text content of the document */
    documentText: string;
    /** Absolute path to the document (fsPath) */
    documentPath: string;
    /** Path relative to workspace root */
    relativePath: string;
    /** Directory containing the document */
    fileDir: string;
    /** Workspace root path */
    workspaceRoot: string;
}

/** Returned by dispatch to let the provider know if side effects are needed */
export interface DispatchResult {
    /** True if the webview should be updated after this message */
    shouldUpdateWebview?: boolean;
    /** True if setWebviewEdit() should be called (updateContent) */
    shouldMarkWebviewEdit?: boolean;
}
