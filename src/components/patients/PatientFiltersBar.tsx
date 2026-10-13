import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileCircleXmark, faFilePrescription, faRightLeft, faRotateLeft, faUserCheck } from '@fortawesome/free-solid-svg-icons';
import { getRegionBusinessUnits, type LookupOption } from '../../api/businessUnitsApi';
import { getDistinctPharmacyNames } from '../../api/patientsApi';
import {
  CREATED_RANGE_OPTIONS, EMPTY_FILTERS, getCreatedWindow,
  type CreatedRange, type PatientFilters, type UserAssignment
} from '../../domain/patientFilters';
import { ComboBox } from '../ui/ComboBox';
import { LookupInput } from '../ui/LookupInput';
import { DateRangePicker } from '../ui/DateRangePicker';
import { SegmentedFilter, type SegmentedOption } from '../ui/SegmentedFilter';
import { useRegion } from '../../context/RegionContext';

interface PatientFiltersBarProps {
  filters: PatientFilters;
  onChange: (f: PatientFilters) => void;
}

const ASSIGNMENT_OPTIONS: SegmentedOption<UserAssignment>[] = [
  { value: 'all', label: 'All' },
  { value: 'assigned', label: 'Assigned', tone: 'success' },
  { value: 'unassigned', label: 'Unassigned', tone: 'warning' }
];

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
  const { region } = useRegion();

  useEffect(() => {
    getDistinctPharmacyNames().then(setPharmacyNames).catch((err) => console.error('Failed to load pharmacy names:', err));
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

  const activeCount = [
    filters.pharmacyName,
    filters.businessUnitId,
    filters.createdRange !== 'all',
    filters.userAssignment !== 'all',
    filters.prescriptions !== EMPTY_FILTERS.prescriptions
  ].filter(Boolean).length;

  return (
    <div className="filters-panel registry-filters">
      <div className="registry-filter-field">
        <ComboBox
          placeholder="Pharmacy"
          value={filters.pharmacyName}
          options={pharmacyNames}
          onChange={(value) => onChange({ ...filters, pharmacyName: value })}
        />
      </div>

      <div className="registry-filter-field">
        <LookupInput
          placeholder="Business Unit"
          initialValue={businessUnits.find((bu) => bu.id === filters.businessUnitId) ?? null}
          options={businessUnits}
          onSelect={(opt) => onChange({ ...filters, businessUnitId: opt?.id ?? '' })}
        />
      </div>

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

      <SegmentedFilter<UserAssignment>
        label="Assignment"
        icon={faUserCheck}
        value={filters.userAssignment}
        options={ASSIGNMENT_OPTIONS}
        onChange={(value) => onChange({ ...filters, userAssignment: value })}
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
