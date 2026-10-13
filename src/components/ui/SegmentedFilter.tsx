import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import './FilterControls.css';

/** Color for an option: a small dot when idle, a full tint when selected. */
export type FilterTone = 'success' | 'info' | 'warning' | 'danger' | 'ai' | 'brand' | 'neutral';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  tone?: FilterTone;
  /** Optional count badge shown after the label. */
  count?: number;
}

interface SegmentedFilterProps<T extends string> {
  label: string;
  icon?: IconDefinition;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

/** Small label + connected button group; exactly one option is selected. */
export function SegmentedFilter<T extends string>({ label, icon, value, options, onChange }: SegmentedFilterProps<T>) {
  return (
    <div className="filter-seg" role="group" aria-label={label}>
      <span className="filter-seg-label">
        {icon && <FontAwesomeIcon icon={icon} aria-hidden="true" />} {label}
      </span>
      <div className="filter-seg-btns">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`filter-seg-btn${opt.tone ? ` tone-${opt.tone}` : ''}${value === opt.value ? ' active' : ''}`}
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
          >
            {opt.tone && <span className="filter-seg-dot" aria-hidden="true" />}
            {opt.label}
            {opt.count !== undefined && <span className="filter-seg-count">{opt.count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
