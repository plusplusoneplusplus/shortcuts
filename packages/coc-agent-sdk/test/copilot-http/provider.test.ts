import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopilotSDKService } from '../../src/copilot-sdk-service';
import { denyAllPermissions } from '../../src/types';
import { createMockSDKService } from '../../src/testing';

const runtime = vi.hoisted(() => ({ load: vi.fn(() => { throw new Error('SDK must not load'); }), create: vi.fn(() => { throw new Error('Copilot must not spawn'); }) }));
vi.mock('../../src/sdk-esm-loader', () => ({ loadCopilotSdk: runtime.load }));
vi.mock('../../src/sdk-client-factory', () => ({ createSdkClient: runtime.create, getLastCopilotElectronSpawn: vi.fn() }));
const catalog = { data: [{ id: 'gpt-5.4-mini', supported_endpoints: ['/responses'] }] };
const result = { model: 'gpt-5.4-mini-2026-03-17', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'yes' }] }] };
let service: CopilotSDKService | undefined;
afterEach(() => { service?.dispose(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
function direct() {
    const fetcher = vi.fn(async (url: any) => new Response(JSON.stringify(String(url).endsWith('/models') ? catalog : result)));
    service = new CopilotSDKService({ transformTransport: 'direct', direct: { credential: { source: 'resolver', resolve: async () => ({ token: 'gho_test', host: 'github.com', login: 'test' }) }, fetch: fetcher } });
    return fetcher;
}
describe('Copilot transform routing', () => {
    it('readiness and transform succeed without SDK import/spawn, preserving a deny callback without invoking it', async () => {
        const fetcher = direct(); const permissions = vi.fn(denyAllPermissions);
        expect(await service!.isTransformAvailable({ model: 'gpt-5.4-mini', loadDefaultMcpConfig: false })).toEqual({ available: true });
        expect(fetcher).not.toHaveBeenCalled();
        expect(await service!.transform('prompt', { model: 'gpt-5.4-mini', cwd: '/workspace/A', onPermissionRequest: permissions })).toMatchObject({ success: true, text: 'yes', effectiveModel: 'gpt-5.4-mini', providerDiagnostics: { transport: 'direct', reportedModel: 'gpt-5.4-mini-2026-03-17' } });
        expect(permissions).not.toHaveBeenCalled(); expect(runtime.load).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
    });
    it.each([{}, { model: 'gpt-5.4-mini', loadDefaultMcpConfig: true }, { model: 'gpt-5.4-mini', sessionId: 'session' }, { model: 'gpt-5.4-mini', attachments: [] }])('rejects ineligible direct options %# without SDK or HTTP work', async options => {
        const fetcher = direct();
        expect(await service!.transform('prompt', options as any)).toMatchObject({ success: false, errorCode: 'DIRECT_NOT_ELIGIBLE', inferenceDispatched: false });
        expect(fetcher).not.toHaveBeenCalled(); expect(runtime.load).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
    });
    it.each(['COPILOT_OFFLINE', 'COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_API_KEY'])('rejects direct with %s set before external work', async key => {
        const fetcher = direct(); vi.stubEnv(key, 'configured');
        expect(await service!.transform('prompt', { model: 'gpt-5.4-mini' })).toMatchObject({ success: false, errorCode: 'DIRECT_CONFIG_INVALID' }); expect(fetcher).not.toHaveBeenCalled();
    });
    it.each(['', 'auto', 'invalid'])('rejects invalid strategy %s without falling back', async strategy => {
        service = new CopilotSDKService({ transformTransport: strategy as any });
        expect(await service.transform('prompt')).toMatchObject({ success: false, errorCode: 'DIRECT_CONFIG_INVALID' });
        expect(await service.isTransformAvailable()).toMatchObject({ available: false, errorCode: 'DIRECT_CONFIG_INVALID' });
        expect(runtime.load).not.toHaveBeenCalled();
    });
    it('direct mode automatically resolves CLI credentials and reports missing CLI authentication', async () => {
        service = new CopilotSDKService({ transformTransport: 'direct' });
        expect(await service.transform('prompt', { model: 'gpt-5.4-mini' })).toMatchObject({ errorCode: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
    });
    it('SDK selection delegates through the established runner and sendMessage path', async () => {
        service = new CopilotSDKService({ transformTransport: 'sdk' });
        const send = vi.spyOn(service, 'sendMessage').mockResolvedValue({ success: true, response: 'sdk answer', effectiveModel: 'sdk-model' });
        expect(await service.transform('prompt', { model: 'sdk-model' })).toMatchObject({ success: true, text: 'sdk answer', effectiveModel: 'sdk-model' });
        expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0][0]).toMatchObject({ prompt: 'prompt', model: 'sdk-model', loadDefaultMcpConfig: false });
    });
    it('agent availability remains on the SDK even when direct readiness works', async () => {
        direct(); expect((await service!.isTransformAvailable({ model: 'gpt-5.4-mini' })).available).toBe(true);
        expect((await service!.isAvailable()).available).toBe(false); expect(runtime.load).toHaveBeenCalled();
    });
    it('disposal stops direct transforms and readiness', async () => {
        const fetcher = direct(); service!.dispose();
        expect(await service!.transform('prompt', { model: 'gpt-5.4-mini' })).toMatchObject({ success: false, errorCode: 'DIRECT_CANCELLED' });
        expect((await service!.isTransformAvailable({ model: 'gpt-5.4-mini' })).available).toBe(false); expect(fetcher).not.toHaveBeenCalled();
    });
    it('ignores removed CoC env configuration and applies the explicit Admin transport', async () => {
        vi.stubEnv('COC_COPILOT_TRANSFORM_TRANSPORT', 'direct');
        vi.stubEnv('COC_COPILOT_CREDENTIAL_SOURCE', 'invalid');
        service = new CopilotSDKService();
        const send = vi.spyOn(service, 'sendMessage').mockResolvedValue({ success: true, response: 'sdk' });
        expect(await service.transform('prompt')).toMatchObject({ success: true, text: 'sdk' });
        service.configureTransformTransport('direct');
        expect(await service.transform('prompt', { model: 'gpt-5.4-mini' })).toMatchObject({ errorCode: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(send).toHaveBeenCalledOnce();
        service.configureTransformTransport('sdk');
        expect(await service.transform('prompt')).toMatchObject({ success: true, text: 'sdk' });
    });
    it('shared service mocks implement independent explicit transform readiness', async () => {
        const mock = createMockSDKService({ available: false }, vi.fn);
        expect(await mock.service.isTransformAvailable()).toEqual({ available: false });
        expect(mock.mockIsTransformAvailable).toHaveBeenCalledOnce(); expect(mock.mockIsAvailable).not.toHaveBeenCalled();
    });
});
