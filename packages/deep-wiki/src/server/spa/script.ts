/**
 * SPA Script Assembler
 *
 * Imports all script modules and concatenates them in the correct order.
 * Replaces the monolithic getSpaScript() that was previously in spa-template.ts.
 */

import type { ScriptOptions } from './types';
import { getCoreScript } from './scripts/core';
import { getThemeScript } from './scripts/theme';
import { getSidebarScript } from './scripts/sidebar';
import { getContentScript } from './scripts/content';
import { getMarkdownScript } from './scripts/markdown';
import { getTocScript } from './scripts/toc';
import { getGraphScript } from './scripts/graph';
import { getAskAiScript } from './scripts/ask-ai';
import { getWebSocketScript } from './scripts/websocket';
import { getAdminScript } from './scripts/admin';

/**
 * @deprecated Use the esbuild-bundled client/dist/bundle.js instead.
 * Kept for backward compatibility with existing tests.
 */
export function getSpaScript(opts: ScriptOptions): string {
    return getCoreScript(opts.defaultTheme) +
        getThemeScript() +
        getSidebarScript({ enableSearch: opts.enableSearch, enableGraph: opts.enableGraph }) +
        getContentScript({ enableAI: opts.enableAI }) +
        getMarkdownScript() +
        getTocScript() +
        (opts.enableGraph ? getGraphScript() : '') + '\n' +
        (opts.enableAI ? getAskAiScript() : '') + '\n' +
        (opts.enableWatch ? getWebSocketScript() : '') + '\n' +
        getAdminScript();
}
