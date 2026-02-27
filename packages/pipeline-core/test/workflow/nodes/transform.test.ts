import { describe, it, expect } from 'vitest';
import { executeTransform } from '../../../src/workflow/nodes/transform';
import type { TransformNodeConfig } from '../../../src/workflow/types';

describe('executeTransform', () => {
    it('select — keeps only specified fields', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [{ op: 'select', fields: ['a', 'b'] }],
        };
        const result = executeTransform(config, [{ a: 1, b: 2, c: 3 }]);
        expect(result).toEqual([{ a: 1, b: 2 }]);
    });

    it('select — non-existent field ignored', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [{ op: 'select', fields: ['a', 'z'] }],
        };
        const result = executeTransform(config, [{ a: 1, b: 2 }]);
        expect(result).toEqual([{ a: 1 }]);
    });

    it('drop — removes specified fields', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [{ op: 'drop', fields: ['b'] }],
        };
        const result = executeTransform(config, [{ a: 1, b: 2, c: 3 }]);
        expect(result).toEqual([{ a: 1, c: 3 }]);
    });

    it('drop — non-existent field ignored', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [{ op: 'drop', fields: ['z'] }],
        };
        const result = executeTransform(config, [{ a: 1, b: 2 }]);
        expect(result).toEqual([{ a: 1, b: 2 }]);
    });

    it('rename — renames field and removes original', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [{ op: 'rename', from: 'firstName', to: 'first' }],
        };
        const result = executeTransform(config, [{ firstName: 'Ada' }]);
        expect(result).toEqual([{ first: 'Ada' }]);
    });

    it('rename — leaves item unchanged if source field missing', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [{ op: 'rename', from: 'missing', to: 'alias' }],
        };
        const result = executeTransform(config, [{ a: 1 }]);
        expect(result).toEqual([{ a: 1 }]);
    });

    it('add — static value', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [{ op: 'add', field: 'env', value: 'prod' }],
        };
        const result = executeTransform(config, [{ a: 1 }]);
        expect(result).toEqual([{ a: 1, env: 'prod' }]);
    });

    it('add — template substitution', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [{ op: 'add', field: 'full', value: '{{first}} {{last}}' }],
        };
        const result = executeTransform(config, [{ first: 'Ada', last: 'L' }]);
        expect(result).toEqual([{ first: 'Ada', last: 'L', full: 'Ada L' }]);
    });

    it('add — unknown template field resolves to empty string', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [{ op: 'add', field: 'out', value: '{{missing}}' }],
        };
        const result = executeTransform(config, [{ a: 1 }]);
        expect(result).toEqual([{ a: 1, out: '' }]);
    });

    it('ops applied in sequence — select then rename', () => {
        const config: TransformNodeConfig = {
            type: 'transform',
            ops: [
                { op: 'select', fields: ['a', 'b'] },
                { op: 'rename', from: 'a', to: 'alpha' },
            ],
        };
        const result = executeTransform(config, [{ a: 1, b: 2, c: 3 }]);
        expect(result).toEqual([{ alpha: 1, b: 2 }]);
    });
});
