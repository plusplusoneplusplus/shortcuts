/**
 * Shared Webview Utilities
 * 
 * This module contains shared utilities for webview scripts used by:
 * - markdown-comments
 * - git-diff-comments
 * 
 * Extracting common code here reduces duplication and ensures
 * consistent behavior across webview features.
 */

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

