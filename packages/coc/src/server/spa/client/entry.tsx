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
import { DiagramViewerShell } from './react/features/diagrams';
import './react/shared/file-path/file-path-preview';
import './react/features/repo-detail/explorer/monaco-setup';

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
} else {
    root.render(<App />);
}
