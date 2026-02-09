/**
 * Module Consolidation — Public API
 *
 * Phase 1.5: Reduces the number of modules from discovery before
 * running the expensive analysis phase. Uses a hybrid approach:
 *   1. Rule-based directory consolidation (fast, deterministic)
 *   2. AI-assisted semantic clustering (one AI session)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

export { consolidateModules } from './consolidator';
export { consolidateByDirectory, getModuleDirectory } from './rule-based-consolidator';
export { clusterWithAI, buildClusteringPrompt, parseClusterResponse, applyClusterMerge } from './ai-consolidator';
