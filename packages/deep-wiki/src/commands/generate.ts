/**
 * Generate Command (Stub)
 *
 * Placeholder for the `deep-wiki generate <repo-path>` command.
 * Full wiki generation (Phase 2: Analysis + Phase 3: Writing) will be
 * implemented in future milestones.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { printWarning, printInfo } from '../logger';
import { EXIT_CODES } from '../cli';

/**
 * Execute the generate command (stub).
 *
 * @returns Exit code
 */
export function executeGenerate(): number {
    printWarning('The generate command is not yet implemented.');
    printInfo('Phase 2 (Deep Analysis) and Phase 3 (Article Writing) are planned for future milestones.');
    printInfo('');
    printInfo('Currently available:');
    printInfo('  deep-wiki discover <repo-path>   Discover module graph (Phase 1)');
    printInfo('');
    printInfo('The discover command produces a module-graph.json that will be used as input');
    printInfo('for the generate command once it is implemented.');

    return EXIT_CODES.SUCCESS;
}
