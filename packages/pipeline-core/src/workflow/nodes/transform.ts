/**
 * Transform node executor — applies a sequence of data transformations.
 *
 * Pure in-memory operation with no external dependencies.
 * The `substituteTemplate` helper is intentionally local — it does NOT
 * import from `pipeline-core/src/pipeline/` to keep this node self-contained.
 */

import type { Item, Items, TransformNodeConfig, TransformOp } from '../types';

const pick = (item: Item, fields: string[]): Item =>
    Object.fromEntries(fields.filter(f => f in item).map(f => [f, item[f]]));

const omit = (item: Item, fields: string[]): Item =>
    Object.fromEntries(Object.entries(item).filter(([k]) => !fields.includes(k)));

/**
 * Replace `{{fieldName}}` tokens with the corresponding item value.
 * Unknown fields resolve to empty string.
 */
function substituteTemplate(template: string, item: Item): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
        String(item[key] ?? '')
    );
}

/**
 * Apply a sequence of transform operations to an Items array.
 *
 * Operations are applied in order; each op receives the full array
 * produced by the previous op.
 *
 * @param config - Transform node configuration with ordered `ops` array.
 * @param inputs - The input Items array.
 */
export function executeTransform(config: TransformNodeConfig, inputs: Items): Items {
    let items = inputs;

    for (const op of config.ops) {
        items = applyOp(op, items);
    }

    return items;
}

function applyOp(op: TransformOp, items: Items): Items {
    switch (op.op) {
        case 'select':
            return items.map(item => pick(item, op.fields));
        case 'drop':
            return items.map(item => omit(item, op.fields));
        case 'rename':
            return items.map(item => {
                const { [op.from]: value, ...rest } = item;
                return op.from in item ? { ...rest, [op.to]: value } : rest;
            });
        case 'add':
            return items.map(item => ({ ...item, [op.field]: substituteTemplate(op.value, item) }));
        default: {
            const _exhaustive: never = op;
            throw new Error(`Unhandled transform op: ${(_exhaustive as TransformOp).op}`);
        }
    }
}
