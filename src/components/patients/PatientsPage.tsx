import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUsers, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { usePatients } from '../../hooks/usePatients';
import { usePagination, paginateItems } from '../../hooks/usePagination';
import { useRowSelection } from '../../hooks/useRowSelection';
import { useToast } from '../../hooks/useToast';
import { useSort, type SortAccessor } from '../../hooks/useSort';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { PatientDetailsPanel } from './PatientDetailsPanel';
import { PatientFiltersBar } from './PatientFiltersBar';
import { BulkEditUserModal } from './BulkEditUserModal';
import { LookupInput } from '../ui/LookupInput';
import { IndeterminateCheckbox } from '../ui/IndeterminateCheckbox';
import { Pagination } from '../ui/Pagination';
import { Toast } from '../ui/Toast';
import { RefreshButton } from '../ui/RefreshButton';
import { SortableTh } from '../ui/SortableTh';
import type { Patient } from '../../domain/types';
import { formatDayMonth } from '../../domain/dates';
import { searchUsers } from '../../api/usersApi';
import { updatePatientUser, bulkUpdatePatientUser } from '../../api/patientsApi';
import type { LookupOption } from '../../api/businessUnitsApi';
import { useRegion } from '../../context/RegionContext';
import './PatientsPage.css';
import './RegistryPage.css';


function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMoney(value: number | null): string {
  if (value === null) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Same field/values/classes as DueRefillQueuePage's/PatientDetailsPanel's chronicClass —
// kept as its own local copy per this app's convention rather than a shared helper.
function chronicClass(status: string | null): string {
  if (status === 'Active Chronic') return 'pill-live';
  if (status === 'Inactive Chronic') return 'pill-muted';
  return 'pill-neutral';
}

function initials(name: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function PatientsPage() {
  const { patients, loading, error, filters, setFilters, refresh, reloadSilently, patchPatients } = usePatients();
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [savingUserFor, setSavingUserFor] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  useLiveRefresh(['cr18c_patients'], reloadSilently, { paused: bulkSaving || savingUserFor !== null });
  const { toast, showToast } = useToast();

  const sortAccessors = useMemo<Record<string, SortAccessor<Patient>>>(() => ({
    name: (p) => p.name,
    businessUnit: (p) => p.businessUnitName,
    phone: (p) => p.phoneNumber,
    prescriptions: (p) => p.noOfPrescriptions,
    totalDispensing: (p) => p.totalDispensingValue,
    orderDay: (p) => p.orderDay,
    createdOn: (p) => (p.createdOn ? Date.parse(p.createdOn) : null),
    insurance: (p) => p.insuranceCompany,
    pharmacy: (p) => p.pharmacyName,
    chronicStatus: (p) => p.chronicStatus,
    assignedTo: (p) => p.userName
  }), []);
  // Default order (before any column is explicitly clicked) puts Active
  // Chronic patients first — a stable sort, so it only moves Active Chronic
  // rows up and otherwise keeps everything in its existing order.
  const defaultOrderedPatients = useMemo(() => {
    return [...patients].sort((a, b) => {
      const aActive = a.chronicStatus === 'Active Chronic' ? 0 : 1;
      const bActive = b.chronicStatus === 'Active Chronic' ? 0 : 1;
      return aActive - bActive;
    });
  }, [patients]);

  const { sorted: sortedPatients, sortKey, sortDir, toggleSort } = useSort(defaultOrderedPatients, sortAccessors);

  const { page, pageSize, totalPages, setPage, setPageSize, resetPage } = usePagination(patients.length, 25);
  const pagePatients = useMemo(() => paginateItems(sortedPatients, page, pageSize), [sortedPatients, page, pageSize]);
  const pageIds = useMemo(() => pagePatients.map((p) => p.id), [pagePatients]);
  const selection = useRowSelection(pageIds);

  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const { region } = useRegion();

  // Reset to page 1 and clear any selection whenever the search/filter criteria
  // (or the region, which re-filters the list too) change, since the underlying
  // result set (and therefore what's selectable) has changed.
  useEffect(() => {
    resetPage();
    selection.clear();
  }, [filters, region, resetPage, selection.clear]);

  async function handleAssignUser(patientId: string, option: LookupOption | null) {
    setSavingUserFor(patientId);
    try {
      await updatePatientUser(patientId, option?.id ?? null);
      // Patch just this row instead of refetching the whole (up to 500-row) grid —
      // we already know the resulting value, a full refresh only adds latency.
      patchPatients(new Map([[patientId, { userId: option?.id ?? null, userName: option?.name ?? null }]]));
    } catch (err) {
      console.error('Failed to update assigned user:', err);
    } finally {
      setSavingUserFor(null);
    }
  }

  async function handleBulkSave(option: LookupOption | null) {
    setBulkSaving(true);
    setBulkError(null);

    const targetIds = Array.from(selection.selectedIds);
    const result = await bulkUpdatePatientUser(targetIds, option?.id ?? null);
    setBulkSaving(false);

    if (result.succeededIds.length > 0) {
      const changes = { userId: option?.id ?? null, userName: option?.name ?? null };
      patchPatients(new Map(result.succeededIds.map((id) => [id, changes])));
    }

    if (result.failed.length === 0) {
      setShowBulkEdit(false);
      selection.clear();
      showToast(`Updated ${result.succeededIds.length} record${result.succeededIds.length === 1 ? '' : 's'}`, 'success');
      return;
    }

    // Partial or total failure: the succeeded rows were already patched above, so just
    // keep the modal open and narrow the selection to the failed records so the user
    // can retry without losing their place or re-picking rows from scratch.
    selection.setSelected(result.failed.map((f) => f.id));
    setBulkError(
      result.succeededIds.length > 0
        ? `Updated ${result.succeededIds.length}, but ${result.failed.length} failed. Try again for the remaining record${result.failed.length === 1 ? '' : 's'}.`
        : `Failed to update ${result.failed.length} record${result.failed.length === 1 ? '' : 's'}. ${result.failed[0].message}`
    );
  }

  return (
    <div className="app-shell registry-page">
      <div className="page-header">
        <div className="page-header-row">
          <div className="page-title-grp">
            <div className="cis-page"><FontAwesomeIcon icon={faUsers} aria-hidden="true" /></div>
            <div>
              <h1 className="page-title">Patients</h1>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="filter-input-wrap">
              <FontAwesomeIcon icon={faMagnifyingGlass} className="filter-input-icon" aria-hidden="true" />
              <input
                type="text"
                className="filter-input has-icon"
                placeholder="Filter by keyword"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </div>
            <RefreshButton onRefresh={refresh} />
          </div>
        </div>
      </div>

      <div className="page-toolbar">
        <PatientFiltersBar filters={filters} onChange={setFilters} />
      </div>

      <div className="grid-toolbar" style={{ justifyContent: 'flex-end', alignItems: 'center' }}>
        <span className="records-count">
          <FontAwesomeIcon icon={faUsers} aria-hidden="true" />
          {patients.length} Patient{patients.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="bento flush">
        {selection.count > 0 && (
          <div className="bulk-toolbar">
            <div className="bulk-toolbar-info">
              <span>{selection.count} selected</span>
              <button type="button" className="bulk-toolbar-clear" onClick={selection.clear}>Clear selection</button>
            </div>
            <div className="bulk-toolbar-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { setBulkError(null); setShowBulkEdit(true); }}>
                Bulk Edit User
              </button>
            </div>
          </div>
        )}

        <div className="grid-wrapper">
          {loading && <div className="loading-indicator">Loading patients…</div>}
          {error && <div className="error-state">Error: {error} <button onClick={refresh}>Retry</button></div>}

          {!loading && !error && (
            <table className="patients-grid">
              <thead>
                <tr>
                  <th className="col-select">
                    <IndeterminateCheckbox
                      checked={selection.allOnPageSelected}
                      indeterminate={selection.someOnPageSelected}
                      onChange={selection.toggleAllOnPage}
                      aria-label="Select all patients on this page"
                    />
                  </th>
                  <SortableTh label="Patient Name" sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Business Unit" sortKey="businessUnit" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Phone Number" sortKey="phone" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Prescriptions" sortKey="prescriptions" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Total Dispensing" sortKey="totalDispensing" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Order Date" sortKey="orderDay" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Insurance Company" sortKey="insurance" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Pharmacy Name" sortKey="pharmacy" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Chronic Status" sortKey="chronicStatus" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Assigned To" sortKey="assignedTo" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Created On" sortKey="createdOn" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {pagePatients.length === 0 && (
                  <tr>
                    <td colSpan={12} className="grid-empty-row">No data matching the current filter.</td>
                  </tr>
                )}
                {pagePatients.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setViewingId(p.id)}
                    style={{ cursor: 'pointer' }}
                    className={selection.isSelected(p.id) ? 'row-selected' : undefined}
                  >
                    <td className="select-cell" onClick={(e) => e.stopPropagation()}>
                      <IndeterminateCheckbox
                        checked={selection.isSelected(p.id)}
                        onChange={() => selection.toggle(p.id)}
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                    <td>
                      <div className="patient-cell">
                        <div className="avatar">{initials(p.name)}</div>
                        <span className="cell-link">{p.name}</span>
                      </div>
                    </td>
                    <td>{p.businessUnitName ? <span className="bu-badge">{p.businessUnitName}</span> : '—'}</td>
                    <td className="mono">{p.phoneNumber}</td>
                    <td className="mono">{p.noOfPrescriptions !== null ? <span className="count-badge">{p.noOfPrescriptions}</span> : '—'}</td>
                    <td className="mono">{formatMoney(p.totalDispensingValue)}</td>
                    <td>{formatDayMonth(p.orderDay)}</td>
                    <td>{p.insuranceCompany ?? '—'}</td>
                    <td>{p.pharmacyName ?? '—'}</td>
                    <td>{p.chronicStatus ? <span className={`pill ${chronicClass(p.chronicStatus)}`}>{p.chronicStatus}</span> : '—'}</td>
                    <td className="assigned-cell" onClick={(e) => e.stopPropagation()}>
                      <LookupInput
                        placeholder="Unassigned"
                        initialValue={p.userId && p.userName ? { id: p.userId, name: p.userName } : null}
                        onSelect={(opt) => handleAssignUser(p.id, opt)}
                        searchFn={searchUsers}
                        disabled={savingUserFor === p.id}
                      />
                    </td>
                    <td className="mono">{formatDate(p.createdOn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && !error && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={patients.length}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="patients"
          />
        )}
      </div>

      {viewingId && (
        <PatientDetailsPanel
          patientId={viewingId}
          onClose={() => setViewingId(null)}
          onAssign={handleAssignUser}
          assigning={savingUserFor === viewingId}
        />
      )}

      {showBulkEdit && (
        <BulkEditUserModal
          count={selection.count}
          saving={bulkSaving}
          error={bulkError}
          onCancel={() => setShowBulkEdit(false)}
          onSave={handleBulkSave}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
