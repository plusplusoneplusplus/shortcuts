/**
 * SPA CSS Styles
 *
 * CSS lives in client/styles.css and client/ask-widget.css;
 * loaded once at module init. The ask-widget CSS is only
 * included when enableAI is true.
 */
import * as fs from 'fs';
import * as path from 'path';

const baseCss = fs.readFileSync(
    path.join(__dirname, 'client', 'styles.css'), 'utf-8'
);
const askWidgetCss = fs.readFileSync(
    path.join(__dirname, 'client', 'ask-widget.css'), 'utf-8'
);

export function getSpaStyles(enableAI: boolean): string {
    return enableAI ? baseCss + '\n' + askWidgetCss : baseCss;
}
