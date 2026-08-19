/**
 * BitFlagDecoderCard — paste a C++ flag enum, then read a number as flag names
 * and tick flag names back into a number.
 *
 * Every bit of parsing, decoding and storage lives in `logic/bitFlags.ts` and
 * `logic/bitFlagStore.ts`; this file is wiring only. The two directions share
 * one piece of state — `value` — so there is no "apply" button: typing updates
 * the checkboxes and ticking updates the number.
 *
 * Ticks are applied as plain bit operations on `value` rather than by
 * re-encoding the whole selection. Re-encoding loses bits no flag names, and it
 * cannot express "untick A" when A is also covered by a matched alias, which
 * would silently re-set the bit.
 *
 * Saved sets are localStorage only, matching the panel's "no server
 * round-trips" rule. Nothing here fetches.
 */

import { useMemo, useState } from 'react';

import { CopyButton } from './CopyButton';
import {
    cardBodyClass,
    errorClass,
    inputClass,
    labelClass,
    mutedClass,
    readoutClass,
    textareaClass,
} from './styles';
import { CALC_WIDTHS, evaluate, toHexLiteral, truncate, type CalcWidth } from './logic/calculator';
import {
    decodeValue,
    parseFlagDefinitions,
    selectionFor,
    type FlagEntry,
} from './logic/bitFlags';
import {
    addSet,
    browserStorage,
    deleteSet,
    defaultSetName,
    loadStore,
    saveStore,
    selectSet,
    selectedSet,
    updateSet,
    type BitFlagStore,
} from './logic/bitFlagStore';

const INITIAL_WIDTH: CalcWidth = 32;

/** What each kind is called in the parsed-definitions table. */
const KIND_LABEL: Record<FlagEntry['kind'], string> = {
    flag: 'flag',
    alias: 'alias',
    mask: 'mask',
    shift: 'shift',
    zero: 'zero',
};

export function BitFlagDecoderCard() {
    const storage = useMemo(() => browserStorage(), []);
    // One read on mount; every later write goes through `commit`, which mirrors
    // the new store straight back to localStorage.
    const initial = useMemo(() => loadStore(storage), [storage]);
    const [store, setStore] = useState<BitFlagStore>(initial);
    // The textarea draft. Saved into the selected set only when Save is clicked.
    const [source, setSource] = useState(() => selectedSet(initial)?.source ?? '');
    const [name, setName] = useState(() => selectedSet(initial)?.name ?? '');

    const [width, setWidth] = useState<CalcWidth>(INITIAL_WIDTH);
    const [signed, setSigned] = useState(false);
    const [expression, setExpression] = useState('0');
    const [value, setValue] = useState(0n);
    const [error, setError] = useState('');

    const parsed = useMemo(() => parseFlagDefinitions(source), [source]);
    const decoded = useMemo(
        () => decodeValue(parsed.entries, value, width),
        [parsed.entries, value, width],
    );
    const selection = useMemo(
        () => selectionFor(parsed.entries, value, width),
        [parsed.entries, value, width],
    );

    const current = selectedSet(store);
    const dirty = current ? current.source !== source || current.name !== name : source !== '';

    const commit = (next: BitFlagStore) => {
        setStore(next);
        saveStore(storage, next);
        return next;
    };

    const loadSet = (next: BitFlagStore) => {
        const set = selectedSet(next);
        setSource(set?.source ?? '');
        setName(set?.name ?? '');
    };

    const onSelect = (id: string) => {
        const next = commit(selectSet(store, id));
        loadSet(next);
    };

    const onNew = () => {
        const next = commit(addSet(store, defaultSetName(store, null), ''));
        loadSet(next);
    };

    const onSave = () => {
        if (current) {
            commit(updateSet(store, current.id, { name: name.trim() || current.name, source }));
            return;
        }
        const next = commit(addSet(store, name.trim() || defaultSetName(store, parsed.name), source));
        setName(selectedSet(next)?.name ?? '');
    };

    const onRename = () => {
        if (!current) return;
        const next = commit(updateSet(store, current.id, { name: name.trim() || current.name }));
        setName(selectedSet(next)?.name ?? '');
    };

    const onDelete = () => {
        if (!current) return;
        // eslint-disable-next-line no-alert
        if (typeof confirm === 'function' && !confirm(`Delete the flag set "${current.name}"?`)) return;
        const next = commit(deleteSet(store, current.id));
        loadSet(next);
    };

    /** The single write path for the value — keeps the number box in sync. */
    const setBits = (next: bigint) => {
        const wrapped = truncate(next, width);
        setValue(wrapped);
        setExpression(toHexLiteral(wrapped, width));
        setError('');
    };

    const onExpression = (text: string, nextWidth: CalcWidth, nextSigned: boolean) => {
        setExpression(text);
        setWidth(nextWidth);
        setSigned(nextSigned);
        if (!text.trim()) {
            setValue(prev => truncate(prev, nextWidth));
            setError('');
            return;
        }
        const result = evaluate(text, { width: nextWidth, signed: nextSigned });
        if (result.ok && result.kind === 'int') {
            setValue(truncate(result.value, nextWidth));
            setError('');
        } else {
            // Keep the last good value on screen, wrapped to the current width.
            setValue(prev => truncate(prev, nextWidth));
            setError(result.ok ? 'expected an integer value' : result.error);
        }
    };

    const onToggle = (entry: FlagEntry, on: boolean) => {
        setBits(on ? value | entry.value : value & ~entry.value);
    };

    const onField = (entry: FlagEntry, text: string) => {
        const shift = BigInt(entry.shift ?? 0);
        const raw = BigInt(Number.isFinite(Number(text)) && text.trim() ? Math.trunc(Number(text)) : 0);
        const clamped = raw < 0n ? 0n : raw;
        setBits((value & ~entry.value) | ((clamped << shift) & entry.value));
    };

    return (
        <div className={cardBodyClass}>
            <div className="flex flex-wrap items-center gap-2">
                <select
                    value={current?.id ?? ''}
                    onChange={e => onSelect(e.target.value)}
                    aria-label="Saved flag set"
                    data-testid="bitflags-set-select"
                    className={`${inputClass} min-w-[120px]`}
                >
                    {!current && <option value="">(unsaved)</option>}
                    {store.sets.map(set => (
                        <option key={set.id} value={set.id}>
                            {set.name}
                        </option>
                    ))}
                </select>
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Set name"
                    aria-label="Set name"
                    data-testid="bitflags-set-name"
                    className={`${inputClass} flex-1 min-w-[120px]`}
                />
                <ToolbarButton testId="bitflags-new" onClick={onNew} label="New" />
                <ToolbarButton testId="bitflags-save" onClick={onSave} label={dirty ? 'Save *' : 'Save'} />
                <ToolbarButton testId="bitflags-rename" onClick={onRename} label="Rename" disabled={!current} />
                <ToolbarButton testId="bitflags-delete" onClick={onDelete} label="Delete" disabled={!current} />
            </div>

            <textarea
                value={source}
                onChange={e => setSource(e.target.value)}
                spellCheck={false}
                placeholder={'enum Perm : uint32_t {\n  READ = 1 << 0,\n  WRITE = 1 << 1,\n  ALL = READ | WRITE,\n};'}
                aria-label="C++ flag definitions"
                data-testid="bitflags-source"
                className={`${textareaClass} min-h-[110px]`}
            />

            {source.trim() !== '' && (
                <p className={mutedClass} data-testid="bitflags-parse-status">
                    {parsed.parsedLines} of {parsed.totalLines} lines parsed
                    {parsed.skipped.length > 0 ? `, ${parsed.skipped.length} skipped` : ''}
                </p>
            )}

            {parsed.warnings.map(warning => (
                <p key={warning} className={mutedClass} data-testid="bitflags-warning">
                    ⚠ {warning}
                </p>
            ))}

            {parsed.skipped.length > 0 && (
                <ul className={errorClass} data-testid="bitflags-skipped">
                    {parsed.skipped.map(skip => (
                        <li key={`${skip.line}:${skip.text}`} className="font-mono break-all">
                            line {skip.line}: {skip.text} — {skip.reason}
                        </li>
                    ))}
                </ul>
            )}

            {parsed.entries.length > 0 && (
                <div className="flex flex-col gap-1" data-testid="bitflags-table">
                    {parsed.entries.map(entry => {
                        const checkable = entry.kind === 'flag' || entry.kind === 'alias';
                        const on = selection.selected.includes(entry.name);
                        return (
                            <div key={entry.name} className="flex items-center gap-2 text-xs">
                                <span className="w-6 flex-shrink-0">
                                    {checkable && (
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            onChange={e => onToggle(entry, e.target.checked)}
                                            aria-label={entry.name}
                                            data-testid={`bitflags-check-${entry.name}`}
                                        />
                                    )}
                                    {entry.kind === 'mask' && (
                                        <input
                                            type="number"
                                            min={0}
                                            value={String(selection.fields?.[entry.name] ?? 0n)}
                                            onChange={e => onField(entry, e.target.value)}
                                            aria-label={`${entry.name} value`}
                                            data-testid={`bitflags-field-${entry.name}`}
                                            className={`${inputClass} w-14 h-6 px-1`}
                                        />
                                    )}
                                </span>
                                <span
                                    className="flex-1 min-w-0 font-mono text-[#1e1e1e] dark:text-[#cccccc] break-all"
                                    data-testid={`bitflags-row-${entry.name}`}
                                >
                                    {entry.name}
                                </span>
                                <code className="font-mono text-[#656d76] dark:text-[#999]">
                                    {toHexLiteral(truncate(entry.value, width), width)}
                                </code>
                                <span className={`${mutedClass} w-10 text-right flex-shrink-0`}>
                                    {KIND_LABEL[entry.kind]}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <input
                    type="text"
                    value={expression}
                    onChange={e => onExpression(e.target.value, width, signed)}
                    spellCheck={false}
                    placeholder="e.g. 0x85 or 0x30 | 4"
                    aria-label="Value"
                    data-testid="bitflags-value"
                    className={`${inputClass} flex-1 min-w-[160px] font-mono`}
                />
                <label className={labelClass}>
                    Width
                    <select
                        value={width}
                        onChange={e => onExpression(expression, Number(e.target.value) as CalcWidth, signed)}
                        aria-label="Width"
                        data-testid="bitflags-width"
                        className={inputClass}
                    >
                        {CALC_WIDTHS.map(w => (
                            <option key={w} value={w}>
                                {w}-bit
                            </option>
                        ))}
                    </select>
                </label>
                <label className={labelClass}>
                    <input
                        type="checkbox"
                        checked={signed}
                        onChange={e => onExpression(expression, width, e.target.checked)}
                        aria-label="Signed"
                        data-testid="bitflags-signed"
                    />
                    Signed
                </label>
            </div>

            {error && (
                <p className={errorClass} data-testid="bitflags-error">
                    {error}
                </p>
            )}

            <div className="flex items-center gap-2">
                <code className={readoutClass} data-testid="bitflags-summary">
                    {decoded.summary}
                </code>
                <CopyButton
                    text={decoded.summary}
                    label="Copy decoded flags"
                    testId="bitflags-copy"
                />
            </div>

            {decoded.empty ? (
                <p className={mutedClass} data-testid="bitflags-empty">
                    no flags set
                </p>
            ) : (
                <div className="flex flex-col gap-0.5 text-xs font-mono" data-testid="bitflags-decoded">
                    {decoded.flags.map(flag => (
                        <span key={flag.name} data-testid={`bitflags-decoded-flag-${flag.name}`}>
                            {flag.name} — {toHexLiteral(flag.value, width)} (bit {flag.bit})
                        </span>
                    ))}
                    {decoded.aliases.map(alias => (
                        <span key={alias.name} data-testid={`bitflags-decoded-alias-${alias.name}`}>
                            {alias.name} — {toHexLiteral(alias.value, width)} (alias)
                        </span>
                    ))}
                    {decoded.fields.map(field => (
                        <span key={field.name} data-testid={`bitflags-decoded-field-${field.name}`}>
                            {field.name} → {field.value.toString()} ({toHexLiteral(field.value, width)})
                        </span>
                    ))}
                    {decoded.unknown !== 0n && (
                        <span data-testid="bitflags-decoded-unknown">
                            unknown: {toHexLiteral(decoded.unknown, width)} (bit
                            {decoded.unknownBits.length > 1 ? 's' : ''} {decoded.unknownBits.join(', ')})
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}

function ToolbarButton({
    label,
    testId,
    onClick,
    disabled,
}: {
    label: string;
    testId: string;
    onClick: () => void;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            data-testid={testId}
            className="h-8 px-2 rounded text-xs border border-[#d0d7de] dark:border-[#3c3c3c] text-[#656d76] dark:text-[#999] hover:text-[#0078d4] hover:border-[#0078d4] disabled:opacity-40 disabled:hover:text-[#656d76] disabled:hover:border-[#d0d7de]"
        >
            {label}
        </button>
    );
}
