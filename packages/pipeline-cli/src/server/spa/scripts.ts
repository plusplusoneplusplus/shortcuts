/**
 * Script Assembler
 *
 * Imports all script modules and concatenates in dependency order.
 * Mirrors packages/deep-wiki/src/server/spa/script.ts pattern.
 */

import type { ScriptOptions } from './types';
import { getCoreScript } from './scripts/core';
import { getThemeScript } from './scripts/theme';
import { getSidebarScript } from './scripts/sidebar';
import { getDetailScript } from './scripts/detail';
import { getFiltersScript } from './scripts/filters';
import { getQueueScript } from './scripts/queue';
import { getWebSocketScript } from './scripts/websocket';
import { getUtilsScript } from './scripts/utils';

export function getDashboardScript(opts: ScriptOptions): string {
    return getUtilsScript() +
        getCoreScript(opts) +
        getThemeScript() +
        getSidebarScript() +
        getDetailScript() +
        getFiltersScript() +
        getQueueScript(opts) +
        getWebSocketScript(opts) + '\n';
}
