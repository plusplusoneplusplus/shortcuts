import { describe, it, expect } from 'vitest';
import { executeMerge } from '../../../src/workflow/nodes/merge';
import type { MergeNodeConfig } from '../../../src/workflow/types';

describe('executeMerge', () => {
    describe('concat strategy', () => {
        it('concatenates two arrays of the same length', () => {
            const config: MergeNodeConfig = { type: 'merge', strategy: 'concat' };
            const result = executeMerge(config, [
                [{ a: 1 }, { a: 2 }],
                [{ b: 3 }, { b: 4 }],
            ]);
            expect(result).toEqual([{ a: 1 }, { a: 2 }, { b: 3 }, { b: 4 }]);
        });

        it('concatenates two arrays of different lengths', () => {
            const config: MergeNodeConfig = { type: 'merge', strategy: 'concat' };
            const short = [{ x: 1 }];
            const long = [{ y: 1 }, { y: 2 }, { y: 3 }];
            const result = executeMerge(config, [short, long]);
            expect(result).toHaveLength(4);
            expect(result).toEqual([{ x: 1 }, { y: 1 }, { y: 2 }, { y: 3 }]);
        });

        it('concatenates three parent arrays in declaration order', () => {
            const config: MergeNodeConfig = { type: 'merge', strategy: 'concat' };
            const result = executeMerge(config, [
                [{ a: 1 }],
                [{ b: 2 }],
                [{ c: 3 }],
            ]);
            expect(result).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
        });

        it('handles one empty parent array', () => {
            const config: MergeNodeConfig = { type: 'merge', strategy: 'concat' };
            const result = executeMerge(config, [
                [],
                [{ a: 1 }, { a: 2 }],
            ]);
            expect(result).toEqual([{ a: 1 }, { a: 2 }]);
        });
    });

    describe('zip strategy', () => {
        it('zips two arrays of the same length', () => {
            const config: MergeNodeConfig = { type: 'merge', strategy: 'zip' };
            const result = executeMerge(config, [
                [{ a: 1 }, { a: 2 }],
                [{ b: 3 }, { b: 4 }],
            ]);
            expect(result).toEqual([{ a: 1, b: 3 }, { a: 2, b: 4 }]);
        });

        it('truncates to the shortest array length', () => {
            const config: MergeNodeConfig = { type: 'merge', strategy: 'zip' };
            const result = executeMerge(config, [
                [{ a: 1 }, { a: 2 }, { a: 3 }],
                [{ b: 10 }],
            ]);
            expect(result).toHaveLength(1);
            expect(result).toEqual([{ a: 1, b: 10 }]);
        });

        it('later parent wins on field collision', () => {
            const config: MergeNodeConfig = { type: 'merge', strategy: 'zip' };
            const result = executeMerge(config, [
                [{ x: 1 }],
                [{ x: 2 }],
            ]);
            expect(result).toEqual([{ x: 2 }]);
        });
    });

    it('defaults to concat when strategy is absent', () => {
        const config: MergeNodeConfig = { type: 'merge' };
        const result = executeMerge(config, [
            [{ a: 1 }],
            [{ b: 2 }],
        ]);
        expect(result).toEqual([{ a: 1 }, { b: 2 }]);
    });
});
