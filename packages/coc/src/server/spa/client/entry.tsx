/**
 * CoC — Dashboard client entry point.
 *
 * Bundled by esbuild into client/dist/bundle.js (IIFE).
 * Pure React bootstrap — all features handled by React components.
 *
 * When the URL hash starts with `#popout/activity/`, a lightweight
 * PopOutChatShell is rendered instead of the full App.
 */

import { createRoot } from 'react-dom/client';
import { App } from './react/App';
import { PopOutChatShell } from './react/layout/PopOutChatShell';
import { PopOutMarkdownShell } from './react/layout/PopOutMarkdownShell';
import { PopOutGitReviewShell } from './react/layout/PopOutGitReviewShell';
import { PopOutCanvasShell } from './react/layout/PopOutCanvasShell';
import { DiagramViewerShell } from './react/features/diagrams';
import { loadRuntimeConfig } from './react/utils/config';
import './react/shared/file-path/file-path-preview';
import './react/features/repo-detail/explorer/monaco-setup';
// Excalidraw ships its renderer styles in a separate CSS entry point. Without
// importing it the React component mounts (we see the UI chrome) but the
// canvas itself lacks the positioning / sizing styles needed to paint the
// scene, so diagrams render as a blank canvas. Pulling this in here ensures
// the styles ride along in the bundled CSS for any route that may surface a
// diagram (full-page viewer, inline previews in chat, etc.).
import '@excalidraw/excalidraw/index.css';

const container = document.getElementById('app-root');
if (!container) throw new Error('No #app-root element found');
const root = createRoot(container);

if (window.location.pathname.startsWith('/diagram/')) {
    root.render(<DiagramViewerShell />);
} else if (window.location.hash.startsWith('#popout/activity/')) {
    root.render(<PopOutChatShell />);
} else if (window.location.hash.startsWith('#popout/markdown')) {
    root.render(<PopOutMarkdownShell />);
} else if (window.location.hash.startsWith('#popout/git-review')) {
    root.render(<PopOutGitReviewShell />);
} else if (window.location.hash.startsWith('#popout/canvas')) {
    root.render(<PopOutCanvasShell />);
} else {
    // Load fresh feature flags from API before rendering the main app.
    // Non-fatal: falls back to bootstrap config embedded in HTML if API fails.
    loadRuntimeConfig().finally(() => {
        root.render(<App />);
    });
}
