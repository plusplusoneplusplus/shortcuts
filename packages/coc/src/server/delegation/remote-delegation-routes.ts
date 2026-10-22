import type * as http from 'http';
import type { Route } from '../types';
import { z } from 'zod';
import { readJsonBody, send400, sendError, sendJson } from '../shared/router';
import { RemoteDelegationRefusedError, remoteDelegationClaimSchema } from './remote-delegation-auth';
import { captureRemoteDelegationIntent, RemoteDelegationAdmissionService } from './remote-delegation-admission';
import {
    RemoteDelegationReceiptOwnerError, type RemoteDelegationAdmissionStore, type RemoteDelegationAdmission,
} from './remote-delegation-admission-store';
import { emitDeliveryEvents, RemoteFollowUpRejectedError, type ProcessMessageDeliveryService } from '../processes/process-message-delivery-service';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
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

/** Pre-claim refusal (400) proves this request admitted nothing; a foreign owner (403) admitted nothing for this caller. */
function sendAdmissionFailure(res: http.ServerResponse, error: unknown, unavailable: string): void {
    if (error instanceof RemoteDelegationRefusedError) send400(res, 'Remote admission was refused before execution; no work was started.');
    else if (error instanceof RemoteDelegationReceiptOwnerError) sendError(res, 403, 'Remote admission is unavailable for this request.');
    else sendError(res, 503, unavailable);
}

/**
 * Sender-polling admission: the destination never registers, connects to or calls the
 * origin. No capability is advertised until the complete result lifecycle is composed.
 */
export function registerRemoteDelegationRoutes(routes: Route[], options: {
    admissions: RemoteDelegationAdmissionStore;
    delivery: ProcessMessageDeliveryService; store: ProcessStore;
    launch?: { dispatch: RemoteDelegationDispatch; findChild: RemoteDelegationFindChild };
    results?: { ready: Promise<void>; capture: () => Promise<void> };
}): void {
    const gateway = new RemoteDelegationAdmissionService(options.admissions);
    if (options.results && options.launch) routes.push({
        method: 'GET', pattern: '/api/remote-delegations/capabilities',
        handler: (_req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            sendJson(res, { version: 1, results: true, senderPolling: true, serverIdentity: options.admissions.serverIdentity });
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
            } catch (error) { sendAdmissionFailure(res, error, 'Remote launch admission is unavailable; reconcile before any further action.'); }
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
            } catch (error) { sendAdmissionFailure(res, error, 'Remote follow-up admission is unavailable; reconcile before any further action.'); }
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
            } catch (error) {
                if (error instanceof RemoteDelegationRefusedError) send400(res, 'Invalid remote admission receipt request.');
                else sendError(res, 503, 'Remote admission receipt is unavailable.');
            }
        },
    });
}
