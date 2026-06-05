import type { ForEachItem, ForEachItemStatus } from './contracts/for-each';

export const FOR_EACH_ITEM_STATUSES: readonly ForEachItemStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
];

const ITEM_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const ITEM_STATUS_SET = new Set<ForEachItemStatus>(FOR_EACH_ITEM_STATUSES);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalStringArray(value: unknown, fieldName: string): string[] | undefined {
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

export function normalizeForEachPlanItems(rawItems: unknown): ForEachItem[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error('For Each item plan must contain a non-empty items array');
  }

  const seenIds = new Set<string>();
  const items = rawItems.map((raw, index): ForEachItem => {
    if (!isPlainRecord(raw)) {
      throw new Error(`items[${index}] must be an object`);
    }

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) {
      throw new Error(`items[${index}].id is required`);
    }
    if (!ITEM_ID_PATTERN.test(id)) {
      throw new Error(`items[${index}].id may only contain letters, numbers, dot, underscore, or dash`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate For Each item id: ${id}`);
    }
    seenIds.add(id);

    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) {
      throw new Error(`items[${index}].title is required`);
    }

    const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
    if (!prompt) {
      throw new Error(`items[${index}].prompt is required`);
    }

    const status = raw.status;
    if (!ITEM_STATUS_SET.has(status as ForEachItemStatus)) {
      throw new Error(`items[${index}].status must be one of: ${FOR_EACH_ITEM_STATUSES.join(', ')}`);
    }

    const dependsOn = normalizeOptionalStringArray(raw.dependsOn, `items[${index}].dependsOn`);
    const metadata = raw.metadata === undefined
      ? undefined
      : isPlainRecord(raw.metadata)
        ? raw.metadata
        : undefined;
    if (raw.metadata !== undefined && metadata === undefined) {
      throw new Error(`items[${index}].metadata must be an object`);
    }

    const item: ForEachItem = {
      id,
      title,
      prompt,
      status: status as ForEachItemStatus,
    };
    if (dependsOn) item.dependsOn = dependsOn;
    if (metadata) item.metadata = metadata;
    if (typeof raw.childProcessId === 'string' && raw.childProcessId.trim()) {
      item.childProcessId = raw.childProcessId.trim();
    }
    if (typeof raw.childTaskId === 'string' && raw.childTaskId.trim()) {
      item.childTaskId = raw.childTaskId.trim();
    }
    if (typeof raw.startedAt === 'string' && raw.startedAt.trim()) {
      item.startedAt = raw.startedAt.trim();
    }
    if (typeof raw.completedAt === 'string' && raw.completedAt.trim()) {
      item.completedAt = raw.completedAt.trim();
    }
    if (typeof raw.error === 'string' && raw.error.trim()) {
      item.error = raw.error.trim();
    }
    return item;
  });

  const ids = new Set(items.map(item => item.id));
  for (const item of items) {
    for (const dependency of item.dependsOn ?? []) {
      if (!ids.has(dependency)) {
        throw new Error(`Item '${item.id}' depends on unknown item '${dependency}'`);
      }
      if (dependency === item.id) {
        throw new Error(`Item '${item.id}' cannot depend on itself`);
      }
    }
  }

  return items;
}

export function assertForEachDraftStatuses(items: ForEachItem[]): void {
  const nonPending = items.find(item => item.status !== 'pending');
  if (nonPending) {
    throw new Error(`Generated For Each item '${nonPending.id}' must have initial status 'pending'`);
  }
}

export function validateForEachDraftPlan(rawItems: unknown): { items: ForEachItem[]; error: null } | { items: null; error: string } {
  try {
    const items = normalizeForEachPlanItems(rawItems);
    assertForEachDraftStatuses(items);
    return { items, error: null };
  } catch (err) {
    return { items: null, error: err instanceof Error ? err.message : String(err) };
  }
}
