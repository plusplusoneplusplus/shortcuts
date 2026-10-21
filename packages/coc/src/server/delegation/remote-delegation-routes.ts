import type { Route } from '../types';
import { z } from 'zod';
import { readJsonBody, send400, sendError, sendJson } from '../shared/router';
import { REMOTE_DELEGATION_PROOF_PATH, remoteDelegationClaimSchema } from './remote-delegation-auth';
import type { RemoteDelegationRequestStore } from './remote-delegation-request-store';
import { captureRemoteDelegationIntent, RemoteDelegationAdmissionService } from './remote-delegation-admission';
import type { RemoteDelegationAdmissionStore, RemoteDelegationAdmission } from './remote-delegation-admission-store';
import { emitDeliveryEvents, RemoteFollowUpRejectedError, type ProcessMessageDeliveryService } from '../processes/process-message-delivery-service';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { RemoteServerSource } from '../servers/workspace-directory';
import { remoteChatLaunchBody, remoteRalphLaunchBody } from './remote-delegation-launch';
import type { RemoteDelegationDispatch, RemoteDelegationFindChild } from './remote-delegation-admission';

export const REMOTE_DELEGATION_LAUNCH_PATH = '/api/remote-delegations/launch';
export const REMOTE_DELEGATION_FOLLOW_UP_PATH = '/api/remote-delegations/follow-up';
export const REMOTE_DELEGATION_RECEIPT_PATH = '/api/remote-delegations/receipt';
const followUpBody = z.object({
    content: z.string().min(1).refine(value => !!value.trim()),
    mode: z.enum(['ask', 'autopilot', 'plan']).optional(),
    model: z.string().min(1).max(512).optional(),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional(),
}).strict();

/** Wire receipt omits the destination's private execution ID and storage metadata. */
function publicReceipt(row: RemoteDelegationAdmission) {
    return { version: row.version, requestId: row.requestId, originServerIdentity: row.originServerIdentity,
        parent: row.parent, destination: row.destination, kind: row.kind, targetProcessId: row.targetProcessId,
        intentDigest: row.intentDigest, admission: row.admission, ...(row.terminal ? { terminal: row.terminal } : {}) };
}

/** No capability is advertised until the complete result lifecycle is composed. */
export function registerRemoteDelegationRoutes(routes: Route[], options: {
    admissions: RemoteDelegationAdmissionStore; remotes: RemoteServerSource;
    delivery: ProcessMessageDeliveryService; store: ProcessStore;
    launch?: { dispatch: RemoteDelegationDispatch; findChild: RemoteDelegationFindChild };
    results?: { ready: Promise<void>; capture: () => Promise<void> };
    fetchImpl?: typeof fetch;
}): void {
    const gateway = new RemoteDelegationAdmissionService(options.admissions, { remotes: options.remotes, fetchImpl: options.fetchImpl });
    if (options.results && options.launch) routes.push({
        method: 'GET', pattern: '/api/remote-delegations/capabilities',
        handler: (_req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            sendJson(res, { version: 1, results: true, serverIdentity: options.admissions.serverIdentity });
        },
    });
    const capture = async () => {
        try { await options.results?.capture(); }
        catch { console.error('[remote-delegation-results] Could not capture admitted result.'); }
    };
    if (options.launch) routes.push({
        method: 'POST', pattern: REMOTE_DELEGATION_LAUNCH_PATH,
        handler: async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            let body: { claim: z.infer<typeof remoteDelegationClaimSchema>; intent: unknown };
            try {
                body = z.object({ claim: remoteDelegationClaimSchema, intent: z.unknown() }).strict()
                    .parse(await readJsonBody(req, 1_065_000));
                const { intent } = captureRemoteDelegationIntent(body.intent);
                if (body.claim.kind !== intent.kind || !['launch', 'ralph'].includes(intent.kind)) throw new Error();
                (intent.kind === 'launch' ? remoteChatLaunchBody : remoteRalphLaunchBody).parse(intent.body);
            } catch { send400(res, 'Invalid remote launch admission.'); return; }
            try {
                await options.results?.ready;
                const receipt = await gateway.admit(body.claim, body.intent, options.launch!.dispatch);
                await capture();
                sendJson(res, publicReceipt(options.admissions.get(receipt) ?? receipt), 202);
            } catch { sendError(res, 503, 'Remote launch admission is unavailable; reconcile before any further action.'); }
        },
    });
    routes.push({
        method: 'POST', pattern: REMOTE_DELEGATION_FOLLOW_UP_PATH,
        handler: async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            let body: { claim: z.infer<typeof remoteDelegationClaimSchema>; intent: unknown };
            try {
                body = z.object({ claim: remoteDelegationClaimSchema, intent: z.unknown() }).strict()
                    .parse(await readJsonBody(req, 1_065_000));
                const { intent } = captureRemoteDelegationIntent(body.intent);
                if (body.claim.kind !== 'follow-up' || intent.kind !== 'follow-up') throw new Error();
                followUpBody.parse(intent.body);
            } catch { send400(res, 'Invalid remote follow-up admission.'); return; }
            try {
                await options.results?.ready;
                const receipt = await gateway.admit(body.claim, body.intent, async ({ binding, intent, executionId }) => {
                    try {
                        const result = await options.delivery.deliverRemoteFollowUpOnce(
                            binding.destination.workspaceId, binding.targetProcessId!, executionId, followUpBody.parse(intent.body));
                        // Events cannot roll back durable admission or cause another send.
                        try { emitDeliveryEvents(options.store, binding.targetProcessId!, result.events); } catch { /* persisted receipt wins */ }
                        return { state: 'accepted', child: { processId: binding.targetProcessId! } };
                    } catch (error) {
                        if (error instanceof RemoteFollowUpRejectedError) return { state: 'rejected' };
                        throw error;
                    }
                });
                await capture();
                sendJson(res, publicReceipt(options.admissions.get(receipt) ?? receipt), 202);
            } catch { sendError(res, 503, 'Remote follow-up admission is unavailable; reconcile before any further action.'); }
        },
    });
    routes.push({
        method: 'POST', pattern: REMOTE_DELEGATION_RECEIPT_PATH,
        handler: async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            let claim: z.infer<typeof remoteDelegationClaimSchema>;
            try {
                claim = remoteDelegationClaimSchema.parse(await readJsonBody(req, 16_384));
                if (claim.kind !== 'follow-up' && !options.launch) throw new Error();
            } catch { send400(res, 'Invalid remote admission receipt request.'); return; }
            try {
                await options.results?.ready;
                const receipt = await gateway.reconcile(claim, async row => {
                    if (row.kind !== 'follow-up') return options.launch!.findChild(row);
                    const found = await options.delivery.findRemoteFollowUpReceipt(
                        row.destination.workspaceId, row.targetProcessId!, row.executionId);
                    return found ? { processId: row.targetProcessId! } : undefined;
                });
                if (!receipt) { sendError(res, 404, 'Remote admission receipt is unavailable.'); return; }
                await capture();
                sendJson(res, publicReceipt(options.admissions.get(receipt) ?? receipt));
            } catch { sendError(res, 503, 'Remote admission receipt is unavailable.'); }
        },
    });
}

/** Recovery proof stays available independently of the originating admission flag. */
export function registerRemoteDelegationProofRoutes(routes: Route[], requests: RemoteDelegationRequestStore): void {
    routes.push({
        method: 'POST', pattern: REMOTE_DELEGATION_PROOF_PATH,
        handler: async (req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            let input: unknown;
            try { input = await readJsonBody(req, 16_384); }
            catch { send400(res, 'Invalid remote origin proof request.'); return; }
            const parsed = remoteDelegationClaimSchema.safeParse(input);
            if (!parsed.success) { send400(res, 'Invalid remote origin proof request.'); return; }
            try {
                const proof = requests.proveOrigin(parsed.data);
                if (!proof) { sendError(res, 403, 'Remote origin proof is unavailable.'); return; }
                sendJson(res, proof);
            } catch {
                // Storage paths, raw ledger contents and private tokens stay server-side.
                sendError(res, 503, 'Remote origin proof is unavailable.');
            }
        },
    });
}
