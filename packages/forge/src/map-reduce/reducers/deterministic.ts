/**
 * Deterministic Reducer
 *
 * A code-based reducer that performs deduplication and aggregation
 * without AI calls. Fast, consistent, and reproducible.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    MapResult,
    ReduceContext,
    ReduceResult,
    ReduceStats
} from '../types';
import { BaseReducer } from './reducer';

/**
 * Interface for items that can be deduplicated
 */
export interface Deduplicatable {
    /** Unique identifier */
    id?: string;
    /** Content for key generation */
    [key: string]: unknown;
}

/**
 * Options for the deterministic reducer
 */
export interface DeterministicReducerOptions<T> {
    /**
     * Function to generate a deduplication key for an item
     * Items with the same key will be considered duplicates
     */
    getKey: (item: T) => string;

    /**
     * Function to merge two duplicate items into one
     * @param existing The existing item
     * @param newItem The new duplicate item
     * @returns The merged item
     */
    merge: (existing: T, newItem: T) => T;

    /**
     * Optional function to sort the final results
     */
    sort?: (a: T, b: T) => number;

    /**
     * Optional function to create a summary from the results
     */
    summarize?: (items: T[]) => Record<string, unknown>;
}

/**
 * Result type for deterministic reducer including summary
 */
export interface DeterministicReduceOutput<T> {
    /** Deduplicated items */
    items: T[];
    /** Summary statistics/data */
    summary?: Record<string, unknown>;
}

/**
 * Deterministic reducer that uses code-based logic for deduplication.
 * Fast, consistent, and doesn't require additional API calls.
 */
export class DeterministicReducer<T extends Deduplicatable> extends BaseReducer<T[], DeterministicReduceOutput<T>> {
    constructor(private options: DeterministicReducerOptions<T>) {
        super();
    }

    /**
     * Reduce findings using deterministic code-based logic
     */
    async reduce(
        results: MapResult<T[]>[],
        context: ReduceContext
    ): Promise<ReduceResult<DeterministicReduceOutput<T>>> {
        const startTime = Date.now();

        // Collect all items from successful results
        const allItems: T[] = [];
        for (const result of results) {
            if (result.success && result.output) {
                allItems.push(...result.output);
            }
        }

        const originalCount = allItems.length;

        // Deduplicate items
        const dedupedItems = this.deduplicateItems(allItems);

        // Sort if sorter provided
        if (this.options.sort) {
            dedupedItems.sort(this.options.sort);
        }

        // Create summary if summarizer provided
        const summary = this.options.summarize
            ? this.options.summarize(dedupedItems)
            : undefined;

        const reduceTimeMs = Date.now() - startTime;

        return {
            output: {
                items: dedupedItems,
                summary
            },
            stats: {
                inputCount: originalCount,
                outputCount: dedupedItems.length,
                mergedCount: originalCount - dedupedItems.length,
                reduceTimeMs,
                usedAIReduce: false
            }
        };
    }

    /**
     * Deduplicate items based on key and merge duplicates
     */
    private deduplicateItems(items: T[]): T[] {
        const seen = new Map<string, T>();

        for (const item of items) {
            const key = this.options.getKey(item);

            if (seen.has(key)) {
                // Merge with existing item
                const existing = seen.get(key)!;
                const merged = this.options.merge(existing, item);
                seen.set(key, merged);
            } else {
                seen.set(key, item);
            }
        }

        return Array.from(seen.values());
    }
}

/**
 * Factory function to create a deterministic reducer
 */
export function createDeterministicReducer<T extends Deduplicatable>(
    options: DeterministicReducerOptions<T>
): DeterministicReducer<T> {
    return new DeterministicReducer(options);
}

/**
 * Simple string-based deduplication reducer
 * Deduplicates string arrays and returns unique strings
 */
export class StringDeduplicationReducer extends BaseReducer<string[], { items: string[]; count: number }> {
    private caseSensitive: boolean;

    constructor(caseSensitive: boolean = true) {
        super();
        this.caseSensitive = caseSensitive;
    }

    async reduce(
        results: MapResult<string[]>[],
        context: ReduceContext
    ): Promise<ReduceResult<{ items: string[]; count: number }>> {
        const startTime = Date.now();

        const allStrings: string[] = [];
        for (const result of results) {
            if (result.success && result.output) {
                allStrings.push(...result.output);
            }
        }

        const seen = new Set<string>();
        const unique: string[] = [];

        for (const str of allStrings) {
            const key = this.caseSensitive ? str : str.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(str);
            }
        }

        const reduceTimeMs = Date.now() - startTime;

        return {
            output: {
                items: unique,
                count: unique.length
            },
            stats: {
                inputCount: allStrings.length,
                outputCount: unique.length,
                mergedCount: allStrings.length - unique.length,
                reduceTimeMs,
                usedAIReduce: false
            }
        };
    }
}

/**
 * Numeric aggregation reducer
 * Aggregates numeric values with sum, average, min, max, etc.
 */
export class NumericAggregationReducer extends BaseReducer<number[], {
    sum: number;
    average: number;
    min: number;
    max: number;
    count: number;
}> {
    async reduce(
        results: MapResult<number[]>[],
        context: ReduceContext
    ): Promise<ReduceResult<{
        sum: number;
        average: number;
        min: number;
        max: number;
        count: number;
    }>> {
        const startTime = Date.now();

        const allNumbers: number[] = [];
        for (const result of results) {
            if (result.success && result.output) {
                allNumbers.push(...result.output);
            }
        }

        if (allNumbers.length === 0) {
            return {
                output: {
                    sum: 0,
                    average: 0,
                    min: 0,
                    max: 0,
                    count: 0
                },
                stats: {
                    inputCount: 0,
                    outputCount: 0,
                    mergedCount: 0,
                    reduceTimeMs: Date.now() - startTime,
                    usedAIReduce: false
                }
            };
        }

        const sum = allNumbers.reduce((a, b) => a + b, 0);
        const average = sum / allNumbers.length;
        const min = Math.min(...allNumbers);
        const max = Math.max(...allNumbers);

        const reduceTimeMs = Date.now() - startTime;

        return {
            output: {
                sum,
                average,
                min,
                max,
                count: allNumbers.length
            },
            stats: {
                inputCount: allNumbers.length,
                outputCount: 4, // sum, average, min, max
                mergedCount: allNumbers.length - 1,
                reduceTimeMs,
                usedAIReduce: false
            }
        };
    }
}
