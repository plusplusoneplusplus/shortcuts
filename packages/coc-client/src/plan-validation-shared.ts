/**
 * Shared plan-item validation helpers used by both For Each and Map Reduce plans.
 */

export const ITEM_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of item IDs`);
  }
  const result = value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error(`${fieldName}[${index}] must be a non-empty string`);
    }
    return entry.trim();
  });
  return result.length > 0 ? result : undefined;
}

export function extractJsonCandidates(content: string): string[] {
  const candidates: string[] = [];
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (let match = fencePattern.exec(content); match; match = fencePattern.exec(content)) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    candidates.push(trimmed);
  }
  return candidates;
}

export interface PlanScanTurn {
  role: string;
  content: string;
  turnIndex?: number;
  streaming?: boolean;
}

export interface PlanScanError {
  turnIndex: number;
  message: string;
}
