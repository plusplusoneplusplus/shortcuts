/**
 * Dashboard CSS Styles
 *
 * VS Code-inspired color scheme using CSS custom properties.
 * Light defaults with dark overrides via html[data-theme="dark"].
 *
 * CSS lives in client/styles.css; loaded once at module init.
 */
import * as fs from 'fs';
import * as path from 'path';

const cssContent = fs.readFileSync(
    path.join(__dirname, 'client', 'styles.css'), 'utf-8'
);

/**
 * @deprecated Use the esbuild-bundled client/dist/bundle.css instead.
 * Kept for backward compatibility with existing tests.
 */
export function getDashboardStyles(): string {
    return cssContent;
}
