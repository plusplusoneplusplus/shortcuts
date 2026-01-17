/**
 * Main entry point for the webview scripts
 * 
 * This file is bundled by webpack and loaded in the webview.
 * It initializes all the webview components and sets up communication
 * with the VS Code extension.
 */

import { initDomHandlers, rebuildAISubmenu, rebuildPredefinedSubmenu } from './dom-handlers';
import { updateResolvedImage } from './image-handlers';
import { initPanelManager, scrollToComment } from './panel-manager';
import { render } from './render';
import { state } from './state';
import { ExtensionMessage, VsCodeApi } from './types';
import { notifyReady, setupMessageListener } from './vscode-bridge';

// Declare the VS Code API acquisition function
declare function acquireVsCodeApi(): VsCodeApi;

/**
 * Initialize the webview
 */
function init(): void {
    console.log('[Webview] Initializing...');

    // Acquire VS Code API
    const vscode = acquireVsCodeApi();
    state.setVscode(vscode);
    console.log('[Webview] VS Code API acquired');

    // Initialize DOM handlers
    initDomHandlers();
    console.log('[Webview] DOM handlers initialized');

    // Initialize panel manager
    initPanelManager();
    console.log('[Webview] Panel manager initialized');

    // Setup message listener from extension
    setupMessageListener(handleMessage);
    console.log('[Webview] Message listener setup');

    // Notify extension that we're ready
    notifyReady();
    console.log('[Webview] Ready message sent');
}

/**
 * Handle messages from the extension
 */
function handleMessage(message: ExtensionMessage): void {
    console.log('[Webview] Received message:', message.type);

    switch (message.type) {
        case 'update':
            console.log('[Webview] Update message - content length:', message.content?.length, 'comments:', message.comments?.length);
            console.log('[Webview] Update message - content preview:', message.content?.substring(0, 200));
            console.log('[Webview] Current state content preview:', state.currentContent.substring(0, 200));
            console.log('[Webview] Content differs:', message.content !== state.currentContent);
            console.log('[Webview] isExternalChange:', message.isExternalChange);

            // Track if this is an external change for cursor handling
            const isExternalChange = message.isExternalChange === true;

            // Update line change indicators for external changes
            if (isExternalChange && message.lineChanges && message.lineChanges.length > 0) {
                console.log('[Webview] Setting line changes:', message.lineChanges.length, 'changes');
                state.setLineChanges(message.lineChanges);
            } else if (!isExternalChange) {
                // Clear line changes for non-external updates (user is editing)
                state.clearLineChanges();
            }

            // Update state
            state.setCurrentContent(message.content);
            state.setComments(message.comments || []);
            state.setFilePath(message.filePath);
            state.setFileDir(message.fileDir || '');
            state.setWorkspaceRoot(message.workspaceRoot || '');

            if (message.settings) {
                state.setSettings(message.settings);
                // Update checkbox state
                const checkbox = document.getElementById('showResolvedCheckbox') as HTMLInputElement;
                if (checkbox) {
                    checkbox.checked = message.settings.showResolved;
                }
                // Rebuild AI submenu if commands changed
                if (message.settings.aiCommands) {
                    rebuildAISubmenu();
                }
                // Rebuild predefined comments submenu if changed
                if (message.settings.predefinedComments) {
                    rebuildPredefinedSubmenu();
                }
            }

            // Re-render with external change flag
            console.log('[Webview] Calling render...');
            render(isExternalChange);
            console.log('[Webview] Render complete');
            break;

        case 'imageResolved':
            updateResolvedImage(message.imgId, message.uri, message.alt, message.error);
            break;

        case 'scrollToComment':
            // Scroll to and highlight the specified comment
            scrollToComment(message.commentId);
            break;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

