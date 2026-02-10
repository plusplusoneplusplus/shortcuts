/**
 * Phase runners barrel export
 *
 * Re-exports all phase runner functions and their associated types.
 */

export { runPhase1 } from './discovery-phase';
export type { Phase1Result } from './discovery-phase';

export { runPhase2Consolidation } from './consolidation-phase';
export type { Phase2ConsolidationResult } from './consolidation-phase';

export { runPhase3Analysis } from './analysis-phase';
export type { Phase3AnalysisResult } from './analysis-phase';

export { runPhase4Writing, generateReduceOnlyArticles } from './writing-phase';
export type { Phase4WritingResult } from './writing-phase';

export { runPhase5Website } from './website-phase';
export type { Phase5WebsiteResult } from './website-phase';
