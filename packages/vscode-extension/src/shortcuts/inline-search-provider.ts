import * as vscode from 'vscode';

/**
 * Inline search webview provider for embedded search input
 */
export class InlineSearchProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'shortcuts.inlineSearch';

    private _view?: vscode.WebviewView;
    private _onSearchChanged: vscode.EventEmitter<string> = new vscode.EventEmitter<string>();
    public readonly onSearchChanged: vscode.Event<string> = this._onSearchChanged.event;

    private currentValue = '';

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly viewId: string,
        private readonly placeholder: string
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.type) {
                case 'searchChanged':
                    this.currentValue = message.value;
                    this._onSearchChanged.fire(message.value);
                    break;
                case 'clearSearch':
                    this.currentValue = '';
                    this._onSearchChanged.fire('');
                    this.updateSearchValue('');
                    break;
            }
        });
    }

    public updateSearchValue(value: string) {
        this.currentValue = value;
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateSearch',
                value: value
            });
        }
    }

    public getCurrentValue(): string {
        return this.currentValue;
    }

    public focusSearchInput() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'focusInput'
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Search</title>
                <style>
                    body {
                        margin: 0;
                        padding: 8px;
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        background-color: var(--vscode-sideBar-background);
                        color: var(--vscode-foreground);
                    }

                    .search-container {
                        width: 100%;
                        position: relative;
                    }

                    .search-input-container {
                        position: relative;
                        display: flex;
                        align-items: center;
                        background-color: var(--vscode-input-background);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 3px;
                        height: 26px;
                        width: 100%;
                        box-sizing: border-box;
                    }

                    .search-input-container:focus-within {
                        border-color: var(--vscode-focusBorder);
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: -1px;
                    }

                    .search-icon {
                        color: var(--vscode-input-placeholderForeground);
                        margin-left: 8px;
                        margin-right: 6px;
                        flex-shrink: 0;
                        font-size: 14px;
                    }

                    .search-input {
                        flex: 1;
                        background: transparent;
                        border: none;
                        outline: none;
                        color: var(--vscode-input-foreground);
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        padding: 0;
                        height: 100%;
                        line-height: 1;
                    }

                    .search-input::placeholder {
                        color: var(--vscode-input-placeholderForeground);
                    }

                    .clear-button {
                        background: transparent;
                        border: none;
                        outline: none;
                        cursor: pointer;
                        padding: 4px;
                        display: none;
                        align-items: center;
                        justify-content: center;
                        color: var(--vscode-input-placeholderForeground);
                        margin-right: 4px;
                        border-radius: 2px;
                        width: 16px;
                        height: 16px;
                        font-size: 12px;
                    }

                    .clear-button:hover {
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-toolbar-hoverBackground);
                    }

                    .clear-button.visible {
                        display: flex;
                    }

                    .codicon {
                        font-family: codicon;
                        line-height: 1;
                    }
                </style>
            </head>
            <body>
                <div class="search-container">
                    <div class="search-input-container">
                        <span class="codicon codicon-search search-icon"></span>
                        <input type="text"
                               id="searchInput"
                               placeholder="${this.placeholder}"
                               class="search-input"
                               autocomplete="off"
                               spellcheck="false">
                        <button id="clearButton" class="clear-button" title="Clear Search">
                            <span class="codicon codicon-close"></span>
                        </button>
                    </div>
                </div>
                <script>
                    (function() {
                        const vscode = acquireVsCodeApi();
                        const searchInput = document.getElementById('searchInput');
                        const clearButton = document.getElementById('clearButton');

                        let debounceTimeout;

                        // Handle input changes with debouncing
                        searchInput.addEventListener('input', function(e) {
                            const value = e.target.value;

                            // Show/hide clear button
                            if (value) {
                                clearButton.classList.add('visible');
                            } else {
                                clearButton.classList.remove('visible');
                            }

                            // Debounce search to avoid too many updates
                            clearTimeout(debounceTimeout);
                            debounceTimeout = setTimeout(() => {
                                vscode.postMessage({
                                    type: 'searchChanged',
                                    value: value
                                });
                            }, 200);
                        });

                        // Handle clear button click
                        clearButton.addEventListener('click', function() {
                            searchInput.value = '';
                            clearButton.classList.remove('visible');
                            searchInput.focus();

                            vscode.postMessage({
                                type: 'clearSearch'
                            });
                        });

                        // Handle keyboard shortcuts
                        searchInput.addEventListener('keydown', function(e) {
                            if (e.key === 'Escape') {
                                searchInput.value = '';
                                clearButton.classList.remove('visible');

                                vscode.postMessage({
                                    type: 'clearSearch'
                                });
                            }
                        });

                        // Handle messages from extension
                        window.addEventListener('message', event => {
                            const message = event.data;

                            switch (message.type) {
                                case 'updateSearch':
                                    searchInput.value = message.value;
                                    if (message.value) {
                                        clearButton.classList.add('visible');
                                    } else {
                                        clearButton.classList.remove('visible');
                                    }
                                    break;
                                case 'focusInput':
                                    searchInput.focus();
                                    searchInput.select();
                                    break;
                            }
                        });

                        // Auto-focus the input
                        searchInput.focus();
                    })();
                </script>
            </body>
            </html>`;
    }
}