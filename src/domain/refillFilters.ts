export const AVAILABILITY_OPTIONS = [
  { value: '766990000', label: 'Available' },
  { value: '766990001', label: 'Partial Available' },
  { value: '766990002', label: 'Out of Stock' }
];

export const ELIGIBILITY_OPTIONS = [
  { value: '766990000', label: 'Valid' },
  { value: '766990001', label: 'Not Valid' }
];

/** Cycle Due (cr18c_monthlydispensingdate) quick ranges; 'custom' = picked on the calendar. */
export type DueRange = 'all' | 'overdue' | 'today' | 'next7' | 'next30' | 'thisMonth' | 'custom';

export const DUE_RANGE_PRESETS: { value: DueRange; label: string }[] = [
  { value: 'all', label: 'Any time' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'next7', label: 'Next 7 days' },
  { value: 'next30', label: 'Next 30 days' },
  { value: 'thisMonth', label: 'This month' }
];

export interface RefillFilters {
  search: string;
  availability: string;
  /** cr18c_dispensed: '' = all, 'yes' / 'no' = only that value. */
  dispensed: '' | 'yes' | 'no';
  /** When true, further narrow the (already user-assigned-only) queue to just the signed-in user's records. */
  myWorkOnly: boolean;
  dueRange: DueRange;
  /** Cycle due (monthly dispensing) date range — 'YYYY-MM-DD' or '' for unbounded. */
  fromDate: string;
  toDate: string;
}

export const EMPTY_REFILL_FILTERS: RefillFilters = {
  search: '',
  availability: '',
  dispensed: '',
  myWorkOnly: true,
  dueRange: 'all',
  fromDate: '',
  toDate: ''
};

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Inclusive YYYY-MM-DD bounds for a Cycle Due preset, computed from today —
 * stored into fromDate/toDate when the preset is picked, so the query and the
 * calendar highlight both read the same two fields.
 */
export function dueRangeBounds(range: DueRange): { fromDate: string; toDate: string } {
  const now = new Date();
  const day = (offset: number) => toYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));

  switch (range) {
    case 'overdue':
      return { fromDate: '', toDate: day(-1) };
    case 'today':
      return { fromDate: day(0), toDate: day(0) };
    case 'next7':
      return { fromDate: day(0), toDate: day(6) };
    case 'next30':
      return { fromDate: day(0), toDate: day(29) };
    case 'thisMonth':
      return {
        fromDate: toYmd(new Date(now.getFullYear(), now.getMonth(), 1)),
        toDate: toYmd(new Date(now.getFullYear(), now.getMonth() + 1, 0))
      };
    default:
      return { fromDate: '', toDate: '' };
  }
}

export function buildRefillFilter(f: RefillFilters): string {
  const parts = ['statecode eq 0'];

  if (f.search.trim()) {
    const escaped = f.search.trim().replace(/'/g, "''");
    parts.push(`(contains(chp_patientname,'${escaped}') or contains(cr18c_name,'${escaped}') or contains(cr18c_pharmacyname2,'${escaped}') or contains(chp_bu,'${escaped}'))`);
  }

  if (f.availability) {
    parts.push(`chp_availability eq ${f.availability}`);
  }

  if (f.dispensed) {
    parts.push(`cr18c_dispensed eq ${f.dispensed === 'yes'}`);
  }

  if (f.fromDate) {
    parts.push(`cr18c_monthlydispensingdate ge ${f.fromDate}T00:00:00Z`);
  }
  if (f.toDate) {
    parts.push(`cr18c_monthlydispensingdate le ${f.toDate}T23:59:59Z`);
  }

  return parts.join(' and ');
}
