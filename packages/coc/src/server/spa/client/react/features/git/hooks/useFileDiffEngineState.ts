import { useCallback, useState } from 'react';
import { useDiffEngine } from './useDiffEngine';
import type { DiffEngineResolution } from '../diff/diffEngineResolution';

/** Classification follows the rendered engine, including automatic Classic fallback. */
export function useFileDiffEngineState(fileKey: string | null) {
    const [preference] = useDiffEngine();
    const key = `${fileKey}\u0000${preference}`;
    const [reported, setReported] = useState<{ key: string; engine: DiffEngineResolution['engine'] } | null>(null);
    const onDiffEngineChange = useCallback((engine: DiffEngineResolution['engine']) => {
        setReported(current => current?.key === key && current.engine === engine ? current : { key, engine });
    }, [key]);
    const classificationEnabled = fileKey === null || preference === 'legacy'
        || (reported?.key === key && reported.engine === 'legacy');
    return { classificationEnabled, onDiffEngineChange };
}
