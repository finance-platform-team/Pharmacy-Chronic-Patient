import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faClipboardList, faMagnifyingGlass, faArrowDownWideShort, faCircleCheck,
  faPhone, faTruckFast, faFlagCheckered, faBox, faHouse, faClock, faPills
} from '@fortawesome/free-solid-svg-icons';
import { getAllPreparationTasks, updatePreparationStatus, setPreparationStartTime, type PreparationTask } from '../../api/preparationApi';
import { RefreshButton } from '../ui/RefreshButton';
import { ExportExcelButton } from '../ui/ExportExcelButton';
import type { XlsxColumn } from '../../domain/xlsx';
import { useSort, type SortAccessor } from '../../hooks/useSort';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { SortableTh } from '../ui/SortableTh';
import { useRegion } from '../../context/RegionContext';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';
import { PrepVisitModal } from './PrepVisitModal';
import { loadPrepVisitDetails, type PrepVisitDetails } from '../../api/prepVisitApi';
import { recordMatchesRegion } from '../../api/businessUnitsApi';
import {
  PREP_STATUS_CALLED, PREP_STATUS_FULFILLED,
  nextStage, stageIndex, stageLabel, stageOf, type PrepStage
} from '../../domain/prepStages';
import '../patients/PatientsPage.css';
import './PreparationQueuePage.css';

const URGENCY_RANK: Record<PrepStage, number> = {
  none: 0,
  called: 1,
  recorded: 2,
  ready: 3,
  fulfilled: 4
};

// Elapsed-time-up display for the live Prep SLA timer: minutes while under an
// hour (so it visibly moves right after starting), whole hours up to 24h, then
// days+hours per spec (e.g. "1d 3h").
function formatElapsed(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 1) return `${totalMinutes}m`;
  if (totalHours < 24) return `${totalHours}h`;
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${days}d ${hours}h`;
}

const SORT_COLUMN_LABELS: Record<string, string> = {
  pharmacyVisitId: 'Pharmacy Visit ID',
  patient: 'Patient',
  opdVisit: 'OPD Visit',
  bu: 'BU',
  fulfilmentPath: 'Fulfilment Path',
  prepStatus: 'Prep Status',
  prepSla: 'Prep SLA',
  pharmacist: 'Pharmacist'
};

type PrepCardFilter = 'all' | 'called' | 'recorded' | 'ready';

function formatExportDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

const EXPORT_COLUMNS: XlsxColumn<PreparationTask>[] = [
  { header: 'Pharmacy Visit ID', value: (t) => t.pharmacyVisitId, width: 18 },
  { header: 'Patient', value: (t) => t.patient, width: 32 },
  { header: 'OPD Visit', value: (t) => t.opdVisit, width: 16 },
  { header: 'BU', value: (t) => t.bu },
  { header: 'Fulfilment Path', value: (t) => t.fulfilmentPath, width: 16 },
  { header: 'Prep Status', value: (t) => stageLabel(t.prepStatus), width: 30 },
  { header: 'Prep SLA Start', value: (t) => formatExportDateTime(t.preparationSla), width: 20 },
  { header: 'Pharmacist', value: (t) => t.pharmacist, width: 26 }
];

function initials(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function PreparationQueuePage() {
  const [tasks, setTasks] = useState<PreparationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [fulfilmentFilter, setFulfilmentFilter] = useState<'all' | 'Pickup' | 'Home Delivery'>('all');
  const [viewMode, setViewMode] = useState<'open' | 'fulfilled'>('open');
  const [prepFilter, setPrepFilter] = useState<PrepCardFilter>('all');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ id: string; message: string } | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const { region } = useRegion();
  const [visitPopup, setVisitPopup] = useState<{ taskId: string; details: PrepVisitDetails } | null>(null);
  const [openingVisitId, setOpeningVisitId] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  // Re-filtered reactively on every region switch — no refetch needed.
  const regionTasks = useMemo(
    () => tasks.filter((task) => recordMatchesRegion(task.bu, region)),
    [tasks, region]
  );

  // "Open Cycles" is the active queue; "Fulfilled" holds cycles that reached
  // Fulfilled — nothing just disappears.
  const openTasks = useMemo(
    () => regionTasks.filter((task) => task.prepStatus !== PREP_STATUS_FULFILLED),
    [regionTasks]
  );
  const fulfilledTasks = useMemo(
    () => regionTasks.filter((task) => task.prepStatus === PREP_STATUS_FULFILLED),
    [regionTasks]
  );
  const visibleTasks = viewMode === 'open' ? openTasks : fulfilledTasks;

  // Stat cards always summarize the open queue, regardless of which tab is active —
  // a pinned dashboard summary rather than a view of the current tab's contents.
  const stats = useMemo(() => {
    let called = 0, recorded = 0, ready = 0;
    openTasks.forEach((task) => {
      const stage = stageOf(task.prepStatus);
      if (stage === 'called') called++;
      else if (stage === 'recorded') recorded++;
      else if (stage === 'ready') ready++;
    });
    return { called, recorded, ready, total: openTasks.length };
  }, [openTasks]);

  // Stat-card filter. Cards summarize the open queue, so picking one also
  // switches back to the Open Cycles tab.
  function pickPrepFilter(next: PrepCardFilter) {
    setPrepFilter((cur) => (cur === next ? 'all' : next));
    setViewMode('open');
  }

  const filteredTasks = useMemo(() => {
    let result = visibleTasks;
    if (viewMode === 'open' && prepFilter !== 'all') {
      result = result.filter((task) => stageOf(task.prepStatus) === prepFilter);
    }
    if (fulfilmentFilter !== 'all') {
      result = result.filter((task) => task.fulfilmentPath === fulfilmentFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((task) =>
        (task.patient ?? '').toLowerCase().includes(q)
        || (task.opdVisit ?? '').toLowerCase().includes(q)
        || (task.pharmacyVisitId ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [visibleTasks, viewMode, prepFilter, fulfilmentFilter, search]);

  // Open Cycles: fixed urgency ordering (not started first, then each later
  // stage; ties broken by how long a cycle has been running) rather than
  // user-selectable column sorting. Fulfilled: most recently fulfilled first.
  // This stays the default/fallback order — clicking a column header (below)
  // overrides it, and clicking a third time clears back to this same order.
  const defaultOrderedTasks = useMemo(() => {
    if (viewMode === 'fulfilled') {
      return [...filteredTasks].sort((a, b) => {
        const aTime = a.modifiedOn ? Date.parse(a.modifiedOn) : 0;
        const bTime = b.modifiedOn ? Date.parse(b.modifiedOn) : 0;
        return bTime - aTime;
      });
    }
    return [...filteredTasks].sort((a, b) => {
      const rankDiff = URGENCY_RANK[stageOf(a.prepStatus)] - URGENCY_RANK[stageOf(b.prepStatus)];
      if (rankDiff !== 0) return rankDiff;
      const aStart = a.preparationSla ? Date.parse(a.preparationSla) : Infinity;
      const bStart = b.preparationSla ? Date.parse(b.preparationSla) : Infinity;
      return aStart - bStart;
    });
  }, [filteredTasks, viewMode]);

  const sortAccessors = useMemo<Record<string, SortAccessor<PreparationTask>>>(() => ({
    pharmacyVisitId: (t) => t.pharmacyVisitId,
    patient: (t) => t.patient,
    opdVisit: (t) => t.opdVisit,
    bu: (t) => t.bu,
    fulfilmentPath: (t) => t.fulfilmentPath,
    prepStatus: (t) => URGENCY_RANK[stageOf(t.prepStatus)],
    prepSla: (t) => (t.preparationSla ? Date.parse(t.preparationSla) : null),
    pharmacist: (t) => t.pharmacist
  }), []);
  const { sorted: sortedTasks, sortKey, sortDir, toggleSort } = useSort(defaultOrderedTasks, sortAccessors);

  const currentTabTotal = viewMode === 'open' ? openTasks.length : fulfilledTasks.length;

  // Keyed off the task's current state alone — not "did we observe it flip to
  // Yes mid-poll" — so a cycle that already has willDispense = Yes the moment
  // this page (or the very first poll after mount) sees it still gets its SLA
  // clock started, instead of silently sitting un-timed forever.
  const shouldStartTask = (task: PreparationTask) => {
    if (!task.willDispense) return false;
    if (task.preparationSla) return false;
    const stage = stageOf(task.prepStatus);
    if (stage === 'ready' || stage === 'fulfilled') return false;
    return true;
  };

  const ensureSlaStartTimes = async (latestTasks: PreparationTask[]): Promise<boolean> => {
    const tasksToStart = latestTasks.filter(shouldStartTask);

    if (tasksToStart.length === 0) return false;

    for (const task of tasksToStart) {
      try {
        await setPreparationStartTime(task.id);
      } catch {
        // ignore individual failures, continue with other tasks
      }
    }

    return true;
  };

  async function refresh() {
    const data = await getAllPreparationTasks();
    setTasks(data);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const data = await getAllPreparationTasks();
        if (cancelled) return;
        setTasks(data);

        // Don't wait for the first live-refresh change to start the SLA clock on cycles that already have willDispense = Yes right now.
        const started = await ensureSlaStartTimes(data);
        if (cancelled) return;
        if (started) {
          const refreshed = await getAllPreparationTasks();
          if (cancelled) return;
          setTasks(refreshed);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load preparation tasks');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // The SLA clock shows whole minutes at its finest, so re-rendering the whole
  // table every second bought nothing — every 15s keeps it accurate to the minute.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(interval);
  }, []);

  // Live updates: instead of re-downloading the full queue on a fixed timer,
  // only reload when chp_omnitasks actually changed (see useLiveRefresh).
  useLiveRefresh(['chp_omnitasks'], async () => {
    const latest = await getAllPreparationTasks();
    const started = await ensureSlaStartTimes(latest);
    setTasks(started ? await getAllPreparationTasks() : latest);
  }, { paused: savingId !== null });

  // Moves a cycle to another preparation stage. Marking it Called starts the
  // Prep SLA clock if it hasn't started yet. Throws so the popup can show the
  // error in place; the table's own buttons catch it below.
  async function changeStage(taskId: string, status: string): Promise<void> {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;

    const previousTasks = tasks.map((t) => ({ ...t }));
    setTasks((current) => current.map((t) =>
      t.id === taskId ? { ...t, prepStatus: status, prepStatusLabel: stageLabel(status) } : t
    ));

    try {
      if (status === PREP_STATUS_CALLED && !task.preparationSla) {
        await setPreparationStartTime(taskId);
      }
      await updatePreparationStatus(taskId, status, false);
    } catch (err) {
      setTasks(previousTasks);
      throw err;
    }
  }

  async function advanceFromTable(task: PreparationTask, status: string) {
    setSavingId(task.id);
    setSaveError(null);
    try {
      await changeStage(task.id, status);
    } catch (err) {
      setSaveError({ id: task.id, message: err instanceof Error ? err.message : 'Failed to update stage' });
    } finally {
      setSavingId(null);
    }
  }

  // The popup is opened from the Pharmacy Visit ID (or the patient name) and is
  // only shown once the patient behind that visit could actually be loaded.
  async function openVisitPopup(task: PreparationTask) {
    if (!task.pharmacyVisitId) return;
    setOpeningVisitId(task.id);
    try {
      const details = await loadPrepVisitDetails(task.pharmacyVisitId);
      setVisitPopup({ taskId: task.id, details });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load patient information', 'error');
    } finally {
      setOpeningVisitId(null);
    }
  }

  const popupTask = visitPopup ? tasks.find((t) => t.id === visitPopup.taskId) ?? null : null;

  // 4-segment pipeline under the stage label: one segment per preparation step
  // reached. The step currently being worked on keeps the stage's own color.
  function renderStatusCell(task: PreparationTask) {
    const stage = stageOf(task.prepStatus);
    const filled = stageIndex(stage);

    return (
      <td>
        <div className={`pipeline status-${stage}`}>
          <span className="stage-label">{stageLabel(task.prepStatus)}</span>
          <div className="track">
            {[0, 1, 2, 3].map((i) => {
              let segClass = 'seg';
              if (i < filled) {
                segClass += i === filled - 1 && stage !== 'fulfilled' ? ' current' : ' done';
              }
              return <div key={i} className={segClass} />;
            })}
          </div>
        </div>
      </td>
    );
  }

  // Live elapsed-time-up timer: starts counting once the cycle's SLA start is
  // set, ticks every 15s off the shared `now` clock while in progress, then
  // freezes once the medications are ready. There's no dedicated "became ready
  // at" field in Dataverse, so modifiedOn is used as that freeze point
  // (assumption: nothing else touches the record between the status flip and
  // the next poll) — flagged here since it's not a real "ready at" timestamp field.
  function renderSlaCell(task: PreparationTask) {
    const stage = stageOf(task.prepStatus);

    if (!task.preparationSla) {
      return <span className="sla none">—</span>;
    }

    const start = Date.parse(task.preparationSla);
    if (Number.isNaN(start)) return <span className="sla none">—</span>;

    if (stage === 'ready' || stage === 'fulfilled') {
      const modifiedAt = task.modifiedOn ? Date.parse(task.modifiedOn) : NaN;
      const end = !Number.isNaN(modifiedAt) && modifiedAt > start ? modifiedAt : start;
      return (
        <span className="sla stopped">
          <FontAwesomeIcon icon={faClock} aria-hidden="true" />
          {formatElapsed(end - start)}
        </span>
      );
    }

    return (
      <span className="sla running">
        <FontAwesomeIcon icon={faClock} aria-hidden="true" />
        {formatElapsed(Math.max(0, now - start))}
      </span>
    );
  }

  function renderActionCell(task: PreparationTask) {
    const isSaving = savingId === task.id;
    const rowError = saveError?.id === task.id ? saveError.message : null;
    const stage = stageOf(task.prepStatus);
    const next = nextStage(task.prepStatus, task.fulfilmentPath);

    let button: ReactNode;
    if (stage === 'fulfilled' || !next) {
      button = (
        <span className="fulfilled-pill">
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" /> Fulfilled
        </span>
      );
    } else if (stage === 'called') {
      // Medication Recorded is reached by saving the medications in the popup.
      button = (
        <button type="button" className="btn btn-primary btn-sm" disabled={!task.pharmacyVisitId || openingVisitId === task.id} onClick={() => openVisitPopup(task)}>
          <FontAwesomeIcon icon={faPills} aria-hidden="true" /> {openingVisitId === task.id ? 'Opening…' : 'Record Medication'}
        </button>
      );
    } else {
      const icon = stage === 'none' ? faPhone : stage === 'recorded' ? faTruckFast : faFlagCheckered;
      const style = stage === 'ready' ? 'btn-outline' : stage === 'recorded' ? 'btn-success' : 'btn-primary';
      button = (
        <button type="button" className={`btn ${style} btn-sm`} disabled={isSaving} onClick={() => advanceFromTable(task, next.status)}>
          {isSaving ? 'Saving…' : (<><FontAwesomeIcon icon={icon} aria-hidden="true" /> {next.label}</>)}
        </button>
      );
    }

    return (
      <td className="actions-cell" style={{ textAlign: 'right' }}>
        {button}
        {rowError && !isSaving && <span className="status-error-cell">{rowError}</span>}
      </td>
    );
  }

  return (
    <div className="app-shell preparation-queue-page">
      {toast && <Toast message={toast.message} tone={toast.tone} />}
      {visitPopup && popupTask && (
        <PrepVisitModal
          task={popupTask}
          details={visitPopup.details}
          onClose={() => setVisitPopup(null)}
          onNotesSaved={(notes) => setTasks((current) => current.map((t) => (t.id === popupTask.id ? { ...t, notes } : t)))}
          onStageChange={(status) => changeStage(popupTask.id, status)}
        />
      )}
      <div className="page-header page-panel">
        <div className="page-header-row">
          <div className="page-title-grp">
            <div className="cis-page"><FontAwesomeIcon icon={faClipboardList} aria-hidden="true" /></div>
            <div>
              <h1 className="page-title">Prep Queue</h1>
              <div className="page-sub">Chronic Pharmacy — active dispensing cycles</div>
            </div>
          </div>
          <div className="segmented-toggle">
            <button type="button" className={`segmented-toggle-btn ${viewMode === 'open' ? 'active' : ''}`} onClick={() => setViewMode('open')}>Open Cycles</button>
            <button type="button" className={`segmented-toggle-btn ${viewMode === 'fulfilled' ? 'active' : ''}`} onClick={() => setViewMode('fulfilled')}>Fulfilled</button>
          </div>
          <div className="toolbar-summary">
            <ExportExcelButton
              fileName={viewMode === 'fulfilled' ? 'prep-queue-fulfilled' : 'prep-queue-open'}
              sheetName={viewMode === 'fulfilled' ? 'Prep Queue - Fulfilled' : 'Prep Queue - Open'}
              columns={EXPORT_COLUMNS}
              rows={sortedTasks}
            />
            <RefreshButton onRefresh={refresh} />
          </div>
        </div>
      </div>

      <div className="stat-row">
        {/* Each card filters the open queue by its stage; clicking the active card clears it. */}
        <button type="button" className={`stat-card stat-card-btn sc-alert${prepFilter === 'called' ? ' is-active' : ''}`} aria-pressed={prepFilter === 'called'} onClick={() => pickPrepFilter('called')}>
          <div className="stat-lbl">Called</div>
          <div className="stat-val">{stats.called}</div>
          <div className="stat-meta">Medications not recorded yet</div>
        </button>
        <button type="button" className={`stat-card stat-card-btn sc-gold${prepFilter === 'recorded' ? ' is-active' : ''}`} aria-pressed={prepFilter === 'recorded'} onClick={() => pickPrepFilter('recorded')}>
          <div className="stat-lbl">Medication Recorded</div>
          <div className="stat-val">{stats.recorded}</div>
          <div className="stat-meta">Being prepared</div>
        </button>
        <button type="button" className={`stat-card stat-card-btn sc-green${prepFilter === 'ready' ? ' is-active' : ''}`} aria-pressed={prepFilter === 'ready'} onClick={() => pickPrepFilter('ready')}>
          <div className="stat-lbl">Ready</div>
          <div className="stat-val">{stats.ready}</div>
          <div className="stat-meta">Pickup + delivery</div>
        </button>
        <button type="button" className={`stat-card stat-card-btn sc-dim${prepFilter === 'all' && viewMode === 'open' ? ' is-active' : ''}`} aria-pressed={prepFilter === 'all' && viewMode === 'open'} onClick={() => pickPrepFilter('all')}>
          <div className="stat-lbl">Total Open Cycles</div>
          <div className="stat-val">{stats.total}</div>
          <div className="stat-meta">Across all BUs</div>
        </button>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
          <input
            type="text"
            placeholder="Search patient, OPD visit, or pharmacy visit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="segmented-toggle">
          <button type="button" className={`segmented-toggle-btn ${fulfilmentFilter === 'all' ? 'active' : ''}`} onClick={() => setFulfilmentFilter('all')}>All statuses</button>
          <button type="button" className={`segmented-toggle-btn ${fulfilmentFilter === 'Pickup' ? 'active' : ''}`} onClick={() => setFulfilmentFilter('Pickup')}>Pickup</button>
          <button type="button" className={`segmented-toggle-btn ${fulfilmentFilter === 'Home Delivery' ? 'active' : ''}`} onClick={() => setFulfilmentFilter('Home Delivery')}>Home Delivery</button>
        </div>

        <div className="sort-note">
          <FontAwesomeIcon icon={faArrowDownWideShort} aria-hidden="true" />
          {sortKey
            ? `Sorted by ${SORT_COLUMN_LABELS[sortKey] ?? sortKey} (${sortDir === 'asc' ? 'ascending' : 'descending'})`
            : (viewMode === 'fulfilled' ? 'Sorted by most recently fulfilled' : 'Sorted by stage')}
        </div>
      </div>

      <div className="bento flush">
        <div className="table-scroll">
          {loading && <div className="loading-indicator">Loading preparation tasks…</div>}
          {error && <div className="error-state">Error: {error}</div>}

          {!loading && !error && (
            <table>
              <thead>
                <tr>
                  <th></th>
                  <SortableTh label="Pharmacy Visit ID" sortKey="pharmacyVisitId" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Patient" sortKey="patient" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="OPD Visit" sortKey="opdVisit" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="BU" sortKey="bu" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Fulfilment Path" sortKey="fulfilmentPath" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Prep Status" sortKey="prepStatus" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Prep SLA" sortKey="prepSla" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Pharmacist" sortKey="pharmacist" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedTasks.length === 0 && (
                  <tr>
                    <td colSpan={10} className="prep-empty-row">
                      {viewMode === 'fulfilled' ? 'No fulfilled cycles yet.' : 'No cycles match the current filters.'}
                    </td>
                  </tr>
                )}
                {sortedTasks.map((task) => {
                  const stage = stageOf(task.prepStatus);
                  const trackClass = stage === 'none' || stage === 'called' ? 'tb-alert' : stage === 'recorded' ? 'tb-gold' : 'tb-green';
                  const canOpen = !!task.pharmacyVisitId;
                  const opening = openingVisitId === task.id;
                  return (
                    <tr key={task.id} className={stage === 'none' ? 'is-urgent' : undefined}>
                      <td className="track-bar-cell"><div className={`track-bar ${trackClass}`} /></td>
                      <td>
                        {canOpen
                          ? (
                            <button type="button" className="mono-id visit-link" disabled={opening} onClick={() => openVisitPopup(task)}>
                              {opening ? 'Loading…' : task.pharmacyVisitId}
                            </button>
                          )
                          : <span className="mono-id">—</span>}
                      </td>
                      <td>
                        <div className="patient-cell">
                          <div className="avatar">{initials(task.patient)}</div>
                          {canOpen
                            ? <button type="button" className="patient-name visit-link plain" disabled={opening} onClick={() => openVisitPopup(task)}>{task.patient ?? '—'}</button>
                            : <span className="patient-name">{task.patient ?? '—'}</span>}
                        </div>
                      </td>
                      <td><span className="mono-id">{task.opdVisit ?? '—'}</span></td>
                      <td>{task.bu ? <span className="bu-tag">{task.bu}</span> : '—'}</td>
                      <td>
                        <span className="path-cell">
                          <FontAwesomeIcon icon={task.fulfilmentPath === 'Home Delivery' ? faHouse : faBox} aria-hidden="true" />
                          {task.fulfilmentPath ?? '—'}
                        </span>
                      </td>
                      {renderStatusCell(task)}
                      <td>{renderSlaCell(task)}</td>
                      <td>
                        <div className="pharm-cell">
                          <div className="pharm-av">{initials(task.pharmacist)}</div>
                          <span className="pharm-name">{task.pharmacist ?? '—'}</span>
                        </div>
                      </td>
                      {renderActionCell(task)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!loading && !error && (
          <div className="table-foot">
            <div className="legend">
              <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--warning)' }} /> Not started / Called</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--brand-gold)' }} /> Medication recorded</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--green-dark)' }} /> Ready / Fulfilled</span>
            </div>
            <div className="foot-count">{sortedTasks.length} of {currentTabTotal} cycles shown</div>
          </div>
        )}
      </div>
    </div>
  );
}
