/**
 * Extension-side Webview Utilities
 * 
 * This module contains utilities for use in EXTENSION code (not webview scripts).
 * These utilities depend on the 'vscode' module and should NOT be imported
 * in webview scripts that are bundled by webpack for browser context.
 * 
 * For webview-side utilities, use './index' instead.
 */

// Webview setup helper (resource roots, theme detection, nonce generation)
export {
    createWebviewCSP,
    DEFAULT_WEBVIEW_OPTIONS,
    WebviewSetupHelper
} from './webview-setup-helper';
export type {
    WebviewSetupOptions,
    WebviewThemeKind
} from './webview-setup-helper';

// Webview state manager (panel tracking, dirty state, state persistence)
export {
    PreviewPanelManager,
    WebviewStateManager
} from './webview-state-manager';
export type {
    DirtyStateChangeEvent,
    StateChangeEvent,
    WebviewStateManagerOptions
} from './webview-state-manager';

// Webview message router (type-safe message handling)
export {
    createWebviewRouter,
    WebviewMessageRouter
} from './webview-message-router';
export type {
    BaseWebviewMessage,
    CommonExtensionMessages,
    CommonWebviewMessages,
    MessageErrorHandler,
    MessageHandler,
    MessageRouterOptions
} from './webview-message-router';

// Base custom editor provider (abstract base class with template method pattern)
export {
    BaseCustomEditorProvider,
    directoryExists
} from './base-custom-editor-provider';
export type {
    AIIntegrationMixin,
    BaseEditorProviderOptions,
    MessageHandlerContext
} from './base-custom-editor-provider';
