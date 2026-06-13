/**
 * Canvases — markdown artifacts the AI and the user co-edit in a side panel
 * next to a chat conversation. Updates are revision-checked; a user save
 * against a stale revision returns HTTP 409 with the current record.
 */

export type CanvasEditor = 'ai' | 'user';

export type CanvasType = 'markdown' | 'code' | 'extension';

export interface CanvasSummary {
  id: string;
  workspaceId: string;
  title: string;
  type: CanvasType;
  /** Language hint for code canvases (e.g. "typescript", "python"). */
  language?: string;
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

export interface CanvasCapabilityMeta {
  name: string;
  description: string;
  paramsDescription?: string;
}

export interface CanvasExtensionManifest {
  description: string;
  capabilities: CanvasCapabilityMeta[];
}

export interface CanvasExtension {
  manifest: CanvasExtensionManifest;
  /** Self-contained HTML+JS rendered in the panel's sandboxed iframe. */
  uiHtml: string;
  /** Script assigning a top-level `capabilities` object of (state, params) => nextState functions. */
  capabilitiesJs: string;
}

export interface CanvasExtensionResponse {
  extension: CanvasExtension;
}
