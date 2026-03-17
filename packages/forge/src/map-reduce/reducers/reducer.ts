/**
 * Base Reducer Interface and Abstract Class
 *
 * Defines the core reducer interface and provides a base implementation
 * for creating custom reducers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    MapResult,
    ReduceContext,
    ReduceResult,
    ReduceStats,
    Reducer
} from '../types';

/**
 * Abstract base class for reducers
 * Provides common functionality and a template for implementing reducers
 */
export abstract class BaseReducer<TMapOutput, TReduceOutput> implements Reducer<TMapOutput, TReduceOutput> {
    /**
     * Reduce multiple map outputs into a single result
     */
    abstract reduce(
        results: MapResult<TMapOutput>[],
        context: ReduceContext
    ): Promise<ReduceResult<TReduceOutput>>;

    /**
     * Extract successful outputs from map results
     */
    protected extractSuccessfulOutputs(results: MapResult<TMapOutput>[]): TMapOutput[] {
        return results
            .filter(r => r.success && r.output !== undefined)
            .map(r => r.output!);
    }

    /**
     * Create reduce stats
     */
    protected createStats(
        inputCount: number,
        outputCount: number,
        reduceTimeMs: number,
        usedAIReduce: boolean
    ): ReduceStats {
        return {
            inputCount,
            outputCount,
            mergedCount: inputCount - outputCount,
            reduceTimeMs,
            usedAIReduce
        };
    }

    /**
     * Create an empty result
     */
    protected createEmptyResult(defaultOutput: TReduceOutput): ReduceResult<TReduceOutput> {
        return {
            output: defaultOutput,
            stats: {
                inputCount: 0,
                outputCount: 0,
                mergedCount: 0,
                reduceTimeMs: 0,
                usedAIReduce: false
            }
        };
    }
}

/**
 * Identity reducer - passes through outputs unchanged
 */
export class IdentityReducer<T> extends BaseReducer<T, T[]> {
    async reduce(
        results: MapResult<T>[],
        context: ReduceContext
    ): Promise<ReduceResult<T[]>> {
        const startTime = Date.now();
        const outputs = this.extractSuccessfulOutputs(results);
        const reduceTimeMs = Date.now() - startTime;

        return {
            output: outputs,
            stats: this.createStats(outputs.length, outputs.length, reduceTimeMs, false)
        };
    }
}

/**
 * Flattening reducer - flattens array outputs into a single array
 */
export class FlattenReducer<T> extends BaseReducer<T[], T[]> {
    async reduce(
        results: MapResult<T[]>[],
        context: ReduceContext
    ): Promise<ReduceResult<T[]>> {
        const startTime = Date.now();
        const arrays = this.extractSuccessfulOutputs(results);
        const flattened = arrays.flat();
        const reduceTimeMs = Date.now() - startTime;

        return {
            output: flattened,
            stats: this.createStats(
                arrays.reduce((sum, arr) => sum + arr.length, 0),
                flattened.length,
                reduceTimeMs,
                false
            )
        };
    }
}

/**
 * Aggregating reducer - combines outputs using a custom aggregation function
 */
export class AggregatingReducer<TMapOutput, TReduceOutput> extends BaseReducer<TMapOutput, TReduceOutput> {
    constructor(
        private aggregator: (outputs: TMapOutput[]) => TReduceOutput,
        private defaultOutput: TReduceOutput
    ) {
        super();
    }

    async reduce(
        results: MapResult<TMapOutput>[],
        context: ReduceContext
    ): Promise<ReduceResult<TReduceOutput>> {
        const startTime = Date.now();
        const outputs = this.extractSuccessfulOutputs(results);

        if (outputs.length === 0) {
            return this.createEmptyResult(this.defaultOutput);
        }

        const aggregated = this.aggregator(outputs);
        const reduceTimeMs = Date.now() - startTime;

        return {
            output: aggregated,
            stats: this.createStats(outputs.length, 1, reduceTimeMs, false)
        };
    }
}

// Re-export types
export type { Reducer, ReduceResult, ReduceStats, ReduceContext } from '../types';
