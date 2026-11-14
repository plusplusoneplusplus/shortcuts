import type { BrowserHostError } from './browser-host-contract';
import { WebView2Process } from './webview2-process';

/**
 * Stdio JSON-line transport to the macOS `coc-wkwebview` helper. The helper speaks the
 * WebView2 framing (ready handshake, id-first replies, 1 MiB frames), so it shares that transport.
 */
export class WkWebViewProcess extends WebView2Process {
    constructor(binary: () => string, profile: string,
        onEvent: (message: Record<string, unknown>) => void,
        onFailure: (error: BrowserHostError) => void) {
        super(binary, profile, onEvent, onFailure, {
            name: 'WKWebView', viewOps: ['evaluate', 'input', 'screenshot', 'focus-emulation', 'navigation-decision', 'site-info', 'capture-annotation', 'control-activity'], captureOps: ['screenshot', 'capture-annotation'],
        });
    }
}
