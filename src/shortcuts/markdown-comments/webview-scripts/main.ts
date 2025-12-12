/**
 * Main entry point for the webview scripts
 * 
 * This file is bundled by webpack and loaded in the webview.
 * It initializes all the webview components and sets up communication
 * with the VS Code extension.
 */

import { state } from './state';
import { VsCodeApi, ExtensionMessage } from './types';
import { notifyReady, setupMessageListener } from './vscode-bridge';
import { initDomHandlers } from './dom-handlers';
import { initPanelManager } from './panel-manager';
import { updateResolvedImage } from './image-handlers';
import { render } from './render';

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
            }
            
            // Re-render
            console.log('[Webview] Calling render...');
            render();
            console.log('[Webview] Render complete');
            break;
        
        case 'imageResolved':
            updateResolvedImage(message.imgId, message.uri, message.alt, message.error);
            break;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

