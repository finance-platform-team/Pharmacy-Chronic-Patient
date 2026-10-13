import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ComboBoxProps {
  placeholder?: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

interface MenuRect {
  top: number;
  left: number;
  width: number;
}

/**
 * A text input that also opens a dropdown of known values on focus/click —
 * type to filter the list, or pick straight from it. Unlike LookupInput,
 * options are a plain local list (no async search, no minimum-chars gate),
 * so the full list shows immediately on focus.
 */
export function ComboBox({ placeholder, value, options, onChange }: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [menuRect, setMenuRect] = useState<MenuRect | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

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

  const filtered = value.trim()
    ? options.filter((opt) => opt.toLowerCase().includes(value.trim().toLowerCase()))
    : options;

  function handlePick(option: string) {
    onChange(option);
    setOpen(false);
  }

  return (
    <div className="lookup-wrap" ref={wrapRef}>
      <input
        type="text"
        className="lookup-input"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
      />
      {value && (
        <button type="button" className="lookup-clear show" onClick={() => { onChange(''); setOpen(false); }}>&times;</button>
      )}
      {open && menuRect && createPortal(
        <div
          ref={menuRef}
          className="lookup-results lookup-results-portal open"
          style={{ top: menuRect.top, left: menuRect.left, width: menuRect.width }}
        >
          {filtered.length === 0 && <div className="lookup-result-empty">No matches</div>}
          {filtered.map((opt) => (
            <div key={opt} className="lookup-result-item" onClick={() => handlePick(opt)}>
              {opt}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
