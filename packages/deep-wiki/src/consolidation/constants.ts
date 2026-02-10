/**
 * Shared constants for module consolidation.
 */

export const COMPLEXITY_LEVELS: Record<string, number> = { low: 0, medium: 1, high: 2 };
export const COMPLEXITY_NAMES: Record<number, string> = { 2: 'high', 1: 'medium', 0: 'low' };

/**
 * Resolve the highest complexity level from a set of modules.
 */
export function resolveMaxComplexity(modules: { complexity: string }[]): 'low' | 'medium' | 'high' {
    let max = 0;
    for (const m of modules) {
        const level = COMPLEXITY_LEVELS[m.complexity] ?? 0;
        if (level > max) { max = level; }
    }
    return (COMPLEXITY_NAMES[max] ?? 'low') as 'low' | 'medium' | 'high';
}
