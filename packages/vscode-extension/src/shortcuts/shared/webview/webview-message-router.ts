/**
 * WebviewMessageRouter
 * 
 * Provides type-safe message routing for webview communication including:
 * - Type-safe message handlers with generics
 * - Message validation
 * - Error handling
 * - Handler registration and lifecycle management
 * 
 * This utility provides a cleaner alternative to switch statements for
 * handling webview messages.
 */

import * as vscode from 'vscode';

/**
 * Base interface for webview messages
 * All messages must have a 'type' field for routing
 */
export interface BaseWebviewMessage {
    type: string;
}

/**
 * Handler function for a specific message type
 * @template TMessage Message type
 * @template TContext Optional context passed to all handlers
 */
export type MessageHandler<TMessage extends BaseWebviewMessage, TContext = void> = 
    TContext extends void
        ? (message: TMessage) => void | Promise<void>
        : (message: TMessage, context: TContext) => void | Promise<void>;

/**
 * Error handler for message processing errors
 */
export type MessageErrorHandler = (messageType: string, error: Error) => void;

/**
 * Options for message router
 */
export interface MessageRouterOptions {
    /** Whether to log unhandled message types */
    logUnhandledMessages?: boolean;
    /** Custom error handler */
    onError?: MessageErrorHandler;
}

/**
 * Type-safe message router for webview communication
 * 
 * @template TMessage Union type of all possible messages
 * @template TContext Optional context type passed to handlers
 * 
 * @example
 * ```typescript
 * // Define message types
 * type MyMessage = 
 *     | { type: 'ready' }
 *     | { type: 'save'; content: string }
 *     | { type: 'addComment'; text: string; line: number };
 * 
 * // Create router
 * const router = new WebviewMessageRouter<MyMessage>();
 * 
 * // Register handlers
 * router.on('ready', () => console.log('Webview ready'));
 * router.on('save', (msg) => saveContent(msg.content));
 * router.on('addComment', (msg) => addComment(msg.text, msg.line));
 * 
 * // Route incoming messages
 * webview.onDidReceiveMessage(msg => router.route(msg));
 * ```
 */
export class WebviewMessageRouter<
    TMessage extends BaseWebviewMessage,
    TContext = void
> implements vscode.Disposable {
    private handlers = new Map<string, MessageHandler<any, TContext>>();
    private readonly options: Required<MessageRouterOptions>;
    private disposed = false;

    constructor(options: MessageRouterOptions = {}) {
        this.options = {
            logUnhandledMessages: options.logUnhandledMessages ?? true,
            onError: options.onError ?? this.defaultErrorHandler
        };
    }

    /**
     * Register a handler for a specific message type
     * @param type Message type to handle
     * @param handler Handler function
     * @returns this for chaining
     */
    on<K extends TMessage['type']>(
        type: K,
        handler: TContext extends void
            ? (message: Extract<TMessage, { type: K }>) => void | Promise<void>
            : (message: Extract<TMessage, { type: K }>, context: TContext) => void | Promise<void>
    ): this {
        if (this.disposed) {
            throw new Error('Cannot add handler to disposed router');
        }
        this.handlers.set(type, handler as MessageHandler<any, TContext>);
        return this;
    }

    /**
     * Register handlers for multiple message types at once
     * @param handlers Object mapping type names to handlers
     * @returns this for chaining
     */
    onMany<K extends TMessage['type']>(
        handlers: {
            [P in K]?: TContext extends void
                ? (message: Extract<TMessage, { type: P }>) => void | Promise<void>
                : (message: Extract<TMessage, { type: P }>, context: TContext) => void | Promise<void>
        }
    ): this {
        for (const [type, handler] of Object.entries(handlers)) {
            if (handler) {
                this.on(type as K, handler as any);
            }
        }
        return this;
    }

    /**
     * Remove a handler for a specific message type
     * @param type Message type
     */
    off(type: TMessage['type']): void {
        this.handlers.delete(type);
    }

    /**
     * Check if a handler is registered for a message type
     * @param type Message type
     */
    hasHandler(type: string): boolean {
        return this.handlers.has(type);
    }

    /**
     * Get all registered message types
     */
    getRegisteredTypes(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Route a message to its handler (without context)
     * @param message The message to route
     * @returns Promise that resolves when handler completes
     */
    async route(message: TMessage): Promise<boolean>;
    /**
     * Route a message to its handler (with context)
     * @param message The message to route
     * @param context Context to pass to the handler
     * @returns Promise that resolves when handler completes
     */
    async route(message: TMessage, context: TContext): Promise<boolean>;
    async route(message: TMessage, context?: TContext): Promise<boolean> {
        if (this.disposed) {
            console.warn('[WebviewMessageRouter] Router is disposed, ignoring message:', message.type);
            return false;
        }

        if (!message || typeof message.type !== 'string') {
            console.warn('[WebviewMessageRouter] Invalid message received:', message);
            return false;
        }

        const handler = this.handlers.get(message.type);

        if (!handler) {
            if (this.options.logUnhandledMessages) {
                console.debug('[WebviewMessageRouter] No handler for message type:', message.type);
            }
            return false;
        }

        try {
            if (context !== undefined) {
                await handler(message, context);
            } else {
                await (handler as (m: TMessage) => void | Promise<void>)(message);
            }
            return true;
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.options.onError(message.type, err);
            return false;
        }
    }

    /**
     * Create a bound handler function for use with webview.onDidReceiveMessage
     * @returns Bound handler function (for routers without context)
     */
    createHandler(): (message: TMessage) => Promise<void>;
    /**
     * Create a bound handler function for use with webview.onDidReceiveMessage
     * @param context Context to pass to handlers
     * @returns Bound handler function
     */
    createHandler(context: TContext): (message: TMessage) => Promise<void>;
    createHandler(context?: TContext): (message: TMessage) => Promise<void> {
        return async (message: TMessage) => {
            if (context !== undefined) {
                await this.route(message, context);
            } else {
                await this.route(message);
            }
        };
    }

    /**
     * Default error handler that logs to console
     */
    private defaultErrorHandler(messageType: string, error: Error): void {
        console.error(`[WebviewMessageRouter] Error handling message '${messageType}':`, error);
    }

    /**
     * Dispose the router and clear all handlers
     */
    dispose(): void {
        this.disposed = true;
        this.handlers.clear();
    }
}

/**
 * Create a message router for a webview with automatic disposal.
 * This overload is for routers without context (TContext = void).
 * 
 * @param webview Webview to attach to
 * @param options Router options
 * @returns Object containing router and disposable
 */
export function createWebviewRouter<TMessage extends BaseWebviewMessage>(
    webview: vscode.Webview,
    options?: MessageRouterOptions
): {
    router: WebviewMessageRouter<TMessage, void>;
    disposable: vscode.Disposable;
};

/**
 * Create a message router for a webview with automatic disposal and context.
 * This overload is for routers with context.
 * 
 * @param webview Webview to attach to
 * @param context Context to pass to all handlers
 * @param options Router options
 * @returns Object containing router and disposable
 */
export function createWebviewRouter<TMessage extends BaseWebviewMessage, TContext>(
    webview: vscode.Webview,
    context: TContext,
    options?: MessageRouterOptions
): {
    router: WebviewMessageRouter<TMessage, TContext>;
    disposable: vscode.Disposable;
};

// Implementation
export function createWebviewRouter<TMessage extends BaseWebviewMessage, TContext = void>(
    webview: vscode.Webview,
    contextOrOptions?: TContext | MessageRouterOptions,
    maybeOptions?: MessageRouterOptions
): {
    router: WebviewMessageRouter<TMessage, TContext>;
    disposable: vscode.Disposable;
} {
    // Determine if contextOrOptions is a context or options
    const hasContext = maybeOptions !== undefined || 
        (contextOrOptions !== undefined && 
         typeof contextOrOptions === 'object' && 
         contextOrOptions !== null &&
         !('logUnhandledMessages' in contextOrOptions) && 
         !('onError' in contextOrOptions));
    
    const context = hasContext ? (contextOrOptions as TContext) : undefined;
    const options = hasContext ? maybeOptions : (contextOrOptions as MessageRouterOptions | undefined);
    
    const router = new WebviewMessageRouter<TMessage, TContext>(options ?? {});
    
    const messageListener = webview.onDidReceiveMessage(
        async (message: TMessage) => {
            if (hasContext && context !== undefined) {
                await router.route(message, context as any);
            } else {
                await router.route(message);
            }
        }
    );

    const disposable = vscode.Disposable.from(
        { dispose: () => router.dispose() },
        messageListener
    );

    return { router, disposable };
}

/**
 * Common message types used across webview editors
 * Extend these for your specific use case
 */
export interface CommonWebviewMessages {
    /** Webview is ready to receive content */
    ready: { type: 'ready' };
    /** Request current state from extension */
    requestState: { type: 'requestState' };
    /** Content has been modified in webview */
    contentModified: { type: 'contentModified'; isDirty: boolean };
    /** Request to scroll to a specific element */
    scrollTo: { type: 'scrollTo'; elementId: string };
}

/**
 * Common message types sent from extension to webview
 */
export interface CommonExtensionMessages {
    /** Update webview content */
    update: { type: 'update'; [key: string]: unknown };
    /** Scroll to specific element */
    scrollToElement: { type: 'scrollToElement'; elementId: string };
    /** Show error in webview */
    showError: { type: 'showError'; message: string };
}
