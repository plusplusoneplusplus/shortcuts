export type SeenStateMap = Record<string, string>;

export interface SeenStateEntry {
  processId: string;
  seenAt: string;
}

export interface SeenStateBatchUpdate {
  entries: SeenStateEntry[];
}

export interface UnseenCountResponse {
  unseenCount: number;
}

export interface MarkUnseenResponse {
  ok: boolean;
}
