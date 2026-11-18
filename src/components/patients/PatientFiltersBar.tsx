import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBuilding, faFileCircleXmark, faFilePrescription, faPrescriptionBottleMedical, faRightLeft, faRotateLeft, faUserNurse
} from '@fortawesome/free-solid-svg-icons';
import { getRegionBusinessUnits, type LookupOption } from '../../api/businessUnitsApi';
import { getAssignedUsers, getDistinctPharmacyNames } from '../../api/patientsApi';
import {
  CREATED_RANGE_OPTIONS, EMPTY_FILTERS, getCreatedWindow,
  type CreatedRange, type PatientFilters
} from '../../domain/patientFilters';
import { FilterSelectPill, type FilterSelectOption } from '../ui/FilterSelectPill';
import { DateRangePicker } from '../ui/DateRangePicker';
import { useRegion } from '../../context/RegionContext';

interface PatientFiltersBarProps {
  filters: PatientFilters;
  onChange: (f: PatientFilters) => void;
}

// Pinned above the pharmacist list in the Assigned To pill — replaces the old
// separate All / Assigned / Unassigned segment.
const ANY_ASSIGNED = { id: '__assigned', name: 'Any pharmacist' };
const UNASSIGNED = { id: '__unassigned', name: 'Unassigned' };
const ASSIGNMENT_QUICK_OPTIONS = [ANY_ASSIGNED, UNASSIGNED];

function assignmentValue(f: PatientFilters) {
  if (f.assignedUserId) return { id: f.assignedUserId, name: f.assignedUserName };
  if (f.userAssignment === 'assigned') return ANY_ASSIGNED;
  if (f.userAssignment === 'unassigned') return UNASSIGNED;
  return null;
}

// The calendar itself covers "custom", so it isn't offered as a preset.
const DATE_PRESETS = CREATED_RANGE_OPTIONS.filter((o) => o.value !== 'custom');

function formatShortDate(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function createdLabel(f: PatientFilters): string | null {
  if (f.createdRange === 'all') return null;
  if (f.createdRange !== 'custom') {
    return CREATED_RANGE_OPTIONS.find((o) => o.value === f.createdRange)?.label ?? null;
  }
  if (f.createdFrom && f.createdTo) {
    return f.createdFrom === f.createdTo
      ? formatShortDate(f.createdFrom)
      : `${formatShortDate(f.createdFrom)} – ${formatShortDate(f.createdTo)}`;
  }
  return null;
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function PatientFiltersBar({ filters, onChange }: PatientFiltersBarProps) {
  const [businessUnits, setBusinessUnits] = useState<LookupOption[]>([]);
  const [pharmacyNames, setPharmacyNames] = useState<string[]>([]);
  const [assignedUsers, setAssignedUsers] = useState<FilterSelectOption[]>([]);
  const [assignedUsersLoading, setAssignedUsersLoading] = useState(true);
  const { region } = useRegion();

  useEffect(() => {
    getDistinctPharmacyNames().then(setPharmacyNames).catch((err) => console.error('Failed to load pharmacy names:', err));
    getAssignedUsers()
      .then((users) => setAssignedUsers(users.map((u) => ({
        id: u.id,
        name: u.name,
        hint: `${u.patientCount} patient${u.patientCount === 1 ? '' : 's'}`
      }))))
      .catch((err) => console.error('Failed to load assigned users:', err))
      .finally(() => setAssignedUsersLoading(false));
  }, []);

  useEffect(() => {
    getRegionBusinessUnits(region)
      .then((units) => {
        setBusinessUnits(units);
        if (filters.businessUnitId && !units.some((u) => u.id === filters.businessUnitId)) {
          onChange({ ...filters, businessUnitId: '' });
        }
      })
      .catch((err) => console.error('Failed to load business units:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region]);

  // Inclusive day bounds of the current Created On window, for the calendar's
  // highlight (getCreatedWindow's `to` is exclusive, so step back one day).
  const { from, to } = getCreatedWindow(filters);
  const rangeStart = from ? toYmd(from) : null;
  const rangeEnd = to ? toYmd(new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1)) : null;

  const withRx = filters.prescriptions !== 'without';
  const pharmacyOptions = pharmacyNames.map((name) => ({ id: name, name }));

  const activeCount = [
    filters.pharmacyName,
    filters.businessUnitId,
    filters.createdRange !== 'all',
    filters.userAssignment !== 'all' || filters.assignedUserId,
    filters.prescriptions !== EMPTY_FILTERS.prescriptions
  ].filter(Boolean).length;

  return (
    <div className="filters-panel registry-filters">
      <FilterSelectPill
        label="Pharmacy"
        icon={faPrescriptionBottleMedical}
        value={filters.pharmacyName ? { id: filters.pharmacyName, name: filters.pharmacyName } : null}
        options={pharmacyOptions}
        onChange={(opt) => onChange({ ...filters, pharmacyName: opt?.name ?? '' })}
      />

      <FilterSelectPill
        label="Business Unit"
        icon={faBuilding}
        value={businessUnits.find((bu) => bu.id === filters.businessUnitId) ?? null}
        options={businessUnits}
        onChange={(opt) => onChange({ ...filters, businessUnitId: opt?.id ?? '' })}
      />

      <FilterSelectPill
        label="Assigned To"
        icon={faUserNurse}
        value={assignmentValue(filters)}
        quickOptions={ASSIGNMENT_QUICK_OPTIONS}
        options={assignedUsers}
        optionsLoading={assignedUsersLoading}
        showAvatar
        searchPlaceholder="Search pharmacist name…"
        onChange={(opt) => {
          const isQuick = opt?.id === ANY_ASSIGNED.id || opt?.id === UNASSIGNED.id;
          onChange({
            ...filters,
            userAssignment: opt?.id === ANY_ASSIGNED.id ? 'assigned' : opt?.id === UNASSIGNED.id ? 'unassigned' : 'all',
            assignedUserId: opt && !isQuick ? opt.id : '',
            assignedUserName: opt && !isQuick ? opt.name : ''
          });
        }}
      />

      <DateRangePicker<CreatedRange>
        label="Created On"
        activeLabel={createdLabel(filters)}
        presets={DATE_PRESETS}
        activePreset={filters.createdRange}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        onPreset={(preset) => onChange({ ...filters, createdRange: preset, createdFrom: '', createdTo: '' })}
        onRange={(fromDay, toDay) => onChange({ ...filters, createdRange: 'custom', createdFrom: fromDay, createdTo: toDay })}
        onClear={() => onChange({ ...filters, createdRange: 'all', createdFrom: '', createdTo: '' })}
      />

      {/* One toggle button: each click flips between patients with and
          without prescriptions. */}
      <button
        type="button"
        className={`registry-rx-toggle ${withRx ? 'is-with' : 'is-without'}`}
        onClick={() => onChange({ ...filters, prescriptions: withRx ? 'without' : 'with' })}
        title="Click to switch"
      >
        <FontAwesomeIcon icon={withRx ? faFilePrescription : faFileCircleXmark} aria-hidden="true" />
        {withRx ? 'With Prescriptions' : 'Without Prescriptions'}
        <FontAwesomeIcon icon={faRightLeft} className="registry-rx-swap" aria-hidden="true" />
      </button>

      {activeCount > 0 && (
        <button
          type="button"
          className="filter-reset"
          onClick={() => onChange({ ...EMPTY_FILTERS, search: filters.search })}
        >
          <FontAwesomeIcon icon={faRotateLeft} aria-hidden="true" /> Reset ({activeCount})
        </button>
      )}
    </div>
  );
}
