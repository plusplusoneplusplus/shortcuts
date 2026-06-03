/**
 * Merge node executor — combines items from multiple parent nodes.
 *
 * Pure in-memory operation with no external dependencies.
 */

import type { Items, MergeNodeConfig } from '../types';

/**
 * Merge items from multiple parent nodes into a single Items array.
 *
 * **`concat`** (default): Concatenates all parent outputs into a single flat
 * list, preserving declaration order.
 *
 * **`zip`**: Pairs items by index across parents. Result length equals the
 * shortest parent array — extra items from longer arrays are silently
 * discarded. Fields from later parents overwrite fields from earlier parents
 * on collision (`Object.assign` left-to-right ordering).
 *
 * @param config - Merge node configuration (strategy defaults to `'concat'`).
 * @param inputs - One `Items` array per parent node, in declaration order.
 */
export function executeMerge(config: MergeNodeConfig, inputs: Items[]): Items {
    const strategy = config.strategy ?? 'concat';

    if (strategy === 'zip') {
        const minLen = Math.min(...inputs.map(a => a.length));
        return Array.from({ length: minLen }, (_, i) =>
            Object.assign({}, ...inputs.map(arr => arr[i]))
        );
    }

    // concat (default)
    return inputs.flat();
}
