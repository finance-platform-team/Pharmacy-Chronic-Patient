import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faTruckMedical, faPaperPlane, faCircleCheck, faTriangleExclamation, faLayerGroup,
  faBoxesStacked, faMagnifyingGlass, faChevronRight, faBan, faCheck,
  faClockRotateLeft, faAnglesDown, faAnglesUp, faCapsules, faRotateLeft
} from '@fortawesome/free-solid-svg-icons';
import { useDueRefillQueue } from '../../hooks/useDueRefillQueue';
import {
  AVAILABILITY_OPTIONS, DUE_RANGE_PRESETS, ELIGIBILITY_OPTIONS, dueRangeBounds,
  type DueRange, type RefillFilters
} from '../../domain/refillFilters';
import { DateRangePicker } from '../ui/DateRangePicker';
import { SegmentedFilter, type FilterTone, type SegmentedOption } from '../ui/SegmentedFilter';
import { updatePrescriptionStatus, sendTaskToOmni, CrmSendError } from '../../api/refillsApi';
import { getProductsByPrescriptionIds } from '../../api/productsApi';
import type { PrescriptionRow, ProductSummary } from '../../domain/types';
import { RefreshButton } from '../ui/RefreshButton';
import { useSort, type SortAccessor } from '../../hooks/useSort';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { SortableTh } from '../ui/SortableTh';
import '../patients/PatientsPage.css';
import './DueRefillQueuePage.css';

type OmniSendState = { status: 'sending' } | { status: 'sent'; at: number };
type Category = 'sent' | 'ready' | 'not-eligible';
type QuickFilter = 'all' | Category;

function initials(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatCycleDue(iso: string | null): string {
  if (!iso) return '—';
  return iso.split('T')[0];
}

function formatChipDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
}

// Shorter labels than AVAILABILITY_OPTIONS so the whole filter bar fits on one line.
const AVAILABILITY_FILTER_OPTIONS: SegmentedOption<string>[] = [
  { value: '', label: 'All' },
  { value: '766990000', label: 'Available', tone: 'success' },
  { value: '766990001', label: 'Partial', tone: 'warning' },
  { value: '766990002', label: 'Out of Stock', tone: 'danger' }
];

const DISPENSED_FILTER_OPTIONS: SegmentedOption<RefillFilters['dispensed']>[] = [
  { value: '', label: 'All' },
  { value: 'yes', label: 'Yes', tone: 'success' },
  { value: 'no', label: 'No', tone: 'neutral' }
];

// Text on the Cycle Due pill: the preset's name, or the picked range.
function dueLabel(f: RefillFilters): string | null {
  if (f.dueRange === 'all') return null;
  if (f.dueRange !== 'custom') return DUE_RANGE_PRESETS.find((p) => p.value === f.dueRange)?.label ?? null;
  if (!f.fromDate || !f.toDate) return null;
  return f.fromDate === f.toDate
    ? formatChipDate(f.fromDate)
    : `${formatChipDate(f.fromDate)} – ${formatChipDate(f.toDate)}`;
}

function formatSentAt(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

function formatSynced(ts: number | null, now: number): string {
  if (!ts) return 'Not synced yet';
  const mins = Math.floor((now - ts) / 60000);
  if (mins < 1) return 'Synced just now';
  if (mins === 1) return 'Synced 1 min ago';
  if (mins < 60) return `Synced ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `Synced ${hrs} hr${hrs === 1 ? '' : 's'} ago`;
}

function formatMoney(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Splits into ≤50-id chunks — same OData "or"-chain safety cap used elsewhere
// in this app (e.g. prescriptionsApi's MAX_PATIENT_ID_FILTER) — before calling
// the existing, unmodified getProductsByPrescriptionIds.
const PRODUCT_ID_CHUNK = 50;

function availabilityClass(availability: string | null): string {
  if (availability === 'Available') return 'pill-success';
  if (availability === 'Partial Available') return 'pill-muted';
  if (availability === 'Out of Stock') return 'pill-danger';
  return 'pill-neutral';
}

// A blank value isn't neutral — chp_eligibility's Dataverse default is "Not
// Valid", so anything other than "Valid" (including blank) styles as Not Valid.
function eligibilityClass(eligibility: string | null): string {
  if (eligibility === 'Valid') return 'pill-success';
  return 'pill-danger';
}

// Same field/values/classes as PatientDetailsPanel's chronicClass — kept as its
// own small local copy rather than a shared import, matching how this page
// already duplicates its other tiny per-page formatters (e.g. initials()).
function chronicClass(status: string | null): string {
  if (status === 'Active Chronic') return 'pill-live';
  if (status === 'Inactive Chronic') return 'pill-muted';
  return 'pill-neutral';
}

// Send-readiness (the Action column's Send button / Sent pill, the row's
// left track-bar color, and "Send All Ready") is driven by Availability
// alone — explicit business rule, independent of Eligibility.
function categorize(row: PrescriptionRow, omniStatus: Record<string, OmniSendState>): Category {
  if (omniStatus[row.id]?.status === 'sent') return 'sent';
  if (row.availability === 'Available') return 'ready';
  return 'not-eligible';
}

// The "Not Eligible" stat card/quick-filter is a SEPARATE concept from
// send-readiness above — it tracks the Eligibility column only. A blank
// value isn't neutral: chp_eligibility's Dataverse default is "Not Valid".
function isNotEligible(row: PrescriptionRow, omniStatus: Record<string, OmniSendState>): boolean {
  if (omniStatus[row.id]?.status === 'sent') return false;
  return row.eligibility !== 'Valid';
}

const QUICK_FILTERS: { key: QuickFilter; label: string; tone?: FilterTone }[] = [
  { key: 'all', label: 'All' },
  { key: 'sent', label: 'Sent to Omni', tone: 'success' },
  { key: 'ready', label: 'Ready to Send', tone: 'info' },
  { key: 'not-eligible', label: 'Not Eligible', tone: 'danger' }
];

export function DueRefillQueuePage() {
  const { rows, loading, error, filters, setFilters, refresh, reloadSilently, currentUser, currentUserResolved, sentToOmni } = useDueRefillQueue();
  const [rowsData, setRowsData] = useState(rows);
  const [editing, setEditing] = useState<{ id: string; field: 'eligibility' | 'availability' } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedCell, setSavedCell] = useState<{ id: string; field: 'eligibility' | 'availability' } | null>(null);
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);
  const editCellRef = useRef<HTMLTableCellElement | null>(null);

  const [omniStatus, setOmniStatus] = useState<Record<string, OmniSendState>>({});

  // Merge in the persisted "already sent" state (read from the real
  // chp_omnitasks records) so the Sent pill survives a refresh/reload instead
  // of reverting to "Send Task to Omni". Never clobbers an in-flight send.
  useEffect(() => {
    setOmniStatus((prev) => {
      let changed = false;
      const next = { ...prev };
      sentToOmni.forEach((at, id) => {
        const current = next[id];
        if (current?.status === 'sending') return;
        if (current?.status !== 'sent' || current.at !== at) {
          next[id] = { status: 'sent', at };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [sentToOmni]);

  const [sendingAll, setSendingAll] = useState(false);

  // Paused while a cell is being edited/saved or a Send is in flight, so a
  // background reload can't overwrite what the user is in the middle of.
  const anySending = Object.values(omniStatus).some((s) => s.status === 'sending');
  useLiveRefresh(
    ['cr18c_prescriptions', 'chp_omnitasks', 'cr18c_patients'],
    reloadSilently,
    { paused: editing !== null || savingId !== null || sendingAll || anySending }
  );
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [productsCache, setProductsCache] = useState<Map<string, ProductSummary[]>>(new Map());
  const [productsLoading, setProductsLoading] = useState<Set<string>>(new Set());
  const [productsError, setProductsError] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    setRowsData(rows);
    // A fresh prescriptions fetch may have changed which cycles exist — keep
    // rows the user had expanded open if they still exist (a live background
    // reload shouldn't collapse what they're looking at), but drop cached
    // line items so a re-expand reflects the latest data.
    const ids = new Set(rows.map((r) => r.id));
    setExpandedIds((prev) => {
      const kept = new Set([...prev].filter((id) => ids.has(id)));
      return kept.size === prev.size ? prev : kept;
    });
    setProductsCache((prev) => new Map([...prev].filter(([id]) => ids.has(id))));
    setProductsError(new Map());
  }, [rows]);

  // `rows` too, so a silent live reload (which never flips `loading`) still
  // moves the "last synced" time forward.
  useEffect(() => {
    if (!loading) setLastSyncedAt(Date.now());
  }, [loading, rows]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  function showToast(message: string, tone: 'success' | 'error' = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const searchFilteredRows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return rowsData;
    return rowsData.filter((r) =>
      (r.name ?? '').toLowerCase().includes(q)
      || (r.patientName ?? '').toLowerCase().includes(q)
    );
  }, [rowsData, filters.search]);

  const filteredRows = useMemo(() => {
    if (quickFilter === 'all') return searchFilteredRows;
    if (quickFilter === 'not-eligible') return searchFilteredRows.filter((r) => isNotEligible(r, omniStatus));
    return searchFilteredRows.filter((r) => categorize(r, omniStatus) === quickFilter);
  }, [searchFilteredRows, quickFilter, omniStatus]);

  const sortAccessors = useMemo<Record<string, SortAccessor<PrescriptionRow>>>(() => ({
    cycleId: (r) => r.name,
    patient: (r) => r.patientName,
    patientMobile: (r) => r.patientMobile,
    bu: (r) => r.businessUnit,
    pharmacyName: (r) => r.pharmacyName,
    chronicStatus: (r) => r.chronicStatus,
    cycleDue: (r) => r.monthlyDispensingDate,
    dispensedValue: (r) => r.dispensedValue,
    eligibility: (r) => r.eligibility,
    availability: (r) => r.availability,
    dispensed: (r) => (r.dispensed ? 1 : 0)
  }), []);
  const { sorted: sortedRows, sortKey, sortDir, toggleSort } = useSort(filteredRows, sortAccessors);

  // Fetches products for whichever of the given prescription ids aren't
  // already cached or already in flight, in ≤50-id batches run in parallel,
  // then merges everything into the cache with a single state update —
  // never one API call per row.
  async function fetchProducts(ids: string[]) {
    const toFetch = ids.filter((id) => !productsCache.has(id) && !productsLoading.has(id));
    if (toFetch.length === 0) return;

    setProductsLoading((prev) => {
      const next = new Set(prev);
      toFetch.forEach((id) => next.add(id));
      return next;
    });
    setProductsError((prev) => {
      const next = new Map(prev);
      toFetch.forEach((id) => next.delete(id));
      return next;
    });

    const chunks: string[][] = [];
    for (let i = 0; i < toFetch.length; i += PRODUCT_ID_CHUNK) {
      chunks.push(toFetch.slice(i, i + PRODUCT_ID_CHUNK));
    }

    try {
      const results = await Promise.all(chunks.map((chunk) => getProductsByPrescriptionIds(chunk)));
      const byPrescription = new Map<string, ProductSummary[]>();
      toFetch.forEach((id) => byPrescription.set(id, []));
      results.flat().forEach((p) => {
        const list = byPrescription.get(p.prescriptionId);
        if (list) list.push(p);
        else byPrescription.set(p.prescriptionId, [p]);
      });

      setProductsCache((prev) => {
        const next = new Map(prev);
        byPrescription.forEach((list, id) => next.set(id, list));
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load products';
      setProductsError((prev) => {
        const next = new Map(prev);
        toFetch.forEach((id) => next.set(id, message));
        return next;
      });
    } finally {
      setProductsLoading((prev) => {
        const next = new Set(prev);
        toFetch.forEach((id) => next.delete(id));
        return next;
      });
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        void fetchProducts([id]);
      }
      return next;
    });
  }

  function expandAll() {
    const ids = sortedRows.map((r) => r.id);
    setExpandedIds(new Set(ids));
    void fetchProducts(ids);
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  // Sending to Omni has no persisted Dataverse field to track — same as before
  // this redesign, it's a session-only simulated dispatch. The "Sent" timestamp
  // shown is real (captured the moment it's clicked), just not saved anywhere.
  const stats = useMemo(() => {
    let sent = 0, ready = 0, notEligible = 0;
    rowsData.forEach((r) => {
      const c = categorize(r, omniStatus);
      if (c === 'sent') sent++;
      else if (c === 'ready') ready++;
      if (isNotEligible(r, omniStatus)) notEligible++;
    });
    return { sent, ready, notEligible, total: rowsData.length };
  }, [rowsData, omniStatus]);

  // rowId is the row's own id, which getAllPrescriptions() already maps 1:1
  // from cr18c_prescriptionid — so this always sends the exact clicked row's
  // real prescription id, never a hardcoded or stale one. Resets the row back
  // out of "sending" on failure (instead of leaving the button stuck) and
  // rethrows so the caller can show a specific error message.
  async function sendOne(rowId: string): Promise<void> {
    setOmniStatus((prev) => ({ ...prev, [rowId]: { status: 'sending' } }));
    try {
      await sendTaskToOmni(rowId);
      setOmniStatus((prev) => ({ ...prev, [rowId]: { status: 'sent', at: Date.now() } }));
    } catch (err) {
      if (err instanceof CrmSendError) {
        // The Omni task exists, so keep the row locked as sent — re-sending would duplicate it.
        setOmniStatus((prev) => ({ ...prev, [rowId]: { status: 'sent', at: Date.now() } }));
      } else {
        setOmniStatus((prev) => {
          const next = { ...prev };
          delete next[rowId];
          return next;
        });
      }
      throw err;
    }
  }

  async function handleSendOmni(rowId: string) {
    try {
      await sendOne(rowId);
      showToast('Task sent to Omni successfully.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to send task to Omni', 'error');
    }
  }

  async function handleSendAllReady() {
    const ready = filteredRows.filter((r) => categorize(r, omniStatus) === 'ready');
    if (ready.length === 0) return;

    setSendingAll(true);
    const results = await Promise.allSettled(ready.map((r) => sendOne(r.id)));
    setSendingAll(false);

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;
    if (failed === 0) {
      showToast(`Sent ${succeeded} cycle${succeeded === 1 ? '' : 's'} to Omni`);
    } else if (succeeded === 0) {
      showToast(`Failed to send ${failed} cycle${failed === 1 ? '' : 's'} to Omni`, 'error');
    } else {
      showToast(`Sent ${succeeded} cycle${succeeded === 1 ? '' : 's'}, but ${failed} failed`, 'error');
    }
  }

  function clearAllFilters() {
    setFilters({ ...filters, search: '', availability: '', dispensed: '', dueRange: 'all', fromDate: '', toDate: '' });
  }

  const activeFilterCount = [filters.search, filters.availability, filters.dispensed, filters.dueRange !== 'all'].filter(Boolean).length;

  useEffect(() => {
    if (!editing) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (editCellRef.current && !editCellRef.current.contains(event.target as Node)) {
        setEditing(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editing]);

  async function saveStatus(rowId: string, field: 'eligibility' | 'availability', value: string) {
    const options = field === 'availability' ? AVAILABILITY_OPTIONS : ELIGIBILITY_OPTIONS;
    const selectedOption = options.find((opt) => opt.value === value);
    if (!selectedOption) return;

    setSavingId(rowId);
    setSaveError(null);

    const previousRows = rowsData.map((row) => ({ ...row }));
    const updatedRows = rowsData.map((row) =>
      row.id === rowId ? { ...row, [field]: selectedOption.label } : row
    );
    setRowsData(updatedRows);

    try {
      const updateFields: Record<string, string | undefined> = {};
      updateFields[field === 'availability' ? 'chp_availability' : 'chp_eligibility'] = value;
      await updatePrescriptionStatus(rowId, updateFields as any);
      setSavedCell({ id: rowId, field });
      setTimeout(() => setSavedCell(null), 1200);
    } catch (err) {
      setRowsData(previousRows);
      setSaveError({ id: rowId, message: err instanceof Error ? err.message : 'Failed to save status' });
    } finally {
      setSavingId(null);
      setEditing(null);
    }
  }

  function renderStatusCell(row: PrescriptionRow, field: 'eligibility' | 'availability') {
    const isEditing = editing?.id === row.id && editing.field === field;
    const options = field === 'availability' ? AVAILABILITY_OPTIONS : ELIGIBILITY_OPTIONS;
    const currentValue = field === 'availability' ? row.availability : row.eligibility;
    const selectedOption = options.find((opt) => opt.label === currentValue || opt.value === currentValue);
    // A blank Eligibility isn't a neutral/unset state — Dataverse's own column
    // default for chp_eligibility is "Not Valid", and categorize() already
    // treats a blank value as not-eligible — so show that instead of a dash,
    // which read as "no status" and made the Not Eligible count look wrong.
    const displayLabel = selectedOption?.label ?? currentValue ?? (field === 'eligibility' ? 'Not Valid' : '—');
    const isSaving = savingId === row.id && editing?.field === field;
    const isSaved = savedCell?.id === row.id && savedCell?.field === field;
    const rowSaveError = saveError?.id === row.id ? saveError.message : null;
    // Once a row has already been sent to Omni, its status is locked — no more
    // opening the dropdown to change Eligibility/Availability.
    const isLocked = omniStatus[row.id]?.status === 'sent';

    return (
      <td className="editable-status-cell" ref={isEditing ? editCellRef : null}>
        <div className="status-cell">
          <button
            type="button"
            className={`status-cell-button ${field === 'availability' ? availabilityClass(currentValue) : eligibilityClass(currentValue)}${isLocked ? ' status-cell-locked' : ''}`}
            disabled={isLocked}
            onClick={() => {
              if (isLocked) return;
              setEditing({ id: row.id, field });
              setSaveError(null);
            }}
          >
            <span className="status-cell-label">{displayLabel}</span>
            {!isLocked && <span className="status-chevron">▾</span>}
          </button>

          {isEditing && !isLocked && (
            <div className="status-dropdown-panel">
              {options.map((opt) => {
                const optClass = field === 'availability' ? availabilityClass(opt.label) : eligibilityClass(opt.label);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`status-option ${optClass}`}
                    onClick={() => saveStatus(row.id, field, opt.value)}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
          {isSaving && <span className="status-saving">Saving…</span>}
          {rowSaveError && !isSaving && !isSaved && <span className="status-error-cell">{rowSaveError}</span>}
          {!isEditing && isSaved && <span className="status-saved">Saved</span>}
        </div>
      </td>
    );
  }

  function renderActionCell(row: PrescriptionRow) {
    const category = categorize(row, omniStatus);
    const send = omniStatus[row.id];

    let content: ReactNode;
    if (category === 'sent' && send?.status === 'sent') {
      content = (
        <div className="action-cell-inner">
          <span className="state-pill pill-sent">
            <span className="pill-ic"><FontAwesomeIcon icon={faCheck} aria-hidden="true" /></span>
            Sent
          </span>
          <span className="meta-line">{formatSentAt(send.at)}</span>
        </div>
      );
    } else if (category === 'ready') {
      content = (
        <div className="action-cell-inner">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={send?.status === 'sending'}
            onClick={() => void handleSendOmni(row.id)}
          >
            {send?.status === 'sending' ? (
              <><span className="btn-spinner" /> Sending…</>
            ) : (
              <><FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" /> Send Task to Omni</>
            )}
          </button>
        </div>
      );
    } else {
      content = (
        <div className="action-cell-inner">
          <span className="state-pill pill-blocked">
            <FontAwesomeIcon icon={faBan} aria-hidden="true" />
            Not Eligible
          </span>
        </div>
      );
    }

    return <td className="actions-cell" style={{ textAlign: 'right' }}>{content}</td>;
  }

  function renderProductsCard(row: PrescriptionRow) {
    const products = productsCache.get(row.id);
    const isLoading = productsLoading.has(row.id);
    const err = productsError.get(row.id);

    const totalSales = (products ?? []).reduce((acc, p) => acc + (p.salesPrice ?? 0), 0);

    return (
      <div className="prod-card">
        {isLoading && <div className="prod-state">Loading products…</div>}

        {!isLoading && err && (
          <div className="prod-state prod-state-error">
            {err}
            <button type="button" className="prod-retry" onClick={() => void fetchProducts([row.id])}>Retry</button>
          </div>
        )}

        {!isLoading && !err && products && products.length === 0 && (
          <div className="prod-state">No products linked to this cycle.</div>
        )}

        {!isLoading && !err && products && products.length > 0 && (
          <div className="table-scroll">
            <table className="prod-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num">Item ID</th>
                  <th className="num">Quantity</th>
                  <th className="num">Sales Price</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="prod-cell">
                        <span className="prod-ic"><FontAwesomeIcon icon={faCapsules} aria-hidden="true" /></span>
                        <span className="prod-name">{p.name ?? '—'}</span>
                      </div>
                    </td>
                    <td className="num mono-muted">{p.itemId ?? '—'}</td>
                    <td className="num"><span className="qty-badge">{p.quantity ?? 0}</span></td>
                    <td className="num">{formatMoney(p.salesPrice)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="prod-total-row">
                  <td colSpan={3}>Total</td>
                  <td className="num">{formatMoney(totalSales)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell due-refill-page">
      <div className="page-header page-panel">
        <div className="page-header-row">
          <div className="page-title-grp">
            <div className="cis-page"><FontAwesomeIcon icon={faTruckMedical} aria-hidden="true" /></div>
            <div>
              <h1 className="page-title">Due Refill Queue</h1>
              <div className="page-sub">
                {filters.myWorkOnly
                  ? currentUser?.name
                    ? `Showing cycles assigned to ${currentUser.name}`
                    : 'Showing your assigned cycles'
                  : 'Chronic Pharmacy — review cycles before sending to Omni'}
              </div>
            </div>
          </div>

          <div className="segmented-toggle">
            <button
              type="button"
              className={`segmented-toggle-btn ${filters.myWorkOnly ? 'active' : ''}`}
              onClick={() => setFilters({ ...filters, myWorkOnly: true })}
            >
              My Work
            </button>
            <button
              type="button"
              className={`segmented-toggle-btn ${!filters.myWorkOnly ? 'active' : ''}`}
              onClick={() => setFilters({ ...filters, myWorkOnly: false })}
            >
              All
            </button>
          </div>

          <div className="toolbar-summary">
            <span className="sync-note"><FontAwesomeIcon icon={faClockRotateLeft} aria-hidden="true" /> {formatSynced(lastSyncedAt, now)}</span>
            <RefreshButton onRefresh={refresh} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={sendingAll || stats.ready === 0}
              onClick={() => void handleSendAllReady()}
            >
              <FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" /> {sendingAll ? 'Sending…' : 'Send All Ready'}
            </button>
          </div>
        </div>
      </div>

      <div className="stat-row">
        {/* Each card filters the table by its status; clicking the active card clears it. */}
        <button type="button" className={`stat-card stat-card-btn sc-green${quickFilter === 'sent' ? ' is-active' : ''}`} aria-pressed={quickFilter === 'sent'} onClick={() => setQuickFilter(quickFilter === 'sent' ? 'all' : 'sent')}>
          <div className="stat-ic green"><FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" /></div>
          <div><div className="stat-lbl">Sent To Omni</div><div className="stat-val">{stats.sent}</div></div>
        </button>
        <button type="button" className={`stat-card stat-card-btn sc-gold${quickFilter === 'ready' ? ' is-active' : ''}`} aria-pressed={quickFilter === 'ready'} onClick={() => setQuickFilter(quickFilter === 'ready' ? 'all' : 'ready')}>
          <div className="stat-ic gold"><FontAwesomeIcon icon={faPaperPlane} aria-hidden="true" /></div>
          <div><div className="stat-lbl">Ready To Send</div><div className="stat-val">{stats.ready}</div></div>
        </button>
        <button type="button" className={`stat-card stat-card-btn sc-alert${quickFilter === 'not-eligible' ? ' is-active' : ''}`} aria-pressed={quickFilter === 'not-eligible'} onClick={() => setQuickFilter(quickFilter === 'not-eligible' ? 'all' : 'not-eligible')}>
          <div className="stat-ic alert"><FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" /></div>
          <div><div className="stat-lbl">Not Eligible</div><div className="stat-val">{stats.notEligible}</div></div>
        </button>
        <button type="button" className={`stat-card stat-card-btn sc-dim${quickFilter === 'all' ? ' is-active' : ''}`} aria-pressed={quickFilter === 'all'} onClick={() => setQuickFilter('all')}>
          <div className="stat-ic dim"><FontAwesomeIcon icon={faLayerGroup} aria-hidden="true" /></div>
          <div><div className="stat-lbl">Total Cycles</div><div className="stat-val">{stats.total}</div></div>
        </button>
      </div>

      <div className="refill-filters-panel">
        <div className="refill-filters-bar">
          <div className="search-wrap refill-search">
            <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
            <input
              type="text"
              className="filter-input"
              placeholder="Search patient or Cycle ID…"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>

          <DateRangePicker<DueRange>
            label="Cycle Due"
            activeLabel={dueLabel(filters)}
            presets={DUE_RANGE_PRESETS}
            activePreset={filters.dueRange}
            rangeStart={filters.fromDate || null}
            rangeEnd={filters.toDate || null}
            onPreset={(preset) => setFilters({ ...filters, dueRange: preset, ...dueRangeBounds(preset) })}
            onRange={(fromDate, toDate) => setFilters({ ...filters, dueRange: 'custom', fromDate, toDate })}
            onClear={() => setFilters({ ...filters, dueRange: 'all', fromDate: '', toDate: '' })}
          />

          <SegmentedFilter<string>
            label="Availability"
            icon={faBoxesStacked}
            value={filters.availability}
            options={AVAILABILITY_FILTER_OPTIONS}
            onChange={(availability) => setFilters({ ...filters, availability })}
          />

          <SegmentedFilter<RefillFilters['dispensed']>
            label="Dispensed"
            icon={faCapsules}
            value={filters.dispensed}
            options={DISPENSED_FILTER_OPTIONS}
            onChange={(dispensed) => setFilters({ ...filters, dispensed })}
          />

          <SegmentedFilter<QuickFilter>
            label="Status"
            value={quickFilter}
            options={QUICK_FILTERS.map((qf) => ({
              value: qf.key,
              label: qf.label,
              tone: qf.tone,
              count: qf.key === 'sent' ? stats.sent : qf.key === 'ready' ? stats.ready : qf.key === 'not-eligible' ? stats.notEligible : undefined
            }))}
            onChange={setQuickFilter}
          />

          {activeFilterCount > 0 && (
            <button type="button" className="filter-reset" onClick={clearAllFilters}>
              <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" /> Reset ({activeFilterCount})
            </button>
          )}
        </div>
      </div>

      {!loading && !error && (
        <div className="table-toolbar">
          <button type="button" className="btn btn-outline btn-sm" onClick={expandAll} disabled={sortedRows.length === 0}>
            <FontAwesomeIcon icon={faAnglesDown} aria-hidden="true" /> Expand All
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={collapseAll} disabled={expandedIds.size === 0}>
            <FontAwesomeIcon icon={faAnglesUp} aria-hidden="true" /> Collapse All
          </button>
        </div>
      )}

      <div className="bento flush">
        <div className="table-scroll">
          {loading && <div className="loading-indicator">Loading queue…</div>}
          {error && <div className="error-state">Error: {error} <button onClick={() => void refresh()}>Retry</button></div>}
          {!loading && !error && filters.myWorkOnly && currentUserResolved && !currentUser && (
            <div className="error-state">Couldn't identify your signed-in account, so "My Work" can't be personalized right now.</div>
          )}

          {!loading && !error && (
            <table className="refill-grid">
              <thead>
                <tr>
                  <th></th>
                  <th></th>
                  <SortableTh label="Visit Id" sortKey="cycleId" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Patient" sortKey="patient" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Patient Mobile" sortKey="patientMobile" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="BU" sortKey="bu" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Pharmacy Name" sortKey="pharmacyName" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Chronic Status" sortKey="chronicStatus" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Cycle Due" sortKey="cycleDue" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Dispensed Value" sortKey="dispensedValue" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Dispensed" sortKey="dispensed" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Eligibility" sortKey="eligibility" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Availability" sortKey="availability" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={14} className="refill-empty-row">No cycles match the current filters.</td>
                  </tr>
                )}
                {sortedRows.map((r) => {
                  const category = categorize(r, omniStatus);
                  const trackClass = category === 'sent' ? 'tb-green' : category === 'ready' ? 'tb-gold' : 'tb-dim';
                  const isExpanded = expandedIds.has(r.id);

                  return (
                    <Fragment key={r.id}>
                      <tr className={category === 'sent' ? 'is-sent' : undefined}>
                        <td className="expand-cell">
                          <button
                            type="button"
                            className={`expand-toggle ${isExpanded ? 'expanded' : ''}`}
                            onClick={() => toggleExpand(r.id)}
                            aria-expanded={isExpanded}
                            aria-label={isExpanded ? 'Collapse products' : 'Expand products'}
                          >
                            <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
                          </button>
                        </td>
                        <td className="track-bar-cell"><div className={`track-bar ${trackClass}`} /></td>
                        <td><span className="mono-id">{r.name}</span></td>
                        <td>
                          <div className="patient-cell">
                            <div className="avatar">{initials(r.patientName)}</div>
                            <span className="patient-name">{r.patientName ?? '—'}</span>
                          </div>
                        </td>
                        <td className="mono">{r.patientMobile ?? '—'}</td>
                        <td>{r.businessUnit ? <span className="bu-tag">{r.businessUnit}</span> : '—'}</td>
                        <td>{r.pharmacyName ?? '—'}</td>
                        <td>{r.chronicStatus ? <span className={`pill ${chronicClass(r.chronicStatus)}`}>{r.chronicStatus}</span> : '—'}</td>
                        <td><span className="mono-date">{formatCycleDue(r.monthlyDispensingDate)}</span></td>
                        <td className="num">{r.dispensedValue !== null ? formatMoney(r.dispensedValue) : '—'}</td>
                        <td><span className={`pill ${r.dispensed ? 'pill-success' : 'pill-muted'}`}>{r.dispensed ? 'Yes' : 'No'}</span></td>
                        {renderStatusCell(r, 'eligibility')}
                        {renderStatusCell(r, 'availability')}
                        {renderActionCell(r)}
                      </tr>
                      {isExpanded && (
                        <tr className="product-subrow">
                          <td className="product-subrow-cell" colSpan={14}>
                            {renderProductsCard(r)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!loading && !error && (
          <div className="table-foot">
            <div className="foot-count">
              Showing results for: <strong>{QUICK_FILTERS.find((qf) => qf.key === quickFilter)?.label}</strong>
            </div>
            <div className="foot-count">{sortedRows.length} of {rowsData.length} cycles shown</div>
          </div>
        )}
      </div>

      {toast && (
        <div className={`toast toast-${toast.tone}`} role="status">
          <span className="toast-icon">{toast.tone === 'success' ? '✓' : '!'}</span>
          <span className="toast-message">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
