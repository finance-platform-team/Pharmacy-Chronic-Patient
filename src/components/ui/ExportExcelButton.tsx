import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExcel } from '@fortawesome/free-solid-svg-icons';
import { downloadXlsx, type XlsxColumn } from '../../domain/xlsx';
import './RefreshButton.css';

interface ExportExcelButtonProps<T> {
  /** File name prefix — the export date is appended, e.g. "patients-2026-11-04.xlsx". */
  fileName: string;
  sheetName: string;
  columns: XlsxColumn<T>[];
  /** Everything currently filtered + sorted, not just the visible page. */
  rows: T[];
}

/** Same look as RefreshButton so the two sit side by side in a page's toolbar. */
export function ExportExcelButton<T>({ fileName, sheetName, columns, rows }: ExportExcelButtonProps<T>) {
  return (
    <button
      type="button"
      className="refresh-btn export-btn"
      onClick={() => downloadXlsx(fileName, sheetName, columns, rows)}
      disabled={rows.length === 0}
      title={`Export ${rows.length} row${rows.length === 1 ? '' : 's'} to Excel`}
    >
      <FontAwesomeIcon icon={faFileExcel} className="refresh-icon" aria-hidden="true" />
      Export
    </button>
  );
}
