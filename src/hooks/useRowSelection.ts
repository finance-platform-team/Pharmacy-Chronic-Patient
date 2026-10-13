import { useCallback, useMemo, useState } from 'react';

export interface UseRowSelectionResult {
  selectedIds: Set<string>;
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** True when every id on the current page is selected. */
  allOnPageSelected: boolean;
  /** True when some (but not all) ids on the current page are selected — for the header checkbox's indeterminate state. */
  someOnPageSelected: boolean;
  toggleAllOnPage: () => void;
  clear: () => void;
  /** Replaces the whole selection — used to narrow it down to just the records that failed a bulk update, so the user can retry without re-selecting from scratch. */
  setSelected: (ids: string[]) => void;
}

/**
 * Selection persists across page navigation (so a user can page through and
 * build up a selection, matching Dynamics 365's grid behavior), but
 * "select all" only ever acts on the ids visible on the current page.
 */
export function useRowSelection(pageIds: string[]): UseRowSelectionResult {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someOnPageSelected = !allOnPageSelected && pageIds.some((id) => selectedIds.has(id));

  const toggleAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = pageIds.length > 0 && pageIds.every((id) => next.has(id));
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [pageIds]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);
  const setSelected = useCallback((ids: string[]) => setSelectedIds(new Set(ids)), []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return useMemo(() => ({
    selectedIds,
    count: selectedIds.size,
    isSelected,
    toggle,
    allOnPageSelected,
    someOnPageSelected,
    toggleAllOnPage,
    clear,
    setSelected
  }), [selectedIds, isSelected, toggle, allOnPageSelected, someOnPageSelected, toggleAllOnPage, clear, setSelected]);
}
