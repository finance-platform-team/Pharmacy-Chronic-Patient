import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { getAllPrescriptions } from '../api/prescriptionsApi';
import { getPatientUserAssignments } from '../api/patientsApi';
import { getCurrentUser, type CurrentUser } from '../api/currentUserApi';
import { getSentToOmniTimestamps } from '../api/refillsApi';
import { buildRefillFilter, EMPTY_REFILL_FILTERS, type RefillFilters } from '../domain/refillFilters';
import type { PrescriptionRow } from '../domain/types';
import { useRegion } from '../context/RegionContext';
import { recordMatchesRegion } from '../api/businessUnitsApi';

const refillCache = new Map<string, PrescriptionRow[]>();

// Keyed separately from refillCache by assignment scope ('all' vs a userId) since
// the two queries pull very different (and very differently sized) result sets.
const assignmentsCache = new Map<string, Promise<Map<string, string>>>();
function loadAssignments(scopeKey: string, userId: string | undefined, force: boolean): Promise<Map<string, string>> {
  if (force || !assignmentsCache.has(scopeKey)) {
    assignmentsCache.set(
      scopeKey,
      getPatientUserAssignments(userId).then((map) => new Map([...map].map(([patientId, a]) => [patientId, a.userId])))
    );
  }
  return assignmentsCache.get(scopeKey)!;
}

export function useDueRefillQueue() {
  const [rawRows, setRows] = useState<PrescriptionRow[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [currentUserResolved, setCurrentUserResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<RefillFilters>(EMPTY_REFILL_FILTERS);
  const [sentToOmni, setSentToOmni] = useState<Map<string, number>>(new Map());
  const { region } = useRegion();

  const rows = useMemo(
    () => rawRows.filter((r) => recordMatchesRegion(r.businessUnit, region)),
    [rawRows, region]
  );

  // Read from the real chp_omnitasks records (linked back to their
  // prescription) instead of relying on in-memory state alone, so the "Sent"
  // pill survives a refresh/reload instead of reverting to "Send Task to Omni".
  const loadSentToOmni = useCallback(async () => {
    try {
      const map = await getSentToOmniTimestamps();
      setSentToOmni(map);
    } catch {
      // non-critical — worst case, a previously-sent row briefly shows as not sent
    }
  }, []);

  useEffect(() => {
    void loadSentToOmni();
  }, [loadSentToOmni]);

  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((user) => { if (!cancelled) setCurrentUser(user); })
      .finally(() => { if (!cancelled) setCurrentUserResolved(true); });
    return () => { cancelled = true; };
  }, []);

  // "My Work" is scoped server-side to the signed-in user's own caseload (a handful
  // of patients) instead of pulling every user-assigned prescription in the system
  // and filtering it down client-side — much less data over the wire, much faster.
  // Guards against an older, slower request landing after a newer one and
  // overwriting fresher results.
  const requestIdRef = useRef(0);

  const load = useCallback(async (force = false, silent = false) => {
    if (filters.myWorkOnly && !currentUserResolved) return;

    const scopeKey = filters.myWorkOnly ? `user:${currentUser?.id ?? 'none'}` : 'all';
    const cacheKey = `${buildRefillFilter(filters)}|${scopeKey}`;

    if (!force && refillCache.has(cacheKey)) {
      setRows(refillCache.get(cacheKey)!);
      setLoading(false);
      setError(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      let data: PrescriptionRow[];

      if (filters.myWorkOnly) {
        if (!currentUser) {
          data = [];
        } else {
          const myAssignments = await loadAssignments(scopeKey, currentUser.id, force);
          const patientIds = Array.from(myAssignments.keys());
          const prescriptions = await getAllPrescriptions(buildRefillFilter(filters), patientIds);
          // Cheap no-op when the id filter above already applied server-side; the
          // real job is the (rare) fallback where a huge caseload skipped it.
          data = prescriptions.filter((row) => !!row.patientId && myAssignments.has(row.patientId));
        }
      } else {
        const [prescriptions, assignmentMap] = await Promise.all([
          getAllPrescriptions(buildRefillFilter(filters)),
          loadAssignments(scopeKey, undefined, force)
        ]);
        data = prescriptions.filter((row) => !!row.patientId && assignmentMap.has(row.patientId));
      }

      refillCache.set(cacheKey, data);
      if (requestId !== requestIdRef.current) return;
      setRows(data);
      setError(null);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [filters, currentUser, currentUserResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  // Both drop every cached filter combination and assignment scope — the
  // underlying data changed, so all of it is stale, not just the current view.
  const refresh = useCallback(() => {
    refillCache.clear();
    void loadSentToOmni();
    return load(true);
  }, [load, loadSentToOmni]);

  const reloadSilently = useCallback(async () => {
    refillCache.clear();
    await Promise.all([loadSentToOmni(), load(true, true)]);
  }, [load, loadSentToOmni]);

  return {
    rows,
    loading,
    error,
    filters,
    setFilters,
    refresh,
    reloadSilently,
    currentUser,
    currentUserResolved,
    sentToOmni
  };
}
