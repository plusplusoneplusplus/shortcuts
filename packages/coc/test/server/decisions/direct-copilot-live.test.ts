import { describe, expect, it } from 'vitest';
import { CopilotHttpClient, CopilotSDKService } from '@plusplusoneplusplus/coc-agent-sdk';
import { createDecisionService } from '../../../src/server/decisions/decision-service';
import { createSystemOneTool } from '../../../src/server/llm-tools/system-one-tool';

/** Opt-in paid inference using the Copilot CLI login; never used in ordinary CI. */
describe.skipIf(process.env.COC_COPILOT_HTTP_LIVE !== '1')('live direct Copilot smoke', () => {
    it('checks both wire APIs and strict schema output on the public host', async () => {
        const client = new CopilotHttpClient();
        try {
            for (const [model, api] of [['gpt-5.4-mini', 'responses'], ['gpt-4.1', 'chat-completions']] as const) {
                const result = await client.complete({ model, api, messages: [{ role: 'user', content: 'Answer exactly: ready' }], timeoutMs: 30_000 });
                expect(result.effectiveModel).toBe(model); expect(result.text.trim()).toBe('ready');
                console.info(JSON.stringify({ experiment: 'direct-live', model, api, durationMs: result.diagnostics.durationMs, timings: result.diagnostics.timings }));
            }
            const schema = await client.complete({ model: 'gpt-5.4-mini', api: 'responses', messages: [{ role: 'user', content: 'Return an object with answer equal to yes.' }],
                jsonSchema: { name: 'answer', strict: true, schema: { type: 'object', properties: { answer: { type: 'string', enum: ['yes', 'no'] } }, required: ['answer'], additionalProperties: false } } });
            expect(JSON.parse(schema.text)).toEqual({ answer: 'yes' });
        } finally { client.dispose(); }
    });
    it('measures real system_one for short/near-limit sources and concurrent workspaces', async () => {
        const service = new CopilotSDKService({ transformTransport: 'direct' });
        const decisions = createDecisionService(service);
        const samples: { scenario: string; durationMs: number }[] = [];
        async function evaluate(scenario: string, text: string, workspaceId: string) {
            const { tool } = createSystemOneTool({ service: decisions, workspaceId, workingDirectory: process.cwd(), getLedger: () => ({ list: async () => [{ id: 'source', name: 'fixture', result: text, status: 'completed', current: true }] } as any) });
            const args = { sources: text.length > 4000 ? [{ tool: 'fixture' }] : [{ text }], questions: {
                safe: { type: 'noul' as const, instructions: 'Does the source explicitly report success?' },
                status: { type: 'choice' as const, instructions: 'Classify the status.', criteria: { success: 'Succeeded', failure: 'Failed' } },
                quality: { type: 'score' as const, instructions: 'Rate the evidence quality.', criteria: ['low', 'medium', 'high'] },
            } };
            const started = performance.now();
            const raw = await tool.handler!(args, { sessionId: 'live-test', toolCallId: 'system-one', toolName: 'system_one', arguments: args });
            const output = JSON.parse(raw as string);
            expect(output).not.toHaveProperty('error'); expect(Object.keys(output.answers)).toEqual(['safe', 'status', 'quality']);
            samples.push({ scenario, durationMs: Math.round(performance.now() - started) });
        }
        try {
            await evaluate('short', 'The build succeeded and all tests passed.', 'live-short');
            // The ledger path exercises source bounding near the 64 KB tool-result limit.
            const nearLimit = 'Successful build evidence. '.repeat(2400);
            await evaluate('near-source-limit', nearLimit, 'live-long');
            await Promise.all([evaluate('concurrent-A', 'The build succeeded.', 'live-A'), evaluate('concurrent-B', 'The build failed.', 'live-B')]);
            const sorted = samples.map(s => s.durationMs).sort((a, b) => a - b);
            console.info(JSON.stringify({ experiment: 'system-one-live', samples, medianMs: (sorted[1] + sorted[2]) / 2 }));
        } finally { service.dispose(); }
    });
});
