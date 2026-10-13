import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { getAllPatients } from '../api/patientsApi';
import { buildPatientFilter, EMPTY_FILTERS, type PatientFilters } from '../domain/patientFilters';
import type { Patient } from '../domain/types';
import { useRegion } from '../context/RegionContext';
import { recordMatchesRegion } from '../api/businessUnitsApi';

interface UsePatientsResult {
  patients: Patient[];
  loading: boolean;
  error: string | null;
  filters: PatientFilters;
  setFilters: (f: PatientFilters) => void;
  refresh: () => Promise<void>;
  /** Background reload for live updates — no loading state, keeps the table on screen. */
  reloadSilently: () => Promise<void>;
  patchPatients: (changesById: Map<string, Partial<Patient>>) => void;
}

const patientsCache = new Map<string, Patient[]>();

function getPatientCacheKey(filters: PatientFilters) {
  return JSON.stringify(filters);
}

export function usePatients(): UsePatientsResult {
  const [rawPatients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<PatientFilters>(EMPTY_FILTERS);
  const prevFiltersRef = useRef<PatientFilters>(filters);
  const { region } = useRegion();

  // Re-filtered reactively on every region switch — no refetch needed, since
  // the raw fetch below isn't region-scoped and the sidebar toggle should
  // re-filter the already-loaded list immediately.
  const patients = useMemo(
    () => rawPatients.filter((p) => recordMatchesRegion(p.businessUnitName, region)),
    [rawPatients, region]
  );

  // Guards against an older, slower request landing after a newer one (e.g.
  // typing in search fires several) and overwriting fresher results.
  const requestIdRef = useRef(0);

  const load = useCallback(async (force = false, silent = false) => {
    const cacheKey = getPatientCacheKey(filters);
    if (!force && patientsCache.has(cacheKey)) {
      setPatients(patientsCache.get(cacheKey)!);
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
      const data = await getAllPatients(buildPatientFilter(filters));
      patientsCache.set(cacheKey, data);
      if (requestId !== requestIdRef.current) return;
      setPatients(data);
      setError(null);
    } catch (err) {
      console.error('Failed to load patients:', err);
      if (requestId !== requestIdRef.current) return;
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load patients');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const cacheKey = getPatientCacheKey(filters);
    if (patientsCache.has(cacheKey)) {
      setPatients(patientsCache.get(cacheKey)!);
      setLoading(false);
      setError(null);
      prevFiltersRef.current = filters;
      return;
    }

    const shouldDebounce = prevFiltersRef.current.search !== filters.search
      || prevFiltersRef.current.pharmacyName !== filters.pharmacyName;
    prevFiltersRef.current = filters;

    if (shouldDebounce) {
      const timer = window.setTimeout(() => void load(), 350);
      return () => window.clearTimeout(timer);
    }

    void load();
  }, [filters, load]);

  // Both drop every cached filter combination, not just the current one — the
  // underlying data changed, so any other cached result is stale too.
  const refresh = useCallback(() => {
    patientsCache.clear();
    return load(true);
  }, [load]);

  const reloadSilently = useCallback(() => {
    patientsCache.clear();
    return load(true, true);
  }, [load]);

  // Patches already-known rows in place (e.g. after a user-assignment save) instead
  // of refetching the whole list — the grid can hold up to 500 rows, so round-tripping
  // all of them just to reflect a one-field change on one or a few rows is wasteful and
  // slow. Keeps the filter-keyed cache consistent so a later tab-away/tab-back doesn't
  // show stale data either.
  const patchPatients = useCallback((changesById: Map<string, Partial<Patient>>) => {
    setPatients((prev) => {
      const next = prev.map((p) => {
        const changes = changesById.get(p.id);
        return changes ? { ...p, ...changes } : p;
      });
      patientsCache.set(getPatientCacheKey(filters), next);
      return next;
    });
  }, [filters]);

  return { patients, loading, error, filters, setFilters, refresh, reloadSilently, patchPatients };
}