/**
 * Seeds Phase — Public API
 *
 * Exports the main seeds generation function and related types.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

export { runSeedsSession as generateTopicSeeds } from './seeds-session';
export { parseSeedFile } from './seed-file-parser';
export type { TopicSeed, SeedsOutput, SeedsCommandOptions } from '../types';
export { SeedsError } from './seeds-session';
