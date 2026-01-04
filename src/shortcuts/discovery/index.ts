/**
 * Auto AI Discovery Module
 * 
 * Automatically discover and organize critical docs, files, and commits
 * related to a specific feature using AI-powered semantic search.
 * 
 * Primary: AIDiscoveryEngine - Uses Copilot CLI for intelligent search
 * Fallback: Keyword-based search for environments without AI
 */

export * from './types';
export * from './keyword-extractor';
export * from './relevance-scorer';
export * from './discovery-engine';
export * from './ai-discovery-engine';
export * from './discovery-commands';
export * from './search-providers';
export * from './discovery-webview';

