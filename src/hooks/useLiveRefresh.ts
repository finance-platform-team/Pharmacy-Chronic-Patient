import { useEffect, useRef } from 'react';
import { getLatestModifiedOn } from '../api/dataverseClient';
import { useIsActiveView } from '../context/ActiveViewContext';

interface LiveRefreshOptions {
  /** How often to check for changes while the page is on screen. */
  intervalMs?: number;
  /** Skip checks while true — e.g. mid-edit or mid-save, so a reload can't clobber it. */
  paused?: boolean;
}

/**
 * Near-live updates without a push channel (the Power Apps connector has
 * none): while this page is the visible one and the browser tab is in front,
 * it asks Dataverse every few seconds for each table's newest modifiedon —
 * a one-row, one-column query — and calls `onChange` (a silent, no-spinner
 * reload) only when one of them moved. Also checks right away when the page
 * or the browser tab comes back into view.
 */
export function useLiveRefresh(
  tables: string[],
  onChange: () => Promise<void> | void,
  { intervalMs = 8000, paused = false }: LiveRefreshOptions = {}
) {
  const isActive = useIsActiveView();
  const tokensRef = useRef<Map<string, string | null>>(new Map());
  const runningRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const pausedRef = useRef(paused);
  const tablesKey = tables.join(',');

  useEffect(() => {
    onChangeRef.current = onChange;
    pausedRef.current = paused;
  });

  useEffect(() => {
    if (!isActive) return;

    const tableList = tablesKey.split(',');
    let cancelled = false;

    async function check() {
      if (cancelled || runningRef.current || pausedRef.current || document.visibilityState !== 'visible') return;
      runningRef.current = true;
      try {
        const latest = await Promise.all(tableList.map((t) => getLatestModifiedOn(t)));
        if (cancelled) return;

        // The first check only records a baseline — the page's own initial
        // load already has fresh data.
        const hadBaseline = tableList.every((t) => tokensRef.current.has(t));
        const changed = tableList.some((t, i) => tokensRef.current.get(t) !== latest[i]);
        tableList.forEach((t, i) => tokensRef.current.set(t, latest[i]));

        if (hadBaseline && changed && !pausedRef.current) {
          await onChangeRef.current();
        }
      } catch {
        // Silent — a missed check just waits for the next tick; the manual
        // Refresh button is still there as a fallback.
      } finally {
        runningRef.current = false;
      }
    }

    void check();
    const interval = window.setInterval(() => void check(), intervalMs);

    function handleVisibility() {
      if (document.visibilityState === 'visible') void check();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [isActive, tablesKey, intervalMs]);
}
