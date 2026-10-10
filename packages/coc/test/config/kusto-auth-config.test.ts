import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from '../../src/config';
import { CLIConfigSchema } from '../../src/config/schema';
import { RuntimeConfigService } from '../../src/config/runtime-config-service';
import { getNamespaceFieldSource } from '../../src/config/namespace-registry';
import { ADMIN_SETTING_DEFINITIONS } from '../../src/config/admin-setting-definitions';

const azureCli = {
    account: 'fixture-account',
    tenant: '11111111-1111-4111-8111-111111111111',
    subscription: '22222222-2222-4222-8222-222222222222',
};

describe('explicit host Kusto auth config', () => {
    it('has one feature toggle and no authentication implementation selector', () => {
        expect(ADMIN_SETTING_DEFINITIONS.filter(def => def.key.startsWith('kusto.')).map(def => def.key))
            .toEqual(['kusto.enabled']);
        const obsoleteConfig = { kusto: { enabled: true, rustAuthEnabled: false } };
        expect(mergeConfig(DEFAULT_CONFIG, obsoleteConfig).kusto)
            .not.toHaveProperty('rustAuthEnabled');
    });
    it('defaults Kusto off and resolves file-only identity through the host snapshot', () => {
        expect(DEFAULT_CONFIG.kusto.enabled).toBe(false);
        expect(DEFAULT_CONFIG.kusto).not.toHaveProperty('rustAuthEnabled');
        const config = { kusto: { enabled: true, azureCli } };
        expect(CLIConfigSchema.parse(config)).toMatchObject(config);
        expect(mergeConfig(DEFAULT_CONFIG, config).kusto).toEqual(config.kusto);
        const service = new RuntimeConfigService({ fileConfig: config });
        expect(service.config.kusto).toEqual(config.kusto);
        for (const key of ['account', 'tenant', 'subscription']) {
            expect(getNamespaceFieldSource(`kusto.azureCli.${key}`, config)).toBe('file');
        }
        expect(mergeConfig(DEFAULT_CONFIG, { kusto: { enabled: true } }).kusto.azureCli).toEqual({
            account: '', tenant: '', subscription: '',
        });
    });

    it.each([
        { ...azureCli, account: 'fixture; command' },
        { ...azureCli, account: 'fixture-account\n' },
        { ...azureCli, tenant: 'organizations' },
        { ...azureCli, subscription: 'subscription-name' },
        { ...azureCli, account: 1 },
    ])('rejects invalid file identity without echoing the supplied value', value => {
        const result = CLIConfigSchema.safeParse({ kusto: { azureCli: value } });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.message).not.toContain('fixture; command');
        }
    });

    it('accepts the SDK GUID syntax without imposing OAuth UUID-version rules', () => {
        const value = { ...azureCli, tenant: 'AAAAAAAA-AAAA-FAAA-FAAA-AAAAAAAAAAAA' };
        expect(CLIConfigSchema.parse({ kusto: { azureCli: value } })).toMatchObject({ kusto: { azureCli: value } });
    });
});
