import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LookupOption } from '../../api/businessUnitsApi';

interface LookupInputProps {
  placeholder: string;
  disabled?: boolean;
  initialValue?: LookupOption | null;
  onSelect: (option: LookupOption | null) => void;
  /** Async server search (e.g. searchUsers) — ignored when `options` is set. */
  searchFn?: (term: string) => Promise<LookupOption[]>;
  /**
   * Preloaded list to filter client-side instead of calling `searchFn` — for
   * small, already-fetched sets (e.g. Business Units) where a live server
   * search per keystroke isn't needed. Shows the full list on focus, narrows
   * as you type, no debounce/minimum-length gate.
   */
  options?: LookupOption[];
  /** Opt-in only — existing call sites (grid, bulk edit) render unchanged unless this is set. */
  showAvatar?: boolean;
}

interface MenuRect {
  top: number;
  left: number;
  width: number;
}

// Synapse-harmonised avatar hues (turquoise, clinical blue, amber, violet,
// red, deep teal, slate) — replaces the old gold-theme browns.
const AVATAR_PALETTE = ['#126E5C', '#2B6680', '#8F5C0D', '#6046AA', '#A23E3E', '#0B5A50', '#55706A'];

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function LookupInput({ placeholder, disabled, initialValue, onSelect, searchFn, options, showAvatar }: LookupInputProps) {
  const [text, setText] = useState(initialValue?.name ?? '');
  const [selectedId, setSelectedId] = useState(initialValue?.id ?? '');
  const [results, setResults] = useState<LookupOption[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [menuRect, setMenuRect] = useState<MenuRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setText(initialValue?.name ?? '');
    setSelectedId(initialValue?.id ?? '');
    // Depend on the primitive id/name, not the initialValue object itself: the
    // grid rebuilds `{ id, name }` inline on every render, so a reference-based
    // dependency re-syncs (and stomps whatever was just picked) on any unrelated
    // re-render — e.g. the `savingUserFor` update fired right after a pick.
  }, [initialValue?.id, initialValue?.name]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
      setFocused(false);
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // The results list is rendered in a portal (see below) so it can never be
  // clipped by a modal's `overflow: hidden`/`auto` — its position is instead
  // computed from the input's own on-screen coordinates and kept in sync
  // while open.
  useLayoutEffect(() => {
    if (!open) return;

    function updateMenuRect() {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMenuRect({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }

    updateMenuRect();
    window.addEventListener('scroll', updateMenuRect, true);
    window.addEventListener('resize', updateMenuRect);
    return () => {
      window.removeEventListener('scroll', updateMenuRect, true);
      window.removeEventListener('resize', updateMenuRect);
    };
  }, [open]);

  function filterOptions(value: string): LookupOption[] {
    const term = value.trim().toLowerCase();
    if (!options) return [];
    return term ? options.filter((o) => o.name.toLowerCase().includes(term)) : options;
  }

  function handleChange(value: string) {
    setText(value);
    setSelectedId('');

    if (options) {
      setResults(filterOptions(value));
      setOpen(true);
      return;
    }

    window.clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    setOpen(true);
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const found = await searchFn!(value);
        setResults(found);
      } catch (err) {
        console.error('Lookup search failed:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function handlePick(option: LookupOption) {
    setText(option.name);
    setSelectedId(option.id);
    setOpen(false);
    onSelect(option);
  }

  function handleClear() {
    setText('');
    setSelectedId('');
    setOpen(false);
    onSelect(null);
  }

  const withAvatar = !!showAvatar && !!selectedId;

  return (
    <div className={`lookup-wrap${withAvatar ? ' lookup-wrap-has-avatar' : ''}`} ref={wrapRef}>
      {withAvatar && (
        <span className="lookup-avatar" style={{ background: avatarColor(text) }}>{avatarInitials(text)}</span>
      )}
      <input
        type="text"
        className={`lookup-input${withAvatar ? ' lookup-input-has-avatar' : ''}`}
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          setFocused(true);
          if (options) {
            setResults(filterOptions(text));
            setOpen(true);
          }
        }}
      />
      {selectedId && focused && (
        <button type="button" className="lookup-clear show" onClick={handleClear}>&times;</button>
      )}
      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          className="lookup-results lookup-results-portal open"
          style={{ top: menuRect.top, left: menuRect.left, width: menuRect.width }}
        >
          {loading && <div className="lookup-result-loading">Searching…</div>}
          {!loading && results.length === 0 && <div className="lookup-result-empty">No matches</div>}
          {!loading && results.map((r) => (
            <div key={r.id} className="lookup-result-item" onClick={() => handlePick(r)}>
              {r.name}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
