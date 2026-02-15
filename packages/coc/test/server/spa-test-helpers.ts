/**
 * Shared test helpers for SPA dashboard tests.
 *
 * Provides common imports and utility functions used across
 * the split SPA test files.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Read the esbuild-bundled client JS for script content tests. */
export function getClientBundle(): string {
    const bundlePath = path.join(__dirname, '..', '..', 'src', 'server', 'spa', 'client', 'dist', 'bundle.js');
    return fs.readFileSync(bundlePath, 'utf8');
}

/** Re-export commonly used test dependencies. */
export { generateDashboardHtml } from '../../src/server/spa';
export { escapeHtml } from '../../src/server/spa/helpers';
export { getAllModels } from '@plusplusoneplusplus/pipeline-core';
