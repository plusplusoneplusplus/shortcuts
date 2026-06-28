/**
 * CoC Desktop — preload script.
 *
 * Runs in the renderer's isolated context before the SPA loads. The SPA is the
 * unmodified CoC web client served from localhost, so for v1 the preload only
 * exposes a tiny, read-only bridge for diagnostics. Privileged IPC channels are
 * added by later acceptance criteria as the main process grows them.
 */

import { contextBridge } from 'electron';

const api = {
    /** Identifies the host so the SPA can tell it is running inside the desktop shell. */
    isDesktop: true,
    versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
    },
} as const;

contextBridge.exposeInMainWorld('cocDesktop', api);

export type CocDesktopApi = typeof api;
