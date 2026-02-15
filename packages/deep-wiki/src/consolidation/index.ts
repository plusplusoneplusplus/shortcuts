/**
 * Component Consolidation — Public API
 *
 * Phase 2: Reduces the number of components from discovery before
 * running the expensive analysis phase. Uses a hybrid approach:
 *   1. Rule-based directory consolidation (fast, deterministic)
 *   2. AI-assisted semantic clustering (one AI session)
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

export { consolidateComponents } from './consolidator';
export { consolidateByDirectory, getComponentDirectory } from './rule-based-consolidator';
export { clusterWithAI, buildClusteringPrompt, parseClusterResponse, applyClusterMerge } from './ai-consolidator';
