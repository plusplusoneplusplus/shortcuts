/**
 * PR Classification Prompt Helper
 *
 * Origin-scoped classification routes live in generic-classification-handler.
 * This module only renders the PR-specific prompt used by those routes.
 */

import { renderClassificationPrompt } from './classification-prompt';

export function buildClassificationPrompt(repoId: string, prId: string, dataDir?: string): string {
    return renderClassificationPrompt('pr', prId, repoId, dataDir);
}
