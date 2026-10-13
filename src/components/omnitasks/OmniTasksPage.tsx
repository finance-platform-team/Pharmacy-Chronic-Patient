import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHeadset, faMagnifyingGlass, faHouse, faBox } from '@fortawesome/free-solid-svg-icons';
import { getAllOmniTasks, type OmniTaskRow, type OmniTaskStatus } from '../../api/omniTasksApi';
import { recordMatchesRegion, getRegionBusinessUnits, type LookupOption } from '../../api/businessUnitsApi';
import { useRegion } from '../../context/RegionContext';
import { RefreshButton } from '../ui/RefreshButton';
import { LookupInput } from '../ui/LookupInput';
import { Pagination } from '../ui/Pagination';
import { usePagination, paginateItems } from '../../hooks/usePagination';
import { useSort, type SortAccessor } from '../../hooks/useSort';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { SortableTh } from '../ui/SortableTh';
import { SegmentedFilter, type FilterTone } from '../ui/SegmentedFilter';
import '../patients/PatientsPage.css';
import './OmniTasksPage.css';

// Used only for the read-only table pills and the toolbar filter (display
// states). The toolbar filter drops "Not Reached – Escalated" per explicit
// request.
const FILTER_STATUS_OPTIONS: OmniTaskStatus[] = ['Sent', 'Completed', 'Not Reached – Retry Pending'];

// Short labels for the status filter / table pills — the full names are long
// enough to push the toolbar onto two lines.
const STATUS_LABELS: Record<OmniTaskStatus, string> = {
  Sent: 'Awaiting CRM',
  Completed: 'Completed',
  'Not Reached – Retry Pending': 'Retry Pending',
  'Not Reached – Escalated': 'Escalated',
  Unknown: 'Unknown'
};

function statusTone(status: OmniTaskStatus): FilterTone {
  if (status === 'Completed') return 'success';
  if (status === 'Sent') return 'info';
  if (status === 'Not Reached – Retry Pending') return 'warning';
  if (status === 'Not Reached – Escalated') return 'danger';
  return 'neutral';
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** "2/3" → { used: 2, max: 3 }; anything else (blank, a bare number) → null. */
function parseAttempts(value: string | null): { used: number; max: number } | null {
  const match = value?.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!match) return null;
  const used = Number(match[1]);
  const max = Number(match[2]);
  return max > 0 && max <= 10 ? { used: Math.min(used, max), max } : null;
}

function formatDispatched(value: string | null): string {
  if (!value) return '—';
  const [year, month, day] = value.split('T')[0].split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function OmniTasksPage() {
  const [tasks, setTasks] = useState<OmniTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OmniTaskStatus>('all');
  const { region } = useRegion();

  const [businessUnits, setBusinessUnits] = useState<LookupOption[]>([]);
  const [buFilter, setBuFilter] = useState('');

  useEffect(() => {
    getRegionBusinessUnits(region)
      .then((units) => {
        setBusinessUnits(units);
        setBuFilter((cur) => (cur && !units.some((u) => u.name === cur || u.id === cur) ? '' : cur));
      })
      .catch((err) => console.error('Failed to load business units:', err));
  }, [region]);

  async function refresh() {
    const data = await getAllOmniTasks();
    setTasks(data);
    setError(null);
  }

  // Picks up CRM responses (via the Power Automate flow) and other users'
  // edits as they land, without waiting for a manual Refresh.
  useLiveRefresh(['chp_omnitasks'], refresh);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getAllOmniTasks()
      .then((data) => { if (!cancelled) setTasks(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load Omni tasks'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  // Re-filtered reactively on every region switch — no refetch needed.
  const regionTasks = useMemo(
    () => tasks.filter((t) => recordMatchesRegion(t.bu, region)),
    [tasks, region]
  );

  // BU + search narrow the list first; the status counts are taken from that
  // so each status button shows how many it would leave on screen.
  const scopedTasks = useMemo(() => {
    let result = regionTasks;
    if (buFilter) {
      result = result.filter((t) => t.bu === buFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((t) =>
        (t.patient ?? '').toLowerCase().includes(q)
        || (t.patientMobile ?? '').toLowerCase().includes(q)
        || (t.cycleId ?? '').toLowerCase().includes(q)
        || (t.pharmacist ?? '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [regionTasks, buFilter, search]);

  const statusCounts = useMemo(() => {
    const counts = new Map<OmniTaskStatus, number>();
    scopedTasks.forEach((t) => counts.set(t.status, (counts.get(t.status) ?? 0) + 1));
    return counts;
  }, [scopedTasks]);

  const filteredTasks = useMemo(
    () => (statusFilter === 'all' ? scopedTasks : scopedTasks.filter((t) => t.status === statusFilter)),
    [scopedTasks, statusFilter]
  );

  const sortAccessors = useMemo<Record<string, SortAccessor<OmniTaskRow>>>(() => ({
    cycleId: (t) => t.cycleId,
    patient: (t) => t.patient,
    bu: (t) => t.bu,
    dispatched: (t) => (t.dispatched ? Date.parse(t.dispatched) : null),
    attempts: (t) => t.attempts,
    status: (t) => t.status,
    pharmacist: (t) => t.pharmacist,
    fulfilmentPath: (t) => t.fulfilmentPath,
    willDispense: (t) => (t.willDispense ? 1 : 0)
  }), []);
  const { sorted: sortedTasks, sortKey, sortDir, toggleSort } = useSort(filteredTasks, sortAccessors);

  const { page, pageSize, totalPages, setPage, setPageSize, resetPage } = usePagination(sortedTasks.length, 25);
  const pageTasks = useMemo(() => paginateItems(sortedTasks, page, pageSize), [sortedTasks, page, pageSize]);

  // A filter/search change shrinks or reorders the result set, so go back to
  // page 1 rather than risk an out-of-range page.
  useEffect(() => {
    resetPage();
  }, [statusFilter, buFilter, search, region, resetPage]);

  return (
    <div className="app-shell omni-tasks-page">
      <div className="page-header page-panel">
        <div className="page-header-row">
          <div className="page-title-grp">
            <div className="cis-page"><FontAwesomeIcon icon={faHeadset} aria-hidden="true" /></div>
            <div>
              <h1 className="page-title">Omni Tasks</h1>
              <div className="page-sub">Medical Contact Center — patient outreach &amp; dispositions</div>
            </div>
          </div>
          <div className="toolbar-summary">
            <RefreshButton onRefresh={refresh} />
          </div>
        </div>
      </div>

      <div className="omni-filters">
        <div className="omni-search-box">
          <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
          <input
            type="text"
            placeholder="Search patient, mobile, cycle or pharmacist…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="omni-bu-field">
          <LookupInput
            placeholder="Business Unit"
            initialValue={businessUnits.find((bu) => bu.name === buFilter) ?? null}
            options={businessUnits}
            onSelect={(opt) => setBuFilter(opt?.name ?? '')}
          />
        </div>

        <SegmentedFilter<'all' | OmniTaskStatus>
          label="Status"
          value={statusFilter}
          options={[
            { value: 'all', label: 'All', count: scopedTasks.length },
            ...FILTER_STATUS_OPTIONS.map((s) => ({
              value: s,
              label: STATUS_LABELS[s],
              tone: statusTone(s),
              count: statusCounts.get(s) ?? 0
            }))
          ]}
          onChange={setStatusFilter}
        />
      </div>

      <div className="bento flush">
        <div className="table-scroll">
          {loading && <div className="loading-indicator">Loading Omni tasks…</div>}
          {error && <div className="error-state">Error: {error} <button onClick={() => void refresh()}>Retry</button></div>}

          {!loading && !error && (
            <table className="omni-tasks-grid">
              <thead>
                <tr>
                  <SortableTh label="Pharmacist" sortKey="pharmacist" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Cycle ID" sortKey="cycleId" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Patient" sortKey="patient" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="BU" sortKey="bu" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Dispatched" sortKey="dispatched" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Attempts" sortKey="attempts" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Status" sortKey="status" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Fulfilment Path" sortKey="fulfilmentPath" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="WillDispense" sortKey="willDispense" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {pageTasks.length === 0 && (
                  <tr>
                    <td colSpan={9} className="omni-empty-row">
                      <FontAwesomeIcon icon={faHeadset} aria-hidden="true" />
                      <div>No contact tasks match the current filters.</div>
                    </td>
                  </tr>
                )}
                {pageTasks.map((task) => {
                  const attempts = parseAttempts(task.attempts);
                  return (
                    <tr key={task.id}>
                      <td>
                        {task.pharmacist ? (
                          <div className="omni-agent">
                            <span className="omni-agent-avatar">{initials(task.pharmacist)}</span>
                            <span className="omni-agent-name">{task.pharmacist}</span>
                          </div>
                        ) : (
                          <span className="omni-dim omni-unassigned">Unassigned</span>
                        )}
                      </td>
                      <td>
                        <span className="omni-cycle-id" title={task.cycleId ?? undefined}>
                          {task.cycleId ? task.cycleId.slice(0, 8) : '—'}
                        </span>
                      </td>
                      <td>
                        <div className="omni-patient">
                          <span className={`omni-avatar${task.patient ? '' : ' is-empty'}`}>{initials(task.patient)}</span>
                          <div className="omni-patient-text">
                            <span className={`omni-patient-name${task.patient ? '' : ' is-empty'}`}>{task.patient ?? 'Unknown patient'}</span>
                            <span className="omni-patient-mobile">{task.patientMobile ?? 'No mobile on file'}</span>
                          </div>
                        </div>
                      </td>
                      <td>{task.bu ? <span className="bu-tag">{task.bu}</span> : <span className="omni-dim">—</span>}</td>
                      <td className="omni-date">{formatDispatched(task.dispatched)}</td>
                      <td>
                        {attempts ? (
                          <div className="omni-attempts" title={`${attempts.used} of ${attempts.max} attempts used`}>
                            <span className="omni-pips">
                              {Array.from({ length: attempts.max }, (_, i) => (
                                <span key={i} className={`omni-pip${i < attempts.used ? ' is-used' : ''}`} />
                              ))}
                            </span>
                            <span className="omni-attempts-text">{attempts.used}/{attempts.max}</span>
                          </div>
                        ) : (
                          <span className={task.attempts ? 'omni-attempts-text' : 'omni-dim'}>{task.attempts ?? '—'}</span>
                        )}
                      </td>
                      <td>
                        <span className={`omni-status tone-${statusTone(task.status)}`}>
                          <span className="omni-status-dot" aria-hidden="true" />
                          {STATUS_LABELS[task.status]}
                        </span>
                      </td>
                      <td>
                        {task.fulfilmentPath ? (
                          <span className="omni-path">
                            <FontAwesomeIcon icon={task.fulfilmentPath === 'Home Delivery' ? faHouse : faBox} aria-hidden="true" />
                            {task.fulfilmentPath}
                          </span>
                        ) : <span className="omni-dim">—</span>}
                      </td>
                      <td>
                        <span className={`omni-yn${task.willDispense ? ' is-yes' : ''}`}>{task.willDispense ? 'Yes' : 'No'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {!loading && !error && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filteredTasks.length}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="tasks"
          />
        )}
      </div>

    </div>
  );
}
