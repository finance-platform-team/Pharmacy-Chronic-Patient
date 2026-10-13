export type UserAssignment = 'all' | 'unassigned' | 'assigned';

/**
 * Whether the patient has any prescriptions — driven by
 * cr18c_noofprescriptions: a count above 0 means "with", empty or 0 "without".
 */
export type PrescriptionPresence = 'all' | 'with' | 'without';

export type CreatedRange = 'all' | 'today' | 'last7' | 'last30' | 'thisMonth' | 'custom';

export const CREATED_RANGE_OPTIONS: { value: CreatedRange; label: string }[] = [
  { value: 'all', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'custom', label: 'Custom range…' }
];

export interface PatientFilters {
  search: string;
  businessUnitId: string;
  userAssignment: UserAssignment;
  pharmacyName: string;
  prescriptions: PrescriptionPresence;
  createdRange: CreatedRange;
  /** YYYY-MM-DD, only used when createdRange is 'custom'. */
  createdFrom: string;
  /** YYYY-MM-DD (inclusive), only used when createdRange is 'custom'. */
  createdTo: string;
}

export const EMPTY_FILTERS: PatientFilters = {
  search: '',
  businessUnitId: '',
  userAssignment: 'all',
  pharmacyName: '',
  prescriptions: 'with',
  createdRange: 'all',
  createdFrom: '',
  createdTo: ''
};

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseLocalDate(value: string): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The [from, to) window in local time for the Created On filter — `to` is
 * exclusive (start of the day after the last included day), so a custom "To"
 * date includes that whole day. Either end may be open (null).
 */
export function getCreatedWindow(f: PatientFilters): { from: Date | null; to: Date | null } {
  const today = startOfLocalDay(new Date());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  switch (f.createdRange) {
    case 'today':
      return { from: today, to: tomorrow };
    case 'last7':
      return { from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6), to: tomorrow };
    case 'last30':
      return { from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29), to: tomorrow };
    case 'thisMonth':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: tomorrow };
    case 'custom': {
      const from = parseLocalDate(f.createdFrom);
      const toDay = parseLocalDate(f.createdTo);
      const to = toDay ? new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1) : null;
      return { from, to };
    }
    default:
      return { from: null, to: null };
  }
}

export function buildPatientFilter(f: PatientFilters): string {
  const parts = ['statecode eq 0'];

  if (f.search.trim()) {
    const escaped = f.search.trim().replace(/'/g, "''");
    parts.push(`(contains(cr18c_name,'${escaped}') or contains(cr18c_phonenumber,'${escaped}'))`);
  }

  if (f.businessUnitId) {
    parts.push(`_cr18c_businessunit_value eq ${f.businessUnitId}`);
  }

  if ((f.pharmacyName ?? '').trim()) {
    const escaped = f.pharmacyName.trim().replace(/'/g, "''");
    parts.push(`contains(chp_pharmacyname,'${escaped}')`);
  }

  if (f.userAssignment === 'unassigned') {
    parts.push('_cr18c_user_value eq null');
  } else if (f.userAssignment === 'assigned') {
    parts.push('_cr18c_user_value ne null');
  }

  if (f.prescriptions === 'with') {
    parts.push('cr18c_noofprescriptions gt 0');
  } else if (f.prescriptions === 'without') {
    parts.push('(cr18c_noofprescriptions eq null or cr18c_noofprescriptions eq 0)');
  }

  const { from, to } = getCreatedWindow(f);
  if (from) parts.push(`createdon ge ${from.toISOString()}`);
  if (to) parts.push(`createdon lt ${to.toISOString()}`);

  return parts.join(' and ');
}
