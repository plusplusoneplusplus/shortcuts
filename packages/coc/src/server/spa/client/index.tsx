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

// 8. Tasks — now handled by React TasksPanel (packages/coc/src/server/spa/client/react/tasks/)

// 9a. Task Mermaid — now handled by React useMermaid hook

// 10. Wiki — now handled by React wiki components (react/wiki/)

// 11. Global admin overlay (gear icon in top bar)
import './admin';

// 12. Preferences (loads saved model, attaches persistence listeners)
import { loadPreferences, initModelPersistence } from './preferences';
loadPreferences();
initModelPersistence();

// 13. AI Actions (dropdown for task AI operations)
import './ai-actions';

// 14-15. Task Comments — now handled by React components (react/tasks/comments/)

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
