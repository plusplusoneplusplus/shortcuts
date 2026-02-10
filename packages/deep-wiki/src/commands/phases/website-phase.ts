/**
 * Phase 5: Website Generation
 *
 * Generates a static HTML website from the wiki markdown files.
 */

import * as path from 'path';
import type { GenerateCommandOptions } from '../../types';
import { generateWebsite } from '../../writing';
import {
    Spinner,
    printWarning,
    printHeader,
} from '../../logger';

// ============================================================================
// Types
// ============================================================================

export interface Phase5WebsiteResult {
    success: boolean;
    duration: number;
}

// ============================================================================
// Phase 5: Website Generation
// ============================================================================

export function runPhase5Website(options: GenerateCommandOptions): Phase5WebsiteResult {
    const startTime = Date.now();

    process.stderr.write('\n');
    printHeader('Phase 5: Website Generation');

    const spinner = new Spinner();
    spinner.start('Generating website...');

    try {
        const outputDir = path.resolve(options.output);
        const files = generateWebsite(outputDir, {
            theme: options.theme,
            title: options.title,
        });

        spinner.succeed(`Website generated (${files.length} files)`);
        return { success: true, duration: Date.now() - startTime };
    } catch (error) {
        spinner.fail('Website generation failed');
        printWarning(`Website generation failed: ${(error as Error).message}`);
        printWarning('Wiki markdown files were still written successfully.');
        return { success: false, duration: Date.now() - startTime };
    }
}
