import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faClipboardList, faMagnifyingGlass, faArrowDownWideShort, faCircleCheck,
  faPlay, faCheck, faFlagCheckered, faBox, faHouse, faClock
} from '@fortawesome/free-solid-svg-icons';
import { getAllPreparationTasks, updatePreparationStatus, setPreparationStartTime, markTaskFulfilled, type PreparationTask } from '../../api/preparationApi';
import { RefreshButton } from '../ui/RefreshButton';
import { useSort, type SortAccessor } from '../../hooks/useSort';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { SortableTh } from '../ui/SortableTh';
import { useRegion } from '../../context/RegionContext';
import { recordMatchesRegion } from '../../api/businessUnitsApi';
import '../patients/PatientsPage.css';
import './PreparationQueuePage.css';

const PREP_STATUS_PENDING = '766990000';
const PREP_STATUS_UNDER_PREP = '766990001';
const PREP_STATUS_READY_PICKUP = '766990002';
const PREP_STATUS_READY_DELIVERY = '766990003';
const TASK_STATUS_COMPLETED = '766990002';

const PREP_STATUS_LABELS: Record<string, string> = {
  [PREP_STATUS_PENDING]: 'Confirmed – Pending Preparation',
  [PREP_STATUS_UNDER_PREP]: 'Under Preparation',
  [PREP_STATUS_READY_PICKUP]: 'Ready for Pickup',
  [PREP_STATUS_READY_DELIVERY]: 'Ready for Delivery'
};

const URGENCY_RANK: Record<string, number> = {
  [PREP_STATUS_PENDING]: 0,
  [PREP_STATUS_UNDER_PREP]: 1,
  [PREP_STATUS_READY_PICKUP]: 2,
  [PREP_STATUS_READY_DELIVERY]: 2
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
  cycleId: 'Cycle ID',
  patient: 'Patient',
  opdVisit: 'OPD Visit',
  bu: 'BU',
  fulfilmentPath: 'Fulfilment Path',
  prepStatus: 'Prep Status',
  prepSla: 'Prep SLA',
  pharmacist: 'Pharmacist'
};

type PrepCardFilter = 'all' | 'needs' | 'under' | 'ready';

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

  // Re-filtered reactively on every region switch — no refetch needed.
  const regionTasks = useMemo(
    () => tasks.filter((task) => recordMatchesRegion(task.bu, region)),
    [tasks, region]
  );

  // "Open Cycles" is the active queue; "Fulfilled" is where a cycle goes once its
  // Action button is clicked through to completion — nothing just disappears.
  // (Not part of ref.html's mockup, kept from an earlier explicit request so
  // fulfilled cycles stay reachable instead of vanishing with no trace.)
  const openTasks = useMemo(
    // chp_willdispense is a formula column (Task Status = Completed), so every
    // Will Dispense = Yes task is already Completed — no extra status check here.
    () => regionTasks.filter((task) => task.willDispense === true),
    [regionTasks]
  );
  const fulfilledTasks = useMemo(
    () => regionTasks.filter((task) => task.willDispense === true && task.taskStatus === TASK_STATUS_COMPLETED),
    [regionTasks]
  );
  const visibleTasks = viewMode === 'open' ? openTasks : fulfilledTasks;

  // Stat cards always summarize the open queue, regardless of which tab is active —
  // a pinned dashboard summary rather than a view of the current tab's contents.
  const stats = useMemo(() => {
    let needsAction = 0, underPrep = 0, ready = 0;
    openTasks.forEach((task) => {
      if (task.prepStatus === PREP_STATUS_PENDING) needsAction++;
      else if (task.prepStatus === PREP_STATUS_UNDER_PREP) underPrep++;
      else if (task.prepStatus === PREP_STATUS_READY_PICKUP || task.prepStatus === PREP_STATUS_READY_DELIVERY) ready++;
    });
    return { needsAction, underPrep, ready, total: openTasks.length };
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
      result = result.filter((task) =>
        prepFilter === 'needs' ? task.prepStatus === PREP_STATUS_PENDING
          : prepFilter === 'under' ? task.prepStatus === PREP_STATUS_UNDER_PREP
            : task.prepStatus === PREP_STATUS_READY_PICKUP || task.prepStatus === PREP_STATUS_READY_DELIVERY
      );
    }
    if (fulfilmentFilter !== 'all') {
      result = result.filter((task) => task.fulfilmentPath === fulfilmentFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((task) =>
        (task.patient ?? '').toLowerCase().includes(q)
        || (task.opdVisit ?? '').toLowerCase().includes(q)
        || (task.chpId ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [visibleTasks, viewMode, prepFilter, fulfilmentFilter, search]);

  // Open Cycles: fixed urgency ordering (needs action first, then under prep, then
  // ready; ties broken by how long a cycle has sat in its current stage) rather than
  // user-selectable column sorting. Fulfilled: most recently closed out first.
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
      const rankDiff = (URGENCY_RANK[a.prepStatus ?? ''] ?? 3) - (URGENCY_RANK[b.prepStatus ?? ''] ?? 3);
      if (rankDiff !== 0) return rankDiff;
      const aStart = a.preparationSla ? Date.parse(a.preparationSla) : Infinity;
      const bStart = b.preparationSla ? Date.parse(b.preparationSla) : Infinity;
      return aStart - bStart;
    });
  }, [filteredTasks, viewMode]);

  const sortAccessors = useMemo<Record<string, SortAccessor<PreparationTask>>>(() => ({
    cycleId: (t) => t.chpId,
    patient: (t) => t.patient,
    opdVisit: (t) => t.opdVisit,
    bu: (t) => t.bu,
    fulfilmentPath: (t) => t.fulfilmentPath,
    prepStatus: (t) => URGENCY_RANK[t.prepStatus ?? ''] ?? 3,
    prepSla: (t) => (t.preparationSla ? Date.parse(t.preparationSla) : null),
    pharmacist: (t) => t.pharmacist
  }), []);
  const { sorted: sortedTasks, sortKey, sortDir, toggleSort } = useSort(defaultOrderedTasks, sortAccessors);

  const currentTabTotal = viewMode === 'open' ? openTasks.length : fulfilledTasks.length;

  const statusStage = (status: string | null): 'pending' | 'underprep' | 'ready' | 'other' => {
    if (status === PREP_STATUS_PENDING) return 'pending';
    if (status === PREP_STATUS_UNDER_PREP) return 'underprep';
    if (status === PREP_STATUS_READY_PICKUP || status === PREP_STATUS_READY_DELIVERY) return 'ready';
    return 'other';
  };

  const stageProgress = (stage: ReturnType<typeof statusStage>) => {
    if (stage === 'pending') return 1;
    if (stage === 'underprep') return 2;
    if (stage === 'ready') return 4;
    return 0;
  };

  // Keyed off the task's current state alone — not "did we observe it flip to
  // Yes mid-poll" — so a cycle that already has willDispense = Yes the moment
  // this page (or the very first poll after mount) sees it still gets its SLA
  // clock started, instead of silently sitting un-timed forever.
  const shouldStartTask = (task: PreparationTask) => {
    if (!task.willDispense) return false;
    if (task.preparationSla) return false;
    if (statusStage(task.prepStatus) === 'ready') return false;
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

  async function saveStatus(taskId: string, value: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;

    setSavingId(taskId);
    setSaveError(null);

    const previousTasks = tasks.map((t) => ({ ...t }));
    setTasks((current) => current.map((t) =>
      t.id === taskId ? { ...t, prepStatus: value, prepStatusLabel: PREP_STATUS_LABELS[value] ?? null } : t
    ));

    const isCompletion = value === PREP_STATUS_READY_PICKUP || value === PREP_STATUS_READY_DELIVERY;
    const shouldSetStartTime = task.willDispense === true && !task.preparationSla && !isCompletion;

    try {
      if (shouldSetStartTime) {
        await setPreparationStartTime(taskId);
      }
      await updatePreparationStatus(taskId, value, false);
    } catch (err) {
      setTasks(previousTasks);
      setSaveError({ id: taskId, message: err instanceof Error ? err.message : 'Failed to save status' });
    } finally {
      setSavingId(null);
    }
  }

  async function handleFulfil(taskId: string) {
    setSavingId(taskId);
    setSaveError(null);

    const previousTasks = tasks.map((t) => ({ ...t }));
    setTasks((current) => current.map((t) =>
      t.id === taskId ? { ...t, taskStatus: TASK_STATUS_COMPLETED, taskStatusLabel: 'Completed' } : t
    ));

    try {
      await markTaskFulfilled(taskId);
    } catch (err) {
      setTasks(previousTasks);
      setSaveError({ id: taskId, message: err instanceof Error ? err.message : 'Failed to fulfil cycle' });
    } finally {
      setSavingId(null);
    }
  }

  // ref.html's "pipeline" stepper: stage label stacked above a 4-segment track.
  // Segments already passed = done (green); the segment currently being worked
  // through = the stage's own color (red for pending, gold for under prep);
  // segments not reached yet stay empty. Ready (Pickup or Delivery — identical
  // by design) fills all 4 as done.
  function renderStatusCell(task: PreparationTask) {
    const stage = statusStage(task.prepStatus);
    const label = task.prepStatusLabel ?? PREP_STATUS_LABELS[task.prepStatus ?? ''] ?? task.prepStatus ?? '—';
    const filled = stageProgress(stage);
    const currentSegClass = stage === 'pending' ? 'current alert-seg' : stage === 'underprep' ? 'current gold-seg' : '';

    return (
      <td>
        <div className={`pipeline status-${stage}`}>
          <span className="stage-label">{label}</span>
          <div className="track">
            {[0, 1, 2, 3].map((i) => {
              let segClass = 'seg';
              if (i < filled) {
                segClass += i === filled - 1 && stage !== 'ready' ? ` ${currentSegClass}` : ' done';
              }
              return <div key={i} className={segClass} />;
            })}
          </div>
        </div>
      </td>
    );
  }

  // Live elapsed-time-up timer: starts counting the moment willDispense = Yes
  // (task.preparationSla gets set), ticks every 15s off the shared `now`
  // clock while pending/under prep, then freezes at Ready. There's no
  // dedicated "became ready at" field in Dataverse, so modifiedOn is used as
  // that freeze point (assumption: nothing else touches the record between
  // the status flip and the next poll) — flagged here since it's not a real
  // "ready at" timestamp field.
  function renderSlaCell(task: PreparationTask) {
    const stage = statusStage(task.prepStatus);

    if (!task.preparationSla) {
      return <span className="sla none">—</span>;
    }

    const start = Date.parse(task.preparationSla);
    if (Number.isNaN(start)) return <span className="sla none">—</span>;

    if (stage === 'ready') {
      const modifiedAt = task.modifiedOn ? Date.parse(task.modifiedOn) : NaN;
      const end = !Number.isNaN(modifiedAt) && modifiedAt > start ? modifiedAt : start;
      return (
        <span className="sla stopped">
          <FontAwesomeIcon icon={faClock} aria-hidden="true" />
          {formatElapsed(end - start)}
        </span>
      );
    }

    if (stage === 'pending' || stage === 'underprep') {
      return (
        <span className="sla running">
          <FontAwesomeIcon icon={faClock} aria-hidden="true" />
          {formatElapsed(Math.max(0, now - start))}
        </span>
      );
    }

    return <span className="sla none">—</span>;
  }

  function renderActionCell(task: PreparationTask) {
    const isSaving = savingId === task.id;
    const rowError = saveError?.id === task.id ? saveError.message : null;
    const stage = statusStage(task.prepStatus);

    let button: ReactNode;
    if (task.taskStatus === TASK_STATUS_COMPLETED) {
      button = (
        <span className="fulfilled-pill">
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" /> Fulfilled
        </span>
      );
    } else if (stage === 'pending') {
      button = (
        <button type="button" className="btn btn-primary btn-sm" disabled={isSaving} onClick={() => saveStatus(task.id, PREP_STATUS_UNDER_PREP)}>
          {isSaving ? 'Starting…' : (<><FontAwesomeIcon icon={faPlay} aria-hidden="true" /> Start Preparation</>)}
        </button>
      );
    } else if (stage === 'underprep') {
      const target = task.fulfilmentPath === 'Home Delivery' ? PREP_STATUS_READY_DELIVERY : PREP_STATUS_READY_PICKUP;
      button = (
        <button type="button" className="btn btn-success btn-sm" disabled={isSaving} onClick={() => saveStatus(task.id, target)}>
          {isSaving ? 'Marking ready…' : (<><FontAwesomeIcon icon={faCheck} aria-hidden="true" /> Mark Ready</>)}
        </button>
      );
    } else {
      button = (
        <button type="button" className="btn btn-outline btn-sm" disabled={isSaving} onClick={() => handleFulfil(task.id)}>
          {isSaving ? 'Fulfilling…' : (<><FontAwesomeIcon icon={faFlagCheckered} aria-hidden="true" /> Fulfil</>)}
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
            <RefreshButton onRefresh={refresh} />
          </div>
        </div>
      </div>

      <div className="stat-row">
        {/* Each card filters the open queue by its stage; clicking the active card clears it. */}
        <button type="button" className={`stat-card stat-card-btn sc-alert${prepFilter === 'needs' ? ' is-active' : ''}`} aria-pressed={prepFilter === 'needs'} onClick={() => pickPrepFilter('needs')}>
          <div className="stat-lbl">Needs Action &lt; 1h</div>
          <div className="stat-val">{stats.needsAction}</div>
          <div className="stat-meta">Confirmed, not started</div>
        </button>
        <button type="button" className={`stat-card stat-card-btn sc-gold${prepFilter === 'under' ? ' is-active' : ''}`} aria-pressed={prepFilter === 'under'} onClick={() => pickPrepFilter('under')}>
          <div className="stat-lbl">Under Preparation</div>
          <div className="stat-val">{stats.underPrep}</div>
          <div className="stat-meta">In progress</div>
        </button>
        <button type="button" className={`stat-card stat-card-btn sc-green${prepFilter === 'ready' ? ' is-active' : ''}`} aria-pressed={prepFilter === 'ready'} onClick={() => pickPrepFilter('ready')}>
          <div className="stat-lbl">Ready for Handoff</div>
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
            placeholder="Search patient, OPD visit, or cycle…"
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
            : (viewMode === 'fulfilled' ? 'Sorted by most recently fulfilled' : 'Sorted by urgency')}
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
                  <SortableTh label="Cycle ID" sortKey="cycleId" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
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
                  const stage = statusStage(task.prepStatus);
                  const trackClass = stage === 'pending' ? 'tb-alert' : stage === 'underprep' ? 'tb-gold' : 'tb-green';
                  return (
                    <tr key={task.id} className={stage === 'pending' ? 'is-urgent' : undefined}>
                      <td className="track-bar-cell"><div className={`track-bar ${trackClass}`} /></td>
                      <td><span className="mono-id">{task.chpId ?? '—'}</span></td>
                      <td>
                        <div className="patient-cell">
                          <div className="avatar">{initials(task.patient)}</div>
                          <span className="patient-name">{task.patient ?? '—'}</span>
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
              <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--warning)' }} /> Pending preparation</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--brand-gold)' }} /> Under preparation</span>
              <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--green-dark)' }} /> Ready for handoff</span>
            </div>
            <div className="foot-count">{sortedTasks.length} of {currentTabTotal} cycles shown</div>
          </div>
        )}
      </div>
    </div>
  );
}
