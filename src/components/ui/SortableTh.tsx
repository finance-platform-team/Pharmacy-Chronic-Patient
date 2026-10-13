import type { SortDir } from '../../hooks/useSort';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSort, faSortUp, faSortDown } from '@fortawesome/free-solid-svg-icons';

interface SortableThProps {
  label: string;
  sortKey: string;
  activeSortKey: string | null;
  sortDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}

export function SortableTh({ label, sortKey, activeSortKey, sortDir, onSort, className }: SortableThProps) {
  const isActive = activeSortKey === sortKey;
  const icon = isActive ? (sortDir === 'asc' ? faSortUp : faSortDown) : faSort;

  return (
    <th
      className={`th-sortable${className ? ` ${className}` : ''}`}
      onClick={() => onSort(sortKey)}
      aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="th-sortable-inner">
        {label}
        <FontAwesomeIcon icon={icon} className={`sort-arrow${isActive ? ' active' : ''}`} aria-hidden="true" />
      </span>
    </th>
  );
}
