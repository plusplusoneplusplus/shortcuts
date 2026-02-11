/**
 * Shared Dialog Styles
 *
 * Reusable CSS generation for webview-based modal dialogs.
 * Used by AITaskDialogService and QueueJobDialogService to ensure
 * consistent styling without duplicating large CSS blocks.
 */

/**
 * Generate the shared CSS for dialog webviews.
 * Covers: body layout, dialog container/header/footer, tabs,
 * form groups (inputs, textareas, selects, hints, errors),
 * radio-option groups, buttons, mode-content visibility, and dividers.
 */
export function getSharedDialogCSS(): string {
    return `
        body {
            padding: 0;
            margin: 0;
            background: transparent;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
        }
        
        .dialog-container {
            background: var(--vscode-editor-background, #1e1e1e);
            border: 1px solid var(--vscode-widget-border, #454545);
            border-radius: 8px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            max-width: 560px;
            width: 100%;
            max-height: 90vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        
        .dialog-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            border-bottom: 1px solid var(--vscode-widget-border, #454545);
            background: var(--vscode-editorGroupHeader-tabsBackground, rgba(0, 0, 0, 0.2));
        }
        
        .dialog-header h2 {
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground, #cccccc);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .dialog-header h2 .icon {
            font-size: 20px;
        }
        
        .dialog-close-btn {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: var(--vscode-foreground, #cccccc);
            opacity: 0.7;
            padding: 4px 8px;
            border-radius: 4px;
            line-height: 1;
        }
        
        .dialog-close-btn:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
        }
        
        /* Mode Tabs */
        .mode-tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-widget-border, #454545);
            background: var(--vscode-editorGroupHeader-tabsBackground, rgba(0, 0, 0, 0.1));
        }
        
        .mode-tab {
            flex: 1;
            padding: 12px 16px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground, #cccccc);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.2s, background 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        
        .mode-tab:hover {
            opacity: 1;
            background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
        }
        
        .mode-tab.active {
            opacity: 1;
            background: var(--vscode-editor-background, #1e1e1e);
            border-bottom: 2px solid var(--vscode-focusBorder, #007acc);
            margin-bottom: -1px;
        }
        
        .mode-tab:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        
        .mode-tab .tab-icon {
            font-size: 16px;
        }
        
        .dialog-body {
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group:last-child {
            margin-bottom: 0;
        }
        
        .form-group > label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            color: var(--vscode-foreground, #cccccc);
            margin-bottom: 8px;
        }
        
        .form-group > label .optional {
            font-weight: 400;
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #a0a0a0);
        }
        
        .form-group > label .required {
            color: var(--vscode-errorForeground, #f48771);
            font-weight: 600;
        }
        
        .form-group input[type="text"],
        .form-group textarea,
        .form-group select {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            border-radius: 4px;
            background: var(--vscode-input-background, #3c3c3c);
            color: var(--vscode-input-foreground, #cccccc);
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
            font-size: 13px;
            box-sizing: border-box;
        }
        
        .form-group input[type="text"]:focus,
        .form-group textarea:focus,
        .form-group select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder, #007acc);
        }
        
        .form-group textarea {
            resize: vertical;
            min-height: 80px;
        }
        
        .form-group select {
            cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23cccccc' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
            background-repeat: no-repeat;
            background-position: right 12px center;
            padding-right: 32px;
        }
        
        .form-group .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #a0a0a0);
            margin-top: 6px;
        }
        
        .form-group .error {
            font-size: 11px;
            color: var(--vscode-errorForeground, #f48771);
            margin-top: 6px;
            display: none;
        }
        
        .form-group.has-error input,
        .form-group.has-error textarea,
        .form-group.has-error select {
            border-color: var(--vscode-inputValidation-errorBorder, #be1100);
        }
        
        .form-group.has-error .error {
            display: block;
        }
        
        .form-divider {
            border: none;
            border-top: 1px solid var(--vscode-widget-border, #454545);
            margin: 20px 0;
        }
        
        /* Radio option group */
        .radio-options {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .radio-option {
            display: flex;
            align-items: flex-start;
            padding: 12px;
            border: 1px solid var(--vscode-input-border, #3c3c3c);
            border-radius: 6px;
            background: var(--vscode-input-background, #3c3c3c);
            cursor: pointer;
            transition: border-color 0.2s, background-color 0.2s;
        }
        
        .radio-option:hover {
            border-color: var(--vscode-focusBorder, #007acc);
            background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.05));
        }
        
        .radio-option.selected {
            border-color: var(--vscode-focusBorder, #007acc);
            background: var(--vscode-list-activeSelectionBackground, rgba(0, 122, 204, 0.1));
        }
        
        .radio-option.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .radio-option input[type="radio"] {
            margin: 0;
            margin-right: 12px;
            margin-top: 2px;
            accent-color: var(--vscode-focusBorder, #007acc);
        }
        
        .radio-option-content {
            flex: 1;
        }
        
        .radio-option-title {
            font-size: 13px;
            font-weight: 500;
            color: var(--vscode-foreground, #cccccc);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .radio-option-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #a0a0a0);
            margin-top: 4px;
        }
        
        .dialog-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            padding: 16px 20px;
            border-top: 1px solid var(--vscode-widget-border, #454545);
            background: var(--vscode-editorGroupHeader-tabsBackground, rgba(0, 0, 0, 0.2));
        }
        
        .btn {
            padding: 10px 20px;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s, opacity 0.2s;
            border: none;
        }
        
        .btn-primary {
            background: var(--vscode-button-background, #0e639c);
            color: var(--vscode-button-foreground, #ffffff);
        }
        
        .btn-primary:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground, #1177bb);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground, #3a3d41);
            color: var(--vscode-button-secondaryForeground, #cccccc);
        }
        
        .btn-secondary:hover:not(:disabled) {
            background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        /* Mode content visibility */
        .mode-content {
            display: none;
        }
        
        .mode-content.active {
            display: block;
        }
    `;
}
