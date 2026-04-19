/**
 * Notes REST API Handler — aggregator module.
 * Re-exports from the split sub-modules for backward compatibility.
 */
export { registerNotesRoutes } from './notes-read-handler';
export { registerNotesWriteRoutes } from './notes-write-handler';
export { registerNotesCommentsRoutes } from './notes-comments-handler';
export { registerNotesImageRoutes } from './notes-image-handler';
export { registerNotesGitRoutes } from './notes-git-handler';
