import { isTerminalEnabled } from '../utils/config';

export function useTerminalEnabled(): boolean {
    return isTerminalEnabled();
}
