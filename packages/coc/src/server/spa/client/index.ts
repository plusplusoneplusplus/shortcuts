/**
 * CoC — Dashboard client entry point.
 *
 * Bundled by esbuild into client/dist/bundle.js (IIFE).
 * Import order matters: each module's top-level side effects
 * (event listeners, init calls) execute in this order.
 */

// 1. Pure utilities and config (no side effects)
import './config';
import './state';
import './utils';

// 2. Theme (registers media-query listener, theme-button click)
import './theme';

// 3. Core (registers hashchange listener)
import { init } from './core';

// 4. Sidebar (registers clear-completed, hamburger listeners)
import './sidebar';

// 5. Detail (no top-level side effects beyond variable declarations)
import './detail';

// 6. Filters (registers search, status, type, workspace listeners)
import './filters';

// 7. Queue (calls fetchQueue(), registers enqueue form listeners)
import './queue';

// 8. Repos (tab switching, repos grid, add repo dialog, detail)
import './repos';

// 9. Tasks (workspace task CRUD, tree rendering)
import './tasks';

// 10. WebSocket (calls connectWebSocket())
import './websocket';

// Bootstrap the app
init();
