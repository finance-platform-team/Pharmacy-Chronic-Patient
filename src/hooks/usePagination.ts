import { useCallback, useMemo, useState } from 'react';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export interface UsePaginationResult {
  page: number;
  pageSize: number;
  totalPages: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  resetPage: () => void;
}

/**
 * Dataverse's Web API does not support offset-based `$skip` paging, so page
 * navigation here is client-side over an already-fetched (filtered) result
 * set — the same data each list page already loads via its own `top` cap.
 * `total` is the size of that fetched set, and the hook self-clamps `page`
 * whenever `total`/`pageSize` change (e.g. a filter shrinks the result set).
 */
export function usePagination(total: number, initialPageSize: number = 25): UsePaginationResult {
  const [page, setPageRaw] = useState(1);
  const [pageSize, setPageSizeRaw] = useState(initialPageSize);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);

  const setPage = useCallback((next: number) => {
    setPageRaw(Math.max(1, Math.floor(next)));
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeRaw(size);
    setPageRaw(1);
  }, []);

  const resetPage = useCallback(() => setPageRaw(1), []);

  return useMemo(() => ({
    page: clampedPage,
    pageSize,
    totalPages,
    setPage,
    setPageSize,
    resetPage
  }), [clampedPage, pageSize, totalPages, setPage, setPageSize, resetPage]);
}

export function paginateItems<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
