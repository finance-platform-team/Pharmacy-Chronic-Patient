import { useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';
export type SortAccessor<T> = (item: T) => string | number | null;

export interface UseSortResult<T> {
  sorted: T[];
  sortKey: string | null;
  sortDir: SortDir;
  toggleSort: (key: string) => void;
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Click-to-sort over an already-loaded array: first click on a column sorts
 * ascending, second click flips to descending, third click clears back to
 * the original (unsorted) order.
 */
export function useSort<T>(items: T[], accessors: Record<string, SortAccessor<T>>): UseSortResult<T> {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortKey(null);
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey || !accessors[sortKey]) return items;
    const accessor = accessors[sortKey];
    const copy = [...items].sort((a, b) => compareValues(accessor(a), accessor(b)));
    if (sortDir === 'desc') copy.reverse();
    return copy;
  }, [items, sortKey, sortDir, accessors]);

  return { sorted, sortKey, sortDir, toggleSort };
}
