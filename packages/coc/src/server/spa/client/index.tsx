/**
 * CoC — Dashboard client entry point.
 *
 * Bundled by esbuild into client/dist/bundle.js (IIFE).
 * Pure React bootstrap — all features handled by React components.
 */

import { createRoot } from 'react-dom/client';
import { App } from './react/App';
import './react/file-path-preview';
import './react/repos/explorer/monaco-setup';

const container = document.getElementById('app-root');
if (!container) throw new Error('No #app-root element found');
const root = createRoot(container);
root.render(<App />);
