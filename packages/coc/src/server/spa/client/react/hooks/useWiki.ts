/**
 * useWiki — fetches wikis from API and reads from AppContext.
 */

import { useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { fetchApi } from './useApi';

export function useWiki() {
    const { state, dispatch } = useApp();

    const reload = useCallback(async () => {
        try {
            const data = await fetchApi('/wikis');
            const wikis = Array.isArray(data) ? data : data?.wikis ?? [];
            dispatch({ type: 'SET_WIKIS', wikis });
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
