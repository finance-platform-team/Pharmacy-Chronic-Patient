import { useEffect, useMemo, useState } from 'react';

export interface ColumnDef {
  key: string;
  label: string;
  /** Column can't be hidden (e.g. an expand toggle or row-select checkbox). */
  locked?: boolean;
}

function readHidden(storageKey: string, validKeys: Set<string>): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((key): key is string => typeof key === 'string' && validKeys.has(key)));
  } catch {
    return new Set();
  }
}

/**
 * Per-grid column show/hide, mirroring a Model-Driven App view's "Edit
 * Columns" picker. Visibility is persisted per storageKey so each page
 * remembers its own layout across sessions.
 */
export function useColumnVisibility(storageKey: string, columns: ColumnDef[]) {
  const validKeys = useMemo(() => new Set(columns.map((c) => c.key)), [columns]);
  const [hidden, setHidden] = useState<Set<string>>(() => readHidden(storageKey, validKeys));

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...hidden]));
    } catch {
      // best-effort persistence only
    }
  }, [storageKey, hidden]);

  function isVisible(key: string): boolean {
    return !hidden.has(key);
  }

  function toggle(key: string) {
    const column = columns.find((c) => c.key === key);
    if (column?.locked) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function showAll() {
    setHidden(new Set());
  }

  const visibleCount = columns.length - hidden.size;

  return { isVisible, toggle, showAll, visibleCount, totalCount: columns.length };
}
