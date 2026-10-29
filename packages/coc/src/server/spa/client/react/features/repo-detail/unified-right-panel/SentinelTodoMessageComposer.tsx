import { useEffect, useRef, useState, type RefObject } from 'react';
import type { SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { subscribeCloneBaseUrl } from '../../../repos/cloneRegistry';
import { subscribeDashboardTopology } from '../../../shared/dashboard-discovery/topology';
import { SentinelTodoMessageDialog } from './SentinelTodoMessageDialog';
import { createSentinelTodoMessageAdmission } from './sentinelTodoMessageAdmission';
import { resolveSentinelTodoMessageContext, type SentinelTodoMessageTarget } from './sentinelTodoMessageContext';

type Gates = Parameters<typeof resolveSentinelTodoMessageContext>[1];
export interface SentinelTodoMessageComposerProps {
    /** A fresh immutable capture for this dialog lifetime. Never retarget an existing draft. */
    target: SentinelTodoMessageTarget;
    item: Pick<SentinelTodoItem, 'id' | 'title'>;
    gates: Gates;
    onClose: () => void;
    /** Only confirmed admission reaches this callback; the host closes and announces success. */
    onAdmitted: (sentinelName: string) => void;
    returnFocusRef?: RefObject<HTMLElement | null>;
}

/** Headless-chat controller: all draft and attempt state belongs to this mounted dialog. */
export function SentinelTodoMessageComposer(props: SentinelTodoMessageComposerProps) {
    const [session] = useState(() => ({ target: props.target, item: props.item,
        admission: createSentinelTodoMessageAdmission(props.target) }));
    const { target, admission } = session;
    const [text, setText] = useState('');
    const [item, setItem] = useState(session.item);
    const [sentinelName, setSentinelName] = useState(target.owner.processId);
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmDuplicate, setConfirmDuplicate] = useState(false);
    const flight = useRef(false);
    const active = useRef(false);
    const read = useRef<AbortController | null>(null);
    const submission = useRef<AbortController | null>(null);
    const enabled = props.gates.sentinelTodos && props.gates.sessionContextAttachments && props.target === target;

    useEffect(() => {
        active.current = true;
        return () => {
            active.current = false;
            read.current?.abort();
            submission.current?.abort();
        };
    }, []);

    useEffect(() => {
        const invalidate = () => {
            read.current?.abort();
            submission.current?.abort();
            setLoading(false);
            setError('The owning server changed. Queue message will recheck the same destination.');
        };
        const topology = subscribeDashboardTopology(invalidate);
        const route = subscribeCloneBaseUrl(target.owner.ownerRoutingRef, invalidate);
        return () => { topology(); route(); };
    }, [target]);

    useEffect(() => {
        const controller = new AbortController();
        read.current = controller;
        if (!enabled) {
            submission.current?.abort();
            setLoading(false);
            setError('To-do context attachments must be enabled for the captured Sentinel.');
            return () => controller.abort();
        }
        setLoading(true);
        setError(null);
        void resolveSentinelTodoMessageContext(target, props.gates, controller.signal).then(prepared => {
            if (controller.signal.aborted) return;
            setItem(prepared.item);
            const name = prepared.process.metadata?.displayName;
            setSentinelName(typeof name === 'string' && name.trim() ? name : target.owner.processId);
        }, failure => {
            if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load the attached To-do. Queue message will retry.');
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [target, enabled, props.gates.sentinelTodos, props.gates.sessionContextAttachments]);

    const queue = async (duplicateConfirmed: boolean) => {
        // Also guard the UI synchronously, before any preflight or React state update.
        if (flight.current || loading || !enabled || !text.trim()) return;
        flight.current = true;
        const controller = new AbortController();
        submission.current = controller;
        read.current?.abort();
        setConfirmDuplicate(false);
        setPending(true);
        setError(null);
        try {
            const result = await (duplicateConfirmed ? admission.retryAfterDuplicateConfirmation : admission.submit)(text, props.gates, controller.signal);
            if (!active.current) return;
            if (result.kind === 'admitted') {
                props.onAdmitted(sentinelName);
            } else if (result.kind === 'failed') {
                setError(result.error);
            } else if (result.reason === 'duplicate-confirmation-required') {
                setError('Delivery is unconfirmed. Retrying may queue a duplicate.');
                setConfirmDuplicate(true);
            }
        } finally {
            flight.current = false;
            if (active.current) setPending(false);
        }
    };

    return <SentinelTodoMessageDialog owner={target.owner} item={item} sentinelName={sentinelName}
        workspaceLabel={target.workspaceLabel} serverLabel={target.serverLabel} text={text}
        onTextChange={value => {
            if (flight.current) return;
            // An opening read cannot publish context into a later draft. Send always reads again.
            read.current?.abort();
            setLoading(false);
            setConfirmDuplicate(false);
            setText(value);
        }} ready={enabled} loading={loading} pending={pending} error={error}
        onQueue={() => { void queue(false); }} onClose={() => { if (!flight.current) props.onClose(); }}
        returnFocusRef={props.returnFocusRef}
        duplicateConfirmation={confirmDuplicate ? {
            onCancel: () => setConfirmDuplicate(false),
            onConfirm: () => { if (confirmDuplicate) void queue(true); },
        } : undefined} />;
}
