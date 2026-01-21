/**
 * Shared Webview Utilities
 * 
 * This module contains shared utilities for webview scripts used by:
 * - markdown-comments
 * - git-diff-comments
 * - yaml-pipeline result viewer
 * 
 * Extracting common code here reduces duplication and ensures
 * consistent behavior across webview features.
 * 
 * NOTE: This file is used by BOTH the extension bundle and webview bundles.
 * Extension-side utilities (that use 'vscode' module) are exported from
 * a separate file: './extension-webview-utils' to avoid webpack errors
 * when bundling webview scripts.
 */

// ============================================================================
// Webview-side utilities (for use in webview scripts bundled by webpack)
// These are safe to import in browser/webview context
// ============================================================================

// Base panel manager utilities
export * from './base-panel-manager';

// VSCode bridge utilities
export * from './base-vscode-bridge';

// State management utilities
export * from './base-state';

// Common selection utilities
export * from './selection-utils';

// Markdown rendering utilities for comment bubbles
export * from './markdown-renderer';

// Search functionality for webview editors
export * from './search-handler';

// Context menu types
export * from './context-menu-types';

// Context menu builder utilities
export * from './context-menu-builder';

// Context menu manager
export { ContextMenuManager } from './context-menu-manager';

// Custom instruction dialog
export { CustomInstructionDialog } from './custom-instruction-dialog';
