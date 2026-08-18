/**
 * Contract guard for the Docker/Kubernetes recipes that ship with the server
 * image. They all pin the loopback-only policy: the CoC process is reachable
 * only via host networking (single box) or a sidecar sharing its network
 * namespace (managed tenant) — never via a published port.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const repoRoot = path.resolve(__dirname, '../../../..');

/** Read a repo file as LF text (Windows checkouts may be CRLF). */
function readRepoFile(rel: string): string {
    return fs.readFileSync(path.join(repoRoot, rel), 'utf-8').replace(/\r\n/g, '\n');
}

function loadYaml(rel: string): any {
    return yaml.load(readRepoFile(rel));
}

function loadYamlDocs(rel: string): any[] {
    return yaml.loadAll(readRepoFile(rel)).filter(Boolean);
}

describe('docker-compose.example.yml (single box)', () => {
    const compose = loadYaml('docker-compose.example.yml');
    const coc = compose.services.coc;

    it('uses host networking and publishes no ports', () => {
        expect(coc.network_mode).toBe('host');
        expect(coc.ports).toBeUndefined();
        for (const svc of Object.values<any>(compose.services)) {
            expect(svc.ports).toBeUndefined();
        }
    });

    it('runs the ghcr image with /data on a named volume', () => {
        expect(coc.image).toMatch(/^ghcr\.io\/plusplusoneplusplus\/coc:/);
        expect(coc.volumes.some((v: string) => v.endsWith(':/data'))).toBe(true);
        expect(compose.volumes).toHaveProperty('coc-data');
    });

    it('never overrides the bind address away from loopback', () => {
        const text = readRepoFile('docker-compose.example.yml');
        expect(text).not.toContain('0.0.0.0');
        if (coc.command) {
            expect(coc.command).toContain('127.0.0.1');
        }
    });
});

describe('deploy/tenant/docker-compose.tenant.yml (one CoC per tenant)', () => {
    const rel = 'deploy/tenant/docker-compose.tenant.yml';
    const compose = loadYaml(rel);
    const text = readRepoFile(rel);
    const { coc, 'auth-proxy': proxy } = compose.services;

    it('coc publishes no ports and is not on the host network', () => {
        expect(coc).toBeDefined();
        expect(coc.ports).toBeUndefined();
        expect(coc.network_mode).not.toBe('host');
    });

    it('coc and auth-proxy share one network namespace (sidecar reaches 127.0.0.1:4000)', () => {
        // Compose only lets the namespace owner publish ports, so the proxy owns
        // it and coc joins; the k8s pod has both as peers.
        expect(coc.network_mode).toBe('service:auth-proxy');
        expect(proxy.network_mode).toBeUndefined();
        expect(proxy.command).toContain('--upstream=http://127.0.0.1:4000');
    });

    it('only the auth-proxy publishes, only 8080, and only on the host loopback', () => {
        expect(proxy.ports).toHaveLength(1);
        expect(String(proxy.ports[0])).toMatch(/^\$\{PROXY_BIND:-127\.0\.0\.1:\d+\}:8080$/);
        for (const svc of Object.values<any>(compose.services)) {
            for (const mapping of svc.ports ?? []) {
                expect(String(mapping)).not.toMatch(/4000/);
            }
        }
    });

    it('coc keeps the loopback bind and a drain-sized stop grace period', () => {
        expect(coc.command).toEqual(['--host', '127.0.0.1', '--port', '4000', '--data-dir', '/data/.coc']);
        expect(coc.stop_grace_period).toBeDefined();
        expect(text).not.toContain('0.0.0.0:4000');
    });
});

describe('deploy/tenant/tenant.yaml (Kubernetes)', () => {
    const docs = loadYamlDocs('deploy/tenant/tenant.yaml');
    const byKind = (kind: string) => docs.filter((d) => d.kind === kind);
    const deployment = byKind('Deployment')[0];
    const podSpec = deployment.spec.template.spec;
    const cocContainer = podSpec.containers.find((c: any) => c.name === 'coc');
    const proxyContainer = podSpec.containers.find((c: any) => c.name === 'auth-proxy');

    it('is a single-replica Recreate deployment (SQLite on RWO storage)', () => {
        expect(deployment.spec.replicas).toBe(1);
        expect(deployment.spec.strategy.type).toBe('Recreate');
        for (const pvc of byKind('PersistentVolumeClaim')) {
            expect(pvc.spec.accessModes).toEqual(['ReadWriteOnce']);
        }
    });

    it('runs non-root as uid 1000 with hardened container security', () => {
        expect(podSpec.securityContext.runAsNonRoot).toBe(true);
        expect(podSpec.securityContext.runAsUser).toBe(1000);
        expect(podSpec.securityContext.fsGroup).toBe(1000);
        expect(podSpec.securityContext.seccompProfile.type).toBe('RuntimeDefault');
        for (const c of podSpec.containers) {
            expect(c.securityContext.allowPrivilegeEscalation).toBe(false);
            expect(c.securityContext.capabilities.drop).toEqual(['ALL']);
        }
    });

    it('coc container binds loopback, publishes no ports, mounts /data and /work', () => {
        expect(cocContainer.image).toMatch(/^ghcr\.io\/plusplusoneplusplus\/coc:/);
        expect(cocContainer.args).toEqual(['--host', '127.0.0.1', '--port', '4000', '--data-dir', '/data/.coc']);
        expect(cocContainer.ports).toBeUndefined();
        const mounts = cocContainer.volumeMounts.map((m: any) => m.mountPath);
        expect(mounts).toEqual(expect.arrayContaining(['/data', '/work']));
    });

    it('probes coc via exec on 127.0.0.1 (httpGet would hit the pod IP)', () => {
        for (const probe of ['startupProbe', 'readinessProbe', 'livenessProbe']) {
            expect(cocContainer[probe].httpGet).toBeUndefined();
            expect(cocContainer[probe].exec.command.join(' ')).toContain('http://127.0.0.1:4000/api/health');
        }
    });

    it('auth-proxy is the only ingress: upstream loopback, Service targets it, not 4000', () => {
        expect(proxyContainer.args).toContain('--upstream=http://127.0.0.1:4000');
        expect(proxyContainer.ports.map((p: any) => p.containerPort)).toEqual([8080]);
        const service = byKind('Service')[0];
        expect(service.spec.ports).toHaveLength(1);
        expect(service.spec.ports[0].targetPort).toBe('http');
        expect(service.spec.ports.some((p: any) => p.port === 4000 || p.targetPort === 4000)).toBe(false);
    });

    it('has a NetworkPolicy restricting ingress to the sidecar port and limiting egress', () => {
        const [policy] = byKind('NetworkPolicy');
        expect(policy).toBeDefined();
        expect(policy.spec.policyTypes).toEqual(expect.arrayContaining(['Ingress', 'Egress']));
        const ingressPorts = policy.spec.ingress.flatMap((r: any) => r.ports.map((p: any) => p.port));
        expect(ingressPorts).toEqual([8080]);
        expect(policy.spec.egress.length).toBeGreaterThan(0);
    });

    it('waits at least as long as a queue drain before killing the pod', () => {
        expect(podSpec.terminationGracePeriodSeconds).toBeGreaterThanOrEqual(60);
    });
});
