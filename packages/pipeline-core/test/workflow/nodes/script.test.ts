import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { executeScript } from '../../../src/workflow/nodes/script';
import type { ScriptNodeConfig, WorkflowExecutionOptions } from '../../../src/workflow/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cfg(partial: Partial<ScriptNodeConfig> & { run: string }): ScriptNodeConfig {
    return { type: 'script', ...partial };
}

const defaultOptions: WorkflowExecutionOptions = {
    workflowDirectory: process.cwd(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeScript', { timeout: 30_000 }, () => {
    it('json input/output — items are enriched', async () => {
        const config = cfg({
            run: 'node -e "const d=JSON.parse(require(\'fs\').readFileSync(0,\'utf8\')); process.stdout.write(JSON.stringify(d.map(i=>({...i,enriched:true}))))"',
            input: 'json',
            output: 'json',
        });
        const result = await executeScript(config, [{ id: '1', name: 'foo' }], defaultOptions);
        expect(result).toEqual([{ id: '1', name: 'foo', enriched: true }]);
    });

    it('passthrough — original items returned, stdout ignored', async () => {
        const config = cfg({
            run: 'node -e "process.stdout.write(\'ignored\')"',
            output: 'passthrough',
            input: 'none',
        });
        const input = [{ id: 'x' }];
        const result = await executeScript(config, input, defaultOptions);
        expect(result).toEqual(input);
    });

    it('input:none — script receives no stdin data', async () => {
        const config = cfg({
            run: 'node -e "process.stdout.write(JSON.stringify([{received:false}]))"',
            input: 'none',
            output: 'json',
        });
        const result = await executeScript(config, [{ ignored: true }], defaultOptions);
        expect(result).toEqual([{ received: false }]);
    });

    it('non-zero exit with onError:abort throws', async () => {
        const config = cfg({
            run: 'node -e "process.exit(1)"',
            onError: 'abort',
        });
        await expect(executeScript(config, [], defaultOptions)).rejects.toThrow(
            /exited with code 1/
        );
    });

    it('non-zero exit with default onError throws', async () => {
        const config = cfg({
            run: 'node -e "process.exit(1)"',
        });
        await expect(executeScript(config, [], defaultOptions)).rejects.toThrow(
            /exited with code 1/
        );
    });

    it('non-zero exit with onError:warn returns []', async () => {
        const config = cfg({
            run: 'node -e "process.exit(2)"',
            onError: 'warn',
        });
        const result = await executeScript(config, [], defaultOptions);
        expect(result).toEqual([]);
    });

    it('timeout — rejects when script exceeds timeout', async () => {
        const config = cfg({
            run: 'node -e "setTimeout(()=>{},10000)"',
            timeoutMs: 100,
        });
        await expect(executeScript(config, [], defaultOptions)).rejects.toThrow(
            /timed out/i
        );
    });

    it('cwd — process runs in specified directory', async () => {
        const tmpDir = fs.realpathSync(os.tmpdir());
        const config = cfg({
            run: 'node -e "process.stdout.write(JSON.stringify([{cwd:process.cwd()}]))"',
            cwd: tmpDir,
            input: 'none',
            output: 'json',
        });
        const result = await executeScript(config, [], defaultOptions);
        expect(result[0].cwd).toBe(tmpDir);
    });

    it('cwd — relative cwd resolved from workflowDirectory', async () => {
        const tmpDir = fs.realpathSync(os.tmpdir());
        const config = cfg({
            run: 'node -e "process.stdout.write(JSON.stringify([{cwd:process.cwd()}]))"',
            cwd: '.',
            input: 'none',
            output: 'json',
        });
        const opts: WorkflowExecutionOptions = { workflowDirectory: tmpDir };
        const result = await executeScript(config, [], opts);
        expect(result[0].cwd).toBe(tmpDir);
    });

    it('env — custom env vars accessible in script', async () => {
        const config = cfg({
            run: 'node -e "process.stdout.write(JSON.stringify([{val:process.env.MY_VAR}]))"',
            env: { MY_VAR: 'hello' },
            input: 'none',
            output: 'json',
        });
        const result = await executeScript(config, [], defaultOptions);
        expect(result).toEqual([{ val: 'hello' }]);
    });

    it('text output mode — stdout becomes [{text: ...}]', async () => {
        const config = cfg({
            run: 'node -e "process.stdout.write(\'hello world\')"',
            input: 'none',
            output: 'text',
        });
        const result = await executeScript(config, [], defaultOptions);
        expect(result).toEqual([{ text: 'hello world' }]);
    });

    it('json output with markdown code fences — strips fences and parses', async () => {
        // Use String.fromCharCode(96) for backtick to avoid shell escaping issues
        const script = `node -e "var bt=String.fromCharCode(96);process.stdout.write(bt+bt+bt+'json\\n[{\\"x\\":1}]\\n'+bt+bt+bt)"`;
        const config = cfg({
            run: script,
            input: 'none',
            output: 'json',
        });
        const result = await executeScript(config, [], defaultOptions);
        expect(result).toEqual([{ x: 1 }]);
    });

    it('spawn error — executable not found rejects (shell exit code)', async () => {
        const config = cfg({
            run: 'this-executable-does-not-exist-abc123',
        });
        await expect(executeScript(config, [], defaultOptions)).rejects.toThrow();
    });

    it('csv input mode — items serialized as CSV to stdin', async () => {
        // Script reads CSV from stdin and echoes back as JSON
        const script = `node -e "const lines=require('fs').readFileSync(0,'utf8').trim().split('\\n'); const [hdr,...rows]=lines; const keys=hdr.split(','); process.stdout.write(JSON.stringify(rows.map(r=>{const v=r.split(',');const o={};keys.forEach((k,i)=>o[k]=v[i]);return o;})))"`;
        const config = cfg({
            run: script,
            input: 'csv',
            output: 'json',
        });
        const result = await executeScript(config, [{ name: 'alice', age: '30' }], defaultOptions);
        expect(result).toEqual([{ name: 'alice', age: '30' }]);
    });

    it('default output is passthrough when not specified', async () => {
        const config = cfg({
            run: 'node -e "process.stdout.write(\'anything\')"',
            input: 'none',
        });
        const input = [{ keep: 'me' }];
        const result = await executeScript(config, input, defaultOptions);
        expect(result).toEqual(input);
    });

    it('json output with empty stdout returns empty array', async () => {
        const config = cfg({
            run: 'node -e ""',
            input: 'none',
            output: 'json',
        });
        const result = await executeScript(config, [], defaultOptions);
        expect(result).toEqual([]);
    });

    it('json output with non-array throws', async () => {
        const config = cfg({
            run: 'node -e "process.stdout.write(JSON.stringify({not:\'array\'}))"',
            input: 'none',
            output: 'json',
        });
        await expect(executeScript(config, [], defaultOptions)).rejects.toThrow(
            /must be a JSON array/
        );
    });

    it('timeoutMs from options is used as fallback', async () => {
        const config = cfg({
            run: 'node -e "setTimeout(()=>{},10000)"',
        });
        const opts: WorkflowExecutionOptions = {
            workflowDirectory: process.cwd(),
            timeoutMs: 100,
        };
        await expect(executeScript(config, [], opts)).rejects.toThrow(/timed out/i);
    });

    it('csv input with empty items sends empty stdin', async () => {
        const config = cfg({
            run: 'node -e "const d=require(\'fs\').readFileSync(0,\'utf8\'); process.stdout.write(JSON.stringify([{empty: d.length === 0}]))"',
            input: 'csv',
            output: 'json',
        });
        const result = await executeScript(config, [], defaultOptions);
        expect(result).toEqual([{ empty: true }]);
    });
});
