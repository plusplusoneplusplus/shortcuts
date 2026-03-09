/**
 * CoC — Dashboard client entry point.
 *
 * Bundled by esbuild into client/dist/bundle.js (IIFE).
 * Pure React bootstrap — all features handled by React components.
 *
 * When the URL hash starts with `#popout/activity/`, a lightweight
 * PopOutActivityShell is rendered instead of the full App.
 */

import { createRoot } from 'react-dom/client';
import { App } from './react/App';
import { PopOutActivityShell } from './react/layout/PopOutActivityShell';
import './react/file-path-preview';
import './react/repos/explorer/monaco-setup';

const container = document.getElementById('app-root');
if (!container) throw new Error('No #app-root element found');
const root = createRoot(container);

if (window.location.hash.startsWith('#popout/activity/')) {
    root.render(<PopOutActivityShell />);
} else {
    root.render(<App />);
}
