import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const requirePackage = createRequire(import.meta.url);
const packageRoot = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, string>;
    typesVersions: Record<string, Record<string, string[]>>;
    dependencies: Record<string, string>;
};

const modules = [
    ['errors', 'errors/index'],
    ['errors/error-codes', 'errors/error-codes'],
    ['errors/pipeline-core-error', 'errors/pipeline-core-error'],
    ['logger', 'logger'],
    ['runtime/cancellation', 'runtime/cancellation'],
    ['runtime/concurrency-limiter', 'runtime/concurrency-limiter'],
    ['config/defaults', 'config/defaults'],
    ['utils/prompt-resolver', 'utils/prompt-resolver'],
    ['utils/csv-reader', 'utils/csv-reader'],
    ['utils/template-engine', 'utils/template-engine'],
    ['skills/skill-resolver', 'skills/skill-resolver'],
] as const;

describe('shared primitives package boundary', () => {
    it.each(modules)('exports %s with matching runtime and declaration paths', (name, file) => {
        expect(manifest.exports[`./${name}`]).toBe(`./dist/${file}.js`);
        expect(manifest.typesVersions['*'][name]).toEqual([`dist/${file}.d.ts`]);
        expect(requirePackage.resolve(`@plusplusoneplusplus/coc-workflow/${name}`))
            .toBe(path.join(packageRoot, 'dist', `${file}.js`));
        expect(fs.existsSync(path.join(packageRoot, 'dist', `${file}.d.ts`))).toBe(true);
    });

    it('keeps primitives independent of consumers', () => {
        expect(manifest.dependencies).not.toHaveProperty('@plusplusoneplusplus/forge');
        expect(manifest.dependencies).not.toHaveProperty('@plusplusoneplusplus/coc');
    });

    it('shares root, subpath and workflow constructor identities through Node resolution', () => {
        const root = requirePackage('@plusplusoneplusplus/coc-workflow');
        const errors = requirePackage('@plusplusoneplusplus/coc-workflow/errors');
        const logger = requirePackage('@plusplusoneplusplus/coc-workflow/logger');
        const cancellation = requirePackage('@plusplusoneplusplus/coc-workflow/runtime/cancellation');
        const limiter = requirePackage('@plusplusoneplusplus/coc-workflow/runtime/concurrency-limiter');
        expect(root.PipelineCoreError).toBe(errors.PipelineCoreError);
        expect(root.ErrorCode).toBe(errors.ErrorCode);
        expect(root.getLogger).toBe(logger.getLogger);
        expect(root.ConcurrencyLimiter).toBe(limiter.ConcurrencyLimiter);
        expect(new root.CancellationError()).toBeInstanceOf(cancellation.CancellationError);
        expect(new root.WorkflowCancellationError()).toBeInstanceOf(errors.PipelineCoreError);
    });
});
