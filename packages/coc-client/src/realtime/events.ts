export interface ProcessEvent {
  type: string;
  workspaceId?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export function isProcessEvent(value: unknown): value is ProcessEvent {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { type?: unknown }).type === 'string';
}
