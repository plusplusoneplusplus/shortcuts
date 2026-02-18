/**
 * CoC — Dashboard client entry point.
 *
 * Bundled by esbuild into client/dist/bundle.js (IIFE).
 * Mounts React into #app-root for Processes/Queue tabs.
 * Legacy vanilla modules remain active for other tabs (Repos, Wiki, etc.).
 */

import { createRoot } from 'react-dom/client';
import { App } from './react/App';

// 1. Pure utilities and config (no side effects)
import './config';
import './state';
import './utils';

// 2. Theme (registers media-query listener, theme-button click)
import './theme';

// 3. Core (registers hashchange listener)
import { init } from './core';

// 4. Sidebar (cache utilities, live timers — still used by legacy modules)
import './sidebar';

// 5. Detail (still used by repos, wiki)
import './detail';

// 6. Filters (still used by legacy modules)
import './filters';

// 7. Queue (still used by legacy modules)
import './queue';

// 8. Repos (tab switching, repos grid, add repo dialog, detail)
import './repos';

// 9. Tasks (workspace task CRUD, tree rendering)
import './tasks';

// 9a. Task Mermaid (mermaid diagram rendering in task preview)
import './task-mermaid';

// 10. Wiki (wiki list, component browser, add wiki dialog, ask AI, graph, admin)
import './wiki';
import './wiki-components';
import './wiki-content';
import './wiki-markdown';
import './wiki-toc';
import './wiki-mermaid-zoom';
import './wiki-ask';
import './wiki-graph';
import './wiki-admin';

// 11. Global admin overlay (gear icon in top bar)
import './admin';

// 12. Preferences (loads saved model, attaches persistence listeners)
import { loadPreferences, initModelPersistence } from './preferences';
loadPreferences();
initModelPersistence();

// 13. AI Actions (dropdown for task AI operations)
import './ai-actions';

// 14. Task Comments UI (comment cards, selection toolbar, sidebar)
import './task-comments-ui';

// 15. Task Comments Client (API integration, event system, state management)
import './task-comments-client';

// 15. WebSocket (calls connectWebSocket())
import './websocket';

// 16. File path hover preview
import './file-preview';

// Bootstrap legacy modules (repos, wiki, admin, tasks)
init();

// Mount React app into #app-root
const appRoot = document.getElementById('app-root');
if (appRoot) {
    createRoot(appRoot).render(<App />);
}
