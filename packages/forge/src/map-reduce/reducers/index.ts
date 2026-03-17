/**
 * Reducers Module
 *
 * Exports all reducer implementations and utilities.
 */

// Base reducer
export {
    BaseReducer,
    IdentityReducer,
    FlattenReducer,
    AggregatingReducer
} from './reducer';

// Deterministic reducer
export {
    DeterministicReducer,
    createDeterministicReducer,
    StringDeduplicationReducer,
    NumericAggregationReducer
} from './deterministic';
export type {
    Deduplicatable,
    DeterministicReducerOptions,
    DeterministicReduceOutput
} from './deterministic';

// AI reducer
export {
    AIReducer,
    createAIReducer,
    createTextSynthesisReducer
} from './ai-reducer';
export type {
    AIReducerOptions,
    TextSynthesisOutput,
    TextSynthesisOptions
} from './ai-reducer';

// Hybrid reducer
export {
    HybridReducer,
    createHybridReducer,
    createSimpleHybridReducer
} from './hybrid-reducer';
export type {
    HybridReducerOptions,
    SimplePolishedOutput
} from './hybrid-reducer';
