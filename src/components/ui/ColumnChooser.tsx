import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTableColumns } from '@fortawesome/free-solid-svg-icons';
import type { ColumnDef } from '../../hooks/useColumnVisibility';
import './ColumnChooser.css';

interface ColumnChooserProps {
  columns: ColumnDef[];
  isVisible: (key: string) => boolean;
  onToggle: (key: string) => void;
  onShowAll: () => void;
  visibleCount: number;
  totalCount: number;
}

/** "Edit Columns" flyout, styled after a Model-Driven App view's column picker. */
export function ColumnChooser({ columns, isVisible, onToggle, onShowAll, visibleCount, totalCount }: ColumnChooserProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="column-chooser" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-secondary btn-sm column-chooser-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <FontAwesomeIcon icon={faTableColumns} className="column-chooser-icon" aria-hidden="true" />
        Columns
        <span className="column-chooser-count">{visibleCount}/{totalCount}</span>
      </button>

      {open && (
        <div className="column-chooser-panel">
          <div className="column-chooser-panel-header">
            <span>Edit Columns</span>
            <button type="button" className="column-chooser-showall" onClick={onShowAll}>Show all</button>
          </div>
          <div className="column-chooser-list">
            {columns.map((col) => (
              <label key={col.key} className={`column-chooser-item ${col.locked ? 'is-locked' : ''}`}>
                <input
                  type="checkbox"
                  checked={isVisible(col.key)}
                  disabled={col.locked}
                  onChange={() => onToggle(col.key)}
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
