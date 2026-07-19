/**
 * Canvases — markdown artifacts the AI and the user co-edit in a side panel
 * next to a chat conversation. Updates are revision-checked; a user save
 * against a stale revision returns HTTP 409 with the current record.
 */

export type CanvasEditor = 'ai' | 'user';

export type CanvasType = 'markdown' | 'code' | 'extension' | 'excalidraw' | 'exploration';

// ---------------------------------------------------------------------------
// Exploration canvases (type 'exploration')
//
// An exploration is an interactive Kusto data-exploration surface: an editable
// KQL query run server-side against a cluster/database, the resulting typed
// columns + rows (capped), a chart config, and the last-run status. The whole
// state is serialized as JSON into the canvas `content` field so it rides the
// existing canvas persistence/versioning/revision machinery unchanged.
// ---------------------------------------------------------------------------

/** Hard cap on the number of result rows stored/rendered per exploration. */
export const MAX_EXPLORATION_ROWS = 10000;

/** A result column: name plus the Kusto column type (e.g. "string", "long", "real"). */
export interface ExplorationColumn {
  name: string;
  type: string;
}

/** Native chart kinds an exploration can render from its stored rows. */
export type ExplorationChartType = 'line' | 'bar' | 'scatter' | 'pie' | 'stackedArea';

/** Which columns map to the chart axes; `y` may list several numeric columns. */
export interface ExplorationChartConfig {
  type: ExplorationChartType;
  /** Column name for the x-axis / category. */
  x?: string;
  /** Numeric column name(s) for the y-axis / value series. */
  y?: string[];
  /** Optional column to split into a series / group-by. */
  series?: string;
}

export type ExplorationRunStatus = 'idle' | 'loading' | 'success' | 'error';

/** Outcome of the most recent query execution. */
export interface ExplorationRunInfo {
  /** ISO timestamp of when the run finished (or was attempted). */
  timestamp: string;
  status: ExplorationRunStatus;
  /** SDK/auth error message when `status === 'error'`. */
  error?: string;
  /** Number of rows returned before truncation, when known. */
  rowCount?: number;
}

/**
 * Full persisted state of an exploration canvas. Stored as JSON in the canvas
 * `content` string. `rows` is row-major (each row an array of cell values
 * aligned to `columns`) and never exceeds {@link MAX_EXPLORATION_ROWS}.
 */
export interface ExplorationState {
  /** KQL query text. */
  query: string;
  /** Target cluster URL, e.g. "https://help.kusto.windows.net". */
  clusterUrl: string;
  /** Target database name. */
  database: string;
  /** Result column schema (empty until the first successful run). */
  columns: ExplorationColumn[];
  /** Result rows, row-major, capped at {@link MAX_EXPLORATION_ROWS}. */
  rows: ExplorationCellValue[][];
  /** True when the result set was truncated to the row cap. */
  truncated: boolean;
  /** Optional chart configuration; absent until the user/AI sets one. */
  chartConfig?: ExplorationChartConfig;
  /** Most recent run outcome; absent before the first run. */
  lastRun?: ExplorationRunInfo;
}

/** A single result cell value. Kusto values reduce to these JSON-safe shapes. */
export type ExplorationCellValue = string | number | boolean | null;

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

/**
 * Body for creating a new canvas from the UI (AC-07 manual exploration create).
 * The server currently only accepts `type: 'exploration'` and gates the route
 * on the exploration feature flag.
 */
export interface CreateCanvasRequest {
  type: CanvasType;
  title: string;
  content: string;
  /** Links the new canvas to a conversation so it appears in that chat's panel. */
  processId?: string;
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
