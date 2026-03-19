/**
 * WebviewSetupHelper
 * 
 * Provides common webview setup functionality including:
 * - Local resource roots configuration
 * - Webview options setup
 * - Theme detection
 * - Nonce generation for CSP
 * - Extension URI path conversions
 * 
 * This utility eliminates boilerplate code duplicated across custom editor providers.
 */

import * as vscode from 'vscode';

/**
 * Theme kind for webview content styling
 */
export type WebviewThemeKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light';

/**
 * Configuration options for webview setup
 */
export interface WebviewSetupOptions {
    /** Enable scripts in the webview */
    enableScripts?: boolean;
    /** Retain context when webview is hidden */
    retainContextWhenHidden?: boolean;
    /** Enable the find widget (Ctrl+F search) */
    enableFindWidget?: boolean;
    /** Enable command URIs */
    enableCommandUris?: boolean;
    /** Additional local resource roots beyond defaults */
    additionalResourceRoots?: vscode.Uri[];
}

/**
 * Default webview setup options
 */
export const DEFAULT_WEBVIEW_OPTIONS: Required<Omit<WebviewSetupOptions, 'additionalResourceRoots'>> = {
    enableScripts: true,
    retainContextWhenHidden: true,
    enableFindWidget: true,
    enableCommandUris: false
};

/**
 * Helper class for setting up webviews with consistent configuration
 */
export class WebviewSetupHelper {
    constructor(private readonly extensionUri: vscode.Uri) {}

    /**
     * Get the current VSCode theme kind
     */
    getThemeKind(): WebviewThemeKind {
        const themeKind = vscode.window.activeColorTheme.kind;
        switch (themeKind) {
            case vscode.ColorThemeKind.Light:
                return 'light';
            case vscode.ColorThemeKind.Dark:
                return 'dark';
            case vscode.ColorThemeKind.HighContrast:
                return 'high-contrast';
            case vscode.ColorThemeKind.HighContrastLight:
                return 'high-contrast-light';
            default:
                return 'dark';
        }
    }

    /**
     * Get the default local resource roots for webviews
     * Includes: resources, media, dist directories
     */
    getDefaultResourceRoots(): vscode.Uri[] {
        return [
            vscode.Uri.joinPath(this.extensionUri, 'resources'),
            vscode.Uri.joinPath(this.extensionUri, 'media'),
            vscode.Uri.joinPath(this.extensionUri, 'dist')
        ];
    }

    /**
     * Get resource roots including additional paths
     * @param additionalRoots Additional URIs to include as resource roots
     */
    getResourceRoots(additionalRoots: vscode.Uri[] = []): vscode.Uri[] {
        return [...this.getDefaultResourceRoots(), ...additionalRoots];
    }

    /**
     * Configure webview options
     * @param webview The webview to configure
     * @param options Setup options
     */
    configureWebviewOptions(
        webview: vscode.Webview,
        options: WebviewSetupOptions = {}
    ): void {
        const mergedOptions = { ...DEFAULT_WEBVIEW_OPTIONS, ...options };
        const resourceRoots = this.getResourceRoots(options.additionalResourceRoots);

        webview.options = {
            enableScripts: mergedOptions.enableScripts,
            enableCommandUris: mergedOptions.enableCommandUris,
            localResourceRoots: resourceRoots
        };
    }

    /**
     * Get webview panel options for creating a webview panel
     * @param options Setup options
     */
    getWebviewPanelOptions(options: WebviewSetupOptions = {}): vscode.WebviewPanelOptions & vscode.WebviewOptions {
        const mergedOptions = { ...DEFAULT_WEBVIEW_OPTIONS, ...options };
        const resourceRoots = this.getResourceRoots(options.additionalResourceRoots);

        return {
            enableScripts: mergedOptions.enableScripts,
            retainContextWhenHidden: mergedOptions.retainContextWhenHidden,
            enableFindWidget: mergedOptions.enableFindWidget,
            enableCommandUris: mergedOptions.enableCommandUris,
            localResourceRoots: resourceRoots
        };
    }

    /**
     * Get a webview URI for a local resource
     * @param webview The webview
     * @param relativePath Path relative to extension root
     */
    getWebviewUri(webview: vscode.Webview, ...relativePath: string[]): vscode.Uri {
        const resourceUri = vscode.Uri.joinPath(this.extensionUri, ...relativePath);
        return webview.asWebviewUri(resourceUri);
    }

    /**
     * Generate a nonce for Content Security Policy
     * @param length Length of the nonce (default: 32)
     */
    static generateNonce(length: number = 32): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Escape HTML special characters for safe embedding
     * @param text Text to escape
     */
    static escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Create a theme change listener that calls the callback when theme changes
     * @param callback Function to call when theme changes
     * @returns Disposable for the listener
     */
    createThemeChangeListener(callback: (themeKind: WebviewThemeKind) => void): vscode.Disposable {
        return vscode.window.onDidChangeActiveColorTheme(() => {
            callback(this.getThemeKind());
        });
    }

    /**
     * Create a configuration change listener for a specific section
     * @param section Configuration section to watch
     * @param callback Function to call when configuration changes
     * @returns Disposable for the listener
     */
    static createConfigChangeListener(
        section: string,
        callback: (event: vscode.ConfigurationChangeEvent) => void
    ): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(section)) {
                callback(event);
            }
        });
    }
}

/**
 * Create a standard Content Security Policy for webviews
 * @param webview The webview to create CSP for
 * @param nonce Nonce for inline scripts
 * @param options Additional CSP options
 */
export function createWebviewCSP(
    webview: vscode.Webview,
    nonce: string,
    options: {
        allowInlineStyles?: boolean;
        externalStyleSources?: string[];
        externalScriptSources?: string[];
        allowImages?: boolean;
        allowFonts?: boolean;
    } = {}
): string {
    const {
        allowInlineStyles = true,
        externalStyleSources = [],
        externalScriptSources = [],
        allowImages = true,
        allowFonts = true
    } = options;

    const cspParts: string[] = [];

    // Default src
    cspParts.push("default-src 'none'");

    // Style sources
    const styleSources = [webview.cspSource, ...externalStyleSources];
    if (allowInlineStyles) {
        styleSources.push("'unsafe-inline'");
    }
    cspParts.push(`style-src ${styleSources.join(' ')}`);

    // Script sources
    const scriptSources = [`'nonce-${nonce}'`, ...externalScriptSources];
    cspParts.push(`script-src ${scriptSources.join(' ')}`);

    // Image sources
    if (allowImages) {
        cspParts.push(`img-src ${webview.cspSource} https: data:`);
    }

    // Font sources
    if (allowFonts) {
        cspParts.push(`font-src ${webview.cspSource} https:`);
    }

    return cspParts.join('; ');
}
