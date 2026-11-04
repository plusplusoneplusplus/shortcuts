import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as workflow from '@plusplusoneplusplus/coc-workflow';
import * as workflowErrors from '@plusplusoneplusplus/coc-workflow/errors';
import * as workflowCodes from '@plusplusoneplusplus/coc-workflow/errors/error-codes';
import * as workflowCoreError from '@plusplusoneplusplus/coc-workflow/errors/pipeline-core-error';
import * as workflowLogger from '@plusplusoneplusplus/coc-workflow/logger';
import * as workflowCancellation from '@plusplusoneplusplus/coc-workflow/runtime/cancellation';
import * as workflowLimiter from '@plusplusoneplusplus/coc-workflow/runtime/concurrency-limiter';
import * as workflowDefaults from '@plusplusoneplusplus/coc-workflow/config/defaults';
import * as workflowPrompts from '@plusplusoneplusplus/coc-workflow/utils/prompt-resolver';
import * as workflowCSV from '@plusplusoneplusplus/coc-workflow/utils/csv-reader';
import * as workflowTemplates from '@plusplusoneplusplus/coc-workflow/utils/template-engine';
import * as workflowSkills from '@plusplusoneplusplus/coc-workflow/skills/skill-resolver';
import * as forge from '../../src';
import * as forgeErrors from '../../src/errors';
import * as forgeCodes from '../../src/errors/error-codes';
import * as forgeCoreError from '../../src/errors/pipeline-core-error';
import * as forgeLogger from '../../src/logger';
import * as forgeCancellation from '../../src/runtime/cancellation';
import * as forgeLimiter from '../../src/runtime/concurrency-limiter';
import * as forgeDefaults from '../../src/config/defaults';
import * as forgePrompts from '../../src/utils/prompt-resolver';
import * as forgeCSV from '../../src/utils/csv-reader';
import * as forgeTemplates from '../../src/utils/template-engine';
import * as forgeSkills from '../../src/skills/skill-resolver';

const sharedModules = [
    ['errors', forgeErrors, workflowErrors],
    ['errors/error-codes', forgeCodes, workflowCodes],
    ['errors/pipeline-core-error', forgeCoreError, workflowCoreError],
    ['logger', forgeLogger, workflowLogger],
    ['runtime/cancellation', forgeCancellation, workflowCancellation],
    ['runtime/concurrency-limiter', forgeLimiter, workflowLimiter],
    ['config/defaults', forgeDefaults, workflowDefaults],
    ['utils/prompt-resolver', forgePrompts, workflowPrompts],
    ['utils/csv-reader', forgeCSV, workflowCSV],
    ['utils/template-engine', forgeTemplates, workflowTemplates],
    ['skills/skill-resolver', forgeSkills, workflowSkills],
] as const;

describe('shared workflow primitives', () => {
    afterEach(() => {
        workflow.resetLogger();
    });

    it.each(sharedModules)('%s delegates every runtime export to coc-workflow', (_name, wrapper, canonical) => {
        // CommonJS interop adds a default namespace, which is not a named API export.
        const names = Object.keys(canonical).filter(name => name !== 'default').sort();
        expect(Object.keys(wrapper).filter(name => name !== 'default').sort()).toEqual(names);
        for (const name of names) {
            expect((wrapper as Record<string, unknown>)[name]).toBe(
                (canonical as Record<string, unknown>)[name],
            );
        }
    });

    it('shares the core constructor and codes through both roots and error leaves', () => {
        for (const api of [forge, forgeErrors, forgeCoreError, workflow, workflowErrors, workflowCoreError]) {
            expect(api.PipelineCoreError).toBe(workflow.PipelineCoreError);
            expect(api.ErrorCode).toBe(workflow.ErrorCode);
        }
        expect(forgeCodes.WorkflowErrorCode).toBe(workflowCodes.WorkflowErrorCode);
    });

    it.each([
        ['Forge CSV', () => forge.parseCSVContent('key,key\none,two')],
        ['workflow CSV', () => workflow.parseCSVContent('key,key\none,two')],
        ['Forge template consumer', () => forge.renderTemplate(
            forge.createTemplate({ template: '{{required}}' }), { variables: {} },
        )],
        ['workflow compiler', () => workflow.compileToWorkflow('invalid: true')],
        ['Forge cancellation', () => forge.throwIfCancelled(() => true)],
        ['workflow cancellation', () => workflow.throwIfWorkflowCancelled(AbortSignal.abort())],
    ] as const)('%s throws errors recognised by either package', (_name, fail) => {
        let caught: unknown;
        try {
            fail();
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(forge.PipelineCoreError);
        expect(caught).toBeInstanceOf(workflow.PipelineCoreError);
        expect(forge.isPipelineCoreError(caught)).toBe(true);
        expect(workflow.isPipelineCoreError(caught)).toBe(true);
        expect(forge.toPipelineCoreError(caught)).toBe(caught);
        expect(workflow.toPipelineCoreError(caught)).toBe(caught);
        expect(forge.wrapError('context', caught).cause).toBe(caught);
    });

    it('shares logger functions, sinks and configuration in both directions', () => {
        for (const api of [forge, forgeLogger, workflow, workflowLogger]) {
            expect(api.setLogger).toBe(workflow.setLogger);
            expect(api.getLogger).toBe(workflow.getLogger);
            expect(api.resetLogger).toBe(workflow.resetLogger);
            expect(api.consoleLogger).toBe(workflow.consoleLogger);
            expect(api.nullLogger).toBe(workflow.nullLogger);
            expect(api.LogCategory).toBe(workflow.LogCategory);
        }
        const sink = { ...workflow.nullLogger, error: vi.fn() };
        for (const configure of [forge.setLogger, workflowLogger.setLogger]) {
            configure(sink);
            expect(forgeLogger.getLogger()).toBe(sink);
            expect(workflow.getLogger()).toBe(sink);
            const error = new forge.PipelineCoreError('failed', { code: workflow.ErrorCode.CSV_PARSE_ERROR });
            forge.logError('Test', 'consumer', error);
            workflow.logError('Test', 'consumer', error);
            expect(sink.error).toHaveBeenLastCalledWith('Test', 'consumer: [CSV_PARSE_ERROR] failed', error);
            workflowLogger.resetLogger();
            expect(forge.getLogger()).toBe(workflow.consoleLogger);
        }
        expect(sink.error).toHaveBeenCalledTimes(4);
    });

    it('shares cancellation recognition while keeping tokens and limiter capacity isolated', async () => {
        let cancelled = false;
        const firstToken = forgeCancellation.createCancellationToken(() => cancelled);
        const secondToken = workflowCancellation.createCancellationToken();
        cancelled = true;
        expect(() => firstToken.throwIfCancelled({ taskId: 'first' })).toThrow(workflowCancellation.CancellationError);
        expect(secondToken.isCancelled()).toBe(false);
        expect(() => secondToken.throwIfCancelled()).not.toThrow();
        const error = new workflow.PipelineCoreError('stop', { code: workflow.ErrorCode.CANCELLED });
        expect(forgeCancellation.isCancellationError(error)).toBe(true);
        expect(workflow.isWorkflowCancellationError(new forgeCancellation.CancellationError())).toBe(true);

        const first = new forgeLimiter.ConcurrencyLimiter(1);
        const second = new workflowLimiter.ConcurrencyLimiter(1);
        expect(first.tryAcquire()).toBe(true);
        expect(first.tryAcquire()).toBe(false);
        expect(second.tryAcquire()).toBe(true);
        first.releaseSlot();
        second.releaseSlot();
        await expect(first.run(async () => 'unused', () => true)).rejects.toBeInstanceOf(workflowLimiter.CancellationError);
        await expect(second.run(async () => 'active')).resolves.toBe('active');
    });

    it('resolves emitted wrappers and public package paths in plain Node', () => {
        // Use the real Node resolver, outside Vitest's source transform/module cache.
        execFileSync(process.execPath, ['--input-type=module', '-e', `
            import { createRequire } from 'node:module';
            const require = createRequire(import.meta.url);
            const assert = require('node:assert/strict');
            const path = require('node:path');
            const forge = require('@plusplusoneplusplus/forge');
            const workflow = require('@plusplusoneplusplus/coc-workflow');
            const forgeWorkflow = require('@plusplusoneplusplus/forge/workflow');
            const workflowAPI = require('@plusplusoneplusplus/coc-workflow/workflow');
            const forgeUtils = require('@plusplusoneplusplus/forge/utils');
            const forgeMapReduce = require('@plusplusoneplusplus/forge/map-reduce');
            const forgeDist = path.dirname(require.resolve('@plusplusoneplusplus/forge'));
            for (const name of ${JSON.stringify(sharedModules.map(([name]) => name))}) {
                const wrapper = require(path.join(forgeDist, name));
                const canonical = require('@plusplusoneplusplus/coc-workflow/' + name);
                assert.deepEqual(Object.keys(wrapper).sort(), Object.keys(canonical).sort());
                for (const key of Object.keys(canonical)) assert.equal(wrapper[key], canonical[key]);
            }
            assert.equal(forge.PipelineCoreError, workflow.PipelineCoreError);
            assert.equal(forge.ErrorCode, workflow.ErrorCode);
            assert.equal(forge.CSVParseError, workflow.CSVParseError);
            assert.equal(forge.ConcurrencyLimiter, workflowAPI.ConcurrencyLimiter);
            assert.equal(forgeMapReduce.ConcurrencyLimiter, workflowAPI.ConcurrencyLimiter);
            assert.equal(forgeWorkflow.WorkflowCancellationError, workflowAPI.WorkflowCancellationError);
            const templates = require('@plusplusoneplusplus/coc-workflow/utils/template-engine');
            assert.equal(forgeUtils.substituteVariables, templates.substituteVariables);
            for (const api of [forge, workflow]) {
                assert.throws(() => api.parseCSVContent('key,key'), error =>
                    error instanceof forge.PipelineCoreError && error instanceof workflow.PipelineCoreError);
                api.setLogger(api.nullLogger);
                assert.equal(forge.getLogger(), api.nullLogger);
                assert.equal(workflow.getLogger(), api.nullLogger);
                api.resetLogger();
                assert.equal(forge.getLogger(), workflow.consoleLogger);
            }
            const forgeESM = await import('@plusplusoneplusplus/forge');
            const workflowESM = await import('@plusplusoneplusplus/coc-workflow');
            assert.equal(forgeESM.PipelineCoreError, workflow.PipelineCoreError);
            assert.equal(workflowESM.PipelineCoreError, forge.PipelineCoreError);
            assert.equal(forgeESM.setLogger, workflowESM.setLogger);
        `], { cwd: path.resolve(import.meta.dirname, '../..'), stdio: 'pipe', timeout: 10000 });
    });
});

describe('resolver semantics across workspaces', () => {
    let tempDir: string;
    let roots: string[];

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-workflow-'));
        roots = [path.join(tempDir, 'first'), path.join(tempDir, 'second')];
        for (const root of roots) {
            await fs.mkdir(root, { recursive: true });
        }
    });

    afterEach(async () => {
        workflow.resetLogger();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('runs CSV, skill and template consumers concurrently without crossing workspace roots', async () => {
        forge.setLogger(forge.nullLogger);
        const run = async (root: string, index: number) => {
            const directory = path.join(root, '.github', 'skills', 'shared');
            await fs.mkdir(directory, { recursive: true });
            await fs.writeFile(path.join(directory, 'SKILL.md'), `---\nname: shared\n---\nSkill ${index}`);
            await fs.writeFile(path.join(root, 'input.csv'), `name\r\nItem ${index}\r\n`);
            const execute = index === 0 ? forge.executeWorkflow : workflow.executeWorkflow;
            const prompts: string[] = [];
            const result = await execute({
                name: 'isolated',
                parameters: { suffix: `Parameter ${index}` },
                nodes: {
                    input: { type: 'load', source: { type: 'csv', path: 'input.csv' } },
                    mapped: {
                        type: 'map', from: ['input'], skill: 'shared',
                        prompt: '{{name}} {{suffix}}', output: ['result'],
                    },
                },
            }, {
                workflowDirectory: root,
                workspaceRoot: root,
                aiInvoker: async prompt => {
                    prompts.push(prompt);
                    return { success: true, response: JSON.stringify({ result: prompt }) };
                },
            });
            const expected = `Skill ${index}\n\nItem ${index} Parameter ${index}`;
            expect(result.success).toBe(true);
            expect(prompts).toEqual([expected]);
            expect(result.leaves.get('mapped')?.items).toEqual([{ name: `Item ${index}`, result: expected }]);
        };
        await Promise.all(roots.map(run));
    });

    it('preserves skill metadata, custom roots, sync/async parity and input validation', async () => {
        for (const [index, root] of roots.entries()) {
            const relativeSkills = index === 0 ? undefined : 'custom-skills';
            const skills = relativeSkills ?? workflowDefaults.DEFAULT_SKILLS_DIRECTORY;
            const directory = path.join(root, skills, 'shared');
            const file = path.join(directory, 'SKILL.md');
            const content = `---\r\nname: shared\r\ndescription: Example\r\nmetadata:\r\n  version: "2.0"\r\nvariables: [input]\r\noutput: [result]\r\n---\r\nWorkspace ${index}`;
            await fs.mkdir(directory, { recursive: true });
            await fs.writeFile(file, content);
            for (const api of [forgeSkills, workflowSkills]) {
                const result = await api.resolveSkillWithDetails('shared', root, relativeSkills);
                expect(result).toEqual(api.resolveSkillWithDetailsSync('shared', root, path.join(root, skills)));
                expect(result).toMatchObject({
                    content: `Workspace ${index}`, resolvedPath: file, skillDirectory: directory, hadFrontmatter: true,
                    metadata: { name: 'shared', description: 'Example', version: '2.0', variables: ['input'], output: ['result'], raw: content },
                });
                expect(await api.resolveSkill('shared', root, relativeSkills)).toBe(`Workspace ${index}`);
                expect(api.resolveSkillSync('shared', root, relativeSkills)).toBe(`Workspace ${index}`);
                expect(api.listSkills(root, relativeSkills)).toEqual(['shared']);
                expect(api.validateSkill('shared', root, relativeSkills)).toEqual({ valid: true, skillPath: file });
                for (const invalid of ['', '../shared', 'nested/shared', 'nested\\shared']) {
                    await expect(api.resolveSkill(invalid, root, relativeSkills)).rejects.toBeInstanceOf(workflow.SkillResolverError);
                    expect(() => api.resolveSkillSync(invalid, root, relativeSkills)).toThrow(workflow.SkillResolverError);
                    expect(api.validateSkill(invalid, root, relativeSkills).valid).toBe(false);
                }
                await expect(api.resolveSkill('missing', root, relativeSkills)).rejects.toMatchObject({
                    code: workflow.ErrorCode.SKILL_RESOLUTION_FAILED, skillName: 'missing',
                });
            }
            await fs.writeFile(file, '---\nname: empty\n---\n');
            await expect(forgeSkills.resolveSkill('shared', root, relativeSkills)).rejects.toBeInstanceOf(workflow.SkillResolverError);
            expect(() => workflowSkills.resolveSkillSync('shared', root, relativeSkills)).toThrow(forgeSkills.SkillResolverError);
        }
    });

    it('preserves prompt search order, explicit paths, frontmatter and searched-path errors', async () => {
        const sharedDir = path.join(tempDir, 'prompts');
        await fs.mkdir(sharedDir);
        await fs.writeFile(path.join(sharedDir, 'shared.md'), 'Shared prompt');
        for (const [index, root] of roots.entries()) {
            await fs.mkdir(path.join(root, 'prompts'));
            await fs.writeFile(path.join(root, 'prompts', 'prompt.md'), 'Nested prompt');
            const localFile = path.join(root, 'prompt.md');
            await fs.writeFile(localFile, `---\r\nname: local\r\n---\r\nWorkspace ${index}`);
            for (const api of [forgePrompts, workflowPrompts]) {
                expect(await api.resolvePromptFileWithDetails('prompt.md', root)).toEqual({
                    content: `Workspace ${index}`, resolvedPath: localFile, hadFrontmatter: true,
                });
                expect(api.resolvePromptFileSync(localFile, root)).toBe(`Workspace ${index}`);
                expect(await api.resolvePromptFile(path.join('prompts', 'prompt.md'), root)).toBe('Nested prompt');
                expect(await api.resolvePromptFile('shared.md', root)).toBe('Shared prompt');
                expect(api.validatePromptFile('missing.md', root)).toMatchObject({
                    valid: false, searchedPaths: api.getSearchPaths('missing.md', root),
                });
                await expect(api.resolvePromptFile('missing.md', root)).rejects.toBeInstanceOf(workflowPrompts.PromptResolverError);
                expect(() => api.resolvePromptFileSync('missing.md', root)).toThrow(forgePrompts.PromptResolverError);
            }
            await fs.rm(localFile);
            expect(await forgePrompts.resolvePromptFile('prompt.md', root)).toBe('Nested prompt');
            await fs.writeFile(localFile, '---\nname: empty\n---\n');
            await expect(forgePrompts.resolvePromptFile('prompt.md', root)).rejects.toBeInstanceOf(workflow.PipelineCoreError);
        }
    });

    it('preserves CSV options, quoted fields, mixed newlines and read errors', async () => {
        const content = 'name;detail\r\none;"a;b"\rtwo;"line1\r\nline2 ""quoted"""';
        const file = path.join(roots[0], 'input.csv');
        await fs.writeFile(file, content);
        const expected = {
            headers: ['name', 'detail'], rowCount: 2,
            items: [{ name: 'one', detail: 'a;b' }, { name: 'two', detail: 'line1\nline2 "quoted"' }],
        };
        for (const api of [forgeCSV, workflowCSV]) {
            expect(api.parseCSVContent(content, { delimiter: ';', hasHeaders: undefined })).toEqual(expected);
            expect(await api.readCSVFile(file, { delimiter: ';' })).toEqual(expected);
            expect(api.readCSVFileSync(file, { delimiter: ';' })).toEqual(expected);
            expect(api.parseCSVContent('a,b', { hasHeaders: false }).items).toEqual([{ col0: 'a', col1: 'b' }]);
            expect(api.parseCSVContent('').items).toEqual([]);
            await expect(api.readCSVFile(path.join(roots[1], 'missing.csv'))).rejects.toBeInstanceOf(workflow.CSVParseError);
            expect(() => api.readCSVFileSync(path.join(roots[1], 'missing.csv'))).toThrow(forgeCSV.CSVParseError);
        }
    });

    it('preserves template modes and the map-reduce consumer override for system variables', () => {
        for (const api of [forgeTemplates, workflowTemplates]) {
            expect(api.substituteVariables('{{data}} {{nil}} {{missing}} {{ITEMS}}', { data: { value: 1 }, nil: null }))
                .toBe('{"value":1}   {{ITEMS}}');
            expect(api.substituteVariables('{{missing}}', {}, { missingValueBehavior: 'preserve' })).toBe('{{missing}}');
            expect(() => api.substituteVariables('{{missing}}', {}, { strict: true })).toThrow(workflowTemplates.TemplateVariableError);
            expect(api.substituteVariables('{{ITEMS}}', {}, { strict: true })).toBe('{{ITEMS}}');
            expect(api.substituteVariables('{{ITEMS}}', { ITEMS: [1] }, { preserveSpecialVariables: false })).toBe('[1]');
        }
        expect(forge.renderTemplate(
            forge.createTemplate({ template: '{{ITEMS}} {{optional}}', requiredVariables: ['ITEMS'] }),
            { variables: { ITEMS: [1] } },
        )).toBe('[1] {{optional}}');
    });
});
