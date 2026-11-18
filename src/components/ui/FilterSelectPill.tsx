import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faChevronDown, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { LookupOption } from '../../api/businessUnitsApi';
import { usePopover } from './usePopover';
import { avatarColor, avatarInitials } from './avatar';
import './FilterControls.css';

export interface FilterSelectOption extends LookupOption {
  /** Small trailing text on the option row, e.g. "12 patients". */
  hint?: string;
}

interface FilterSelectPillProps {
  label: string;
  icon: IconDefinition;
  /** Currently selected option, or null when the filter is off. */
  value: LookupOption | null;
  onChange: (option: LookupOption | null) => void;
  /** Preloaded list, filtered client-side as you type (e.g. Business Units). */
  options?: FilterSelectOption[];
  /** Shows the list is still being fetched instead of "No matches". */
  optionsLoading?: boolean;
  /** Initials avatar in front of each option and the picked value — for people. */
  showAvatar?: boolean;
  /**
   * Fixed choices pinned above the list (e.g. "Unassigned"), shown while the
   * search box is empty and never avatar-decorated.
   */
  quickOptions?: FilterSelectOption[];
  /** Async server search (e.g. searchUsers) — used when `options` isn't set. */
  searchFn?: (term: string) => Promise<LookupOption[]>;
  searchPlaceholder?: string;
}

const MIN_SEARCH_CHARS = 2;

/**
 * Pill button (same look as DateRangePicker's) that opens a popover with a
 * search box and a pick list — keeps the filter row compact instead of a row
 * of always-visible text inputs. Shows "Label: Value" once something is picked.
 */
export function FilterSelectPill({
  label, icon, value, onChange, options, optionsLoading, showAvatar, quickOptions, searchFn, searchPlaceholder
}: FilterSelectPillProps) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(280);
  const [term, setTerm] = useState('');
  const [remoteResults, setRemoteResults] = useState<FilterSelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<number | undefined>(undefined);

  const isRemote = !options && !!searchFn;
  const trimmed = term.trim().toLowerCase();
  const results = isRemote
    ? remoteResults
    : (options ?? []).filter((o) => !trimmed || o.name.toLowerCase().includes(trimmed));

  function toggleOpen() {
    if (!open) {
      setTerm('');
      setRemoteResults([]);
    }
    setOpen(!open);
  }

  function handleTerm(next: string) {
    setTerm(next);
    if (!isRemote) return;

    window.clearTimeout(debounceRef.current);
    if (next.trim().length < MIN_SEARCH_CHARS) {
      setRemoteResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        setRemoteResults(await searchFn!(next));
      } catch (err) {
        console.error('Filter search failed:', err);
        setRemoteResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function pick(option: LookupOption | null) {
    onChange(option);
    setOpen(false);
  }

  const valueIsQuick = !!value && !!quickOptions?.some((q) => q.id === value.id);
  const visibleQuick = trimmed ? [] : (quickOptions ?? []);

  let emptyText: string | null = null;
  if (isRemote && trimmed.length < MIN_SEARCH_CHARS) emptyText = `Type at least ${MIN_SEARCH_CHARS} letters to search`;
  else if (loading) emptyText = 'Searching…';
  else if (optionsLoading && results.length === 0) emptyText = 'Loading…';
  else if (results.length === 0) emptyText = 'No matches';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`filter-pill${value ? ' is-active' : ''}${open ? ' is-open' : ''}`}
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {showAvatar && value && !valueIsQuick
          ? <span className="filter-pill-avatar" style={{ background: avatarColor(value.name) }}>{avatarInitials(value.name)}</span>
          : <FontAwesomeIcon icon={icon} className="filter-pill-icon" aria-hidden="true" />}
        <span className="filter-pill-label">{label}{value ? ':' : ''}</span>
        {value && <span className="filter-pill-value">{value.name}</span>}
        <FontAwesomeIcon icon={faChevronDown} className="filter-pill-caret" aria-hidden="true" />
      </button>

      {open && position && createPortal(
        <div ref={popoverRef} className={`filter-popover select-popover${showAvatar ? ' has-avatars' : ''}`} style={{ top: position.top, left: position.left }} role="dialog" aria-label={label}>
          <div className="select-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
            <input
              type="text"
              autoFocus
              autoComplete="off"
              placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`}
              value={term}
              onChange={(e) => handleTerm(e.target.value)}
            />
          </div>

          <div className="select-list" role="listbox">
            {visibleQuick.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value?.id}
                className={`select-option select-option-quick${o.id === value?.id ? ' is-selected' : ''}`}
                onClick={() => pick(o)}
              >
                <span className="select-option-name">{o.name}</span>
                {o.hint && <span className="select-option-hint">{o.hint}</span>}
                {o.id === value?.id && <FontAwesomeIcon icon={faCheck} className="select-option-check" aria-hidden="true" />}
              </button>
            ))}
            {visibleQuick.length > 0 && <div className="select-divider" role="separator" />}
            {emptyText
              ? <div className="select-empty">{emptyText}</div>
              : results.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={o.id === value?.id}
                  className={`select-option${o.id === value?.id ? ' is-selected' : ''}`}
                  onClick={() => pick(o)}
                >
                  {showAvatar && (
                    <span className="select-avatar" style={{ background: avatarColor(o.name) }}>{avatarInitials(o.name)}</span>
                  )}
                  <span className="select-option-name">{o.name}</span>
                  {o.hint && <span className="select-option-hint">{o.hint}</span>}
                  {o.id === value?.id && <FontAwesomeIcon icon={faCheck} className="select-option-check" aria-hidden="true" />}
                </button>
              ))}
          </div>

          {value && (
            <button type="button" className="select-clear" onClick={() => pick(null)}>
              Clear
            </button>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
