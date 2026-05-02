/**
 * useWiki — fetches wikis from API and reads from AppContext.
 */

import { useEffect, useCallback } from 'react';
import { useApp } from '../../contexts/AppContext';
import { getSpaCocClient } from '../../api/cocClient';

export function useWiki() {
    const { state, dispatch } = useApp();

    const reload = useCallback(async () => {
        try {
            dispatch({ type: 'SET_WIKIS', wikis: await getSpaCocClient().wiki.list() });
        } catch {
            dispatch({ type: 'SET_WIKIS', wikis: [] });
        }
    }, [dispatch]);

    useEffect(() => { reload(); }, [reload]);

    return {
        wikis: state.wikis,
        loading: false,
        error: null as string | null,
        reload,
    };
}
