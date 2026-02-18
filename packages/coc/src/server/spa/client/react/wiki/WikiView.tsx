/**
 * WikiView — top-level route component for #wiki and #wiki/:id.
 */

import { useApp } from '../context/AppContext';
import { WikiList } from './WikiList';
import { WikiDetail } from './WikiDetail';

export function WikiView() {
    const { state } = useApp();

    if (state.selectedWikiId) {
        return <WikiDetail wikiId={state.selectedWikiId} />;
    }

    return <WikiList />;
}
