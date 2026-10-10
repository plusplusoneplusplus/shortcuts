import type { RepoGroupMemberAccess, RepoGroupWriterConflict } from '@plusplusoneplusplus/coc-client';
import { buildRemoteCloneKey } from './cloneIdentity';

export function RepoGroupAccessStatus({ access, readOnly, conflicts = [], serverId }: {
    access?: RepoGroupMemberAccess;
    readOnly?: boolean;
    conflicts?: RepoGroupWriterConflict[];
    serverId?: string;
}) {
    const writers = conflicts.length ? conflicts : access?.writers ?? [];
    const conflicting = conflicts.length > 0 || new Set(writers.map(writer => writer.writerGroupId)).size > 1;
    return (
        <div className="text-[11px] flex flex-col gap-1 break-words min-w-0" role={conflicting ? 'alert' : undefined}>
            {access && (
                <span>
                    {readOnly !== undefined && <strong>{readOnly ? 'Read-only' : 'Writer'} · </strong>}
                    {access.shared ? 'Shared repository' : 'Not shared'}
                    {access.unresolved && ' · Membership identity unresolved; write grants require server confirmation.'}
                </span>
            )}
            {conflicting && <strong>Writer conflict. Revoke the other writer before granting access here.</strong>}
            {writers.map((writer, index) => {
                const selectionId = serverId && serverId !== 'local'
                    ? buildRemoteCloneKey(serverId, writer.writerGroupId) : writer.writerGroupId;
                return (
                    <span key={`${writer.writerGroupId}:${writer.writerWorkspaceId}:${index}`}>
                        {writer.reason === 'unresolved-membership' ? 'Possible writer (unresolved)' : 'Writer'}: {writer.writerGroupName}
                        {' · '}
                        <a className="underline text-[#0078d4]" href={`#repos/${encodeURIComponent(selectionId)}/settings`}>
                            Open writer group
                        </a>
                    </span>
                );
            })}
        </div>
    );
}
