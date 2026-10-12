import { contextBridge, ipcRenderer } from 'electron';

// This preload belongs only to main's trusted popup toolbar, never browser pages.
contextBridge.exposeInMainWorld('cocBrowserChrome', {
    stop: (turnId: string) => ipcRenderer.send('coc-desktop:browser-popup-stop', turnId),
});
