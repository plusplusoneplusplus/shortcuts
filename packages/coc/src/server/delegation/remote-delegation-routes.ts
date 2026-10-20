import type { Route } from '../types';
import { readJsonBody, send400, sendError, sendJson } from '../shared/router';
import { REMOTE_DELEGATION_PROOF_PATH, remoteDelegationClaimSchema } from './remote-delegation-auth';
import type { RemoteDelegationRequestStore } from './remote-delegation-request-store';

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
