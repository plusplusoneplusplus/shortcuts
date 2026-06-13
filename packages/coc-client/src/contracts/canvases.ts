/**
 * Canvases — markdown artifacts the AI and the user co-edit in a side panel
 * next to a chat conversation. Updates are revision-checked; a user save
 * against a stale revision returns HTTP 409 with the current record.
 */

export type CanvasEditor = 'ai' | 'user';

export interface CanvasSummary {
  id: string;
  workspaceId: string;
  title: string;
  type: 'markdown';
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Process that created the canvas (links the canvas to a chat). */
  processId?: string;
  lastEditor: CanvasEditor;
}

export interface Canvas extends CanvasSummary {
  content: string;
}

export interface ListCanvasesResponse {
  canvases: CanvasSummary[];
}

export interface CanvasResponse {
  canvas: Canvas;
}

export interface SaveCanvasRequest {
  content?: string;
  expectedRevision?: number;
  title?: string;
}

/** Body of the HTTP 409 response when a save hits a stale revision. */
export interface CanvasConflictResponse {
  error: 'revision-conflict';
  currentRevision: number;
  canvas: Canvas | null;
}

export interface CanvasVersionMeta {
  revision: number;
  title: string;
  editor: CanvasEditor;
  updatedAt: string;
}

export interface CanvasVersion extends CanvasVersionMeta {
  content: string;
}

export interface ListCanvasVersionsResponse {
  versions: CanvasVersionMeta[];
}

export interface CanvasVersionResponse {
  version: CanvasVersion;
}

export type CanvasCommentStatus = 'open' | 'sent' | 'resolved';

export interface CanvasComment {
  id: string;
  /** Excerpt of the canvas text the comment is anchored to. */
  anchorText: string;
  body: string;
  status: CanvasCommentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ListCanvasCommentsResponse {
  comments: CanvasComment[];
}

export interface CanvasCommentResponse {
  comment: CanvasComment;
}

export interface AddCanvasCommentRequest {
  anchorText: string;
  body: string;
}
