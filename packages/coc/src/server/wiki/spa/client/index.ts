/**
 * Deep Wiki — SPA client entry point.
 *
 * Bundled by esbuild into client/dist/bundle.js (IIFE).
 * Reads window.__WIKI_CONFIG__, exposes functions on window for inline
 * onclick handlers, and initializes all modules.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { init, escapeHtml, setupPopstateHandler } from './core';
import { initTheme, toggleTheme, setupThemeListeners } from './theme';
import { initializeSidebar, setActive, showWikiContent, showAdminContent } from './sidebar';
import { showHome, loadComponent, loadSpecialPage, loadThemeArticle, toggleSourceFiles, regenerateComponent } from './content';
import { renderMarkdownContent, processMarkdownContent } from './markdown';
import { buildToc } from './toc';
import { showGraph } from './graph';
import { updateAskSubject, addDeepDiveButton, setupAskAiListeners } from './ask-ai';
import { connectWebSocket } from './websocket';
import { showAdmin, setupAdminListeners, runComponentRegenFromAdmin } from './admin';

// Read config injected by server
const config = (window as any).__WIKI_CONFIG__ as WikiConfig;

// Expose functions used by inline onclick handlers in dynamically-built HTML
(window as any).loadComponent = loadComponent;
(window as any).showHome = showHome;
(window as any).showGraph = showGraph;
(window as any).showAdmin = showAdmin;
(window as any).loadSpecialPage = loadSpecialPage;
(window as any).loadThemeArticle = loadThemeArticle;
(window as any).toggleSourceFiles = toggleSourceFiles;
(window as any).escapeHtml = escapeHtml;
(window as any).regenerateComponent = regenerateComponent;
(window as any).runComponentRegenFromAdmin = runComponentRegenFromAdmin;

// Expose init helpers called from core.ts via window
(window as any).initTheme = initTheme;
(window as any).initializeSidebar = initializeSidebar;

// Expose additional functions needed by other modules via window
(window as any).renderMarkdownContent = renderMarkdownContent;
(window as any).processMarkdownContent = processMarkdownContent;
(window as any).buildToc = buildToc;
(window as any).updateAskSubject = updateAskSubject;
(window as any).addDeepDiveButton = addDeepDiveButton;

// Set up event listeners
setupPopstateHandler();
setupThemeListeners();
setupAskAiListeners();
setupAdminListeners();

// Initialize
init();

// Conditionally start optional modules
if (config.enableWatch) {
    connectWebSocket();
}
