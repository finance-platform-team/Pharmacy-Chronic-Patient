import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCalendarDays, faChevronDown, faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { usePopover } from './usePopover';
import './FilterControls.css';

export interface DatePreset<T extends string> {
  value: T;
  label: string;
}

interface DateRangePickerProps<T extends string> {
  label: string;
  /** Text shown on the pill when a range/preset is active, e.g. "Last 7 days". */
  activeLabel: string | null;
  presets: DatePreset<T>[];
  activePreset: T;
  /** Inclusive YYYY-MM-DD bounds of the current selection, for highlighting. */
  rangeStart: string | null;
  rangeEnd: string | null;
  onPreset: (preset: T) => void;
  onRange: (from: string, to: string) => void;
  onClear: () => void;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function toYmd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fromYmd(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

/**
 * Pill button that opens a popover with quick presets on the left and a
 * one-month calendar on the right. Click a start day, then an end day, to
 * pick a custom range (clicking the same day twice picks a single day).
 */
export function DateRangePicker<T extends string>({
  label, activeLabel, presets, activePreset, rangeStart, rangeEnd, onPreset, onRange, onClear
}: DateRangePickerProps<T>) {
  const { open, setOpen, position, triggerRef, popoverRef } = usePopover(470);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = rangeEnd ? fromYmd(rangeEnd) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [hoverDay, setHoverDay] = useState<string | null>(null);

  const today = toYmd(new Date());

  const days = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const leading = new Date(year, month, 1).getDay();
    const count = new Date(year, month + 1, 0).getDate();
    const cells: (string | null)[] = Array.from({ length: leading }, () => null);
    for (let d = 1; d <= count; d++) cells.push(toYmd(new Date(year, month, d)));
    return cells;
  }, [viewMonth]);

  // While picking (first day clicked), preview the range up to the hovered day.
  let selStart = rangeStart;
  let selEnd = rangeEnd;
  if (pendingStart) {
    const other = hoverDay ?? pendingStart;
    selStart = pendingStart < other ? pendingStart : other;
    selEnd = pendingStart < other ? other : pendingStart;
  }

  function toggleOpen() {
    if (!open) {
      const base = rangeEnd ? fromYmd(rangeEnd) : new Date();
      setViewMonth(new Date(base.getFullYear(), base.getMonth(), 1));
      setPendingStart(null);
    }
    setOpen(!open);
  }

  function handleDay(day: string) {
    if (!pendingStart) {
      setPendingStart(day);
      return;
    }
    const [from, to] = pendingStart <= day ? [pendingStart, day] : [day, pendingStart];
    setPendingStart(null);
    onRange(from, to);
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  }

  const monthTitle = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`filter-pill${activeLabel ? ' is-active' : ''}${open ? ' is-open' : ''}`}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <FontAwesomeIcon icon={faCalendarDays} className="filter-pill-icon" aria-hidden="true" />
        <span className="filter-pill-label">{label}{activeLabel ? ':' : ''}</span>
        {activeLabel && <span className="filter-pill-value">{activeLabel}</span>}
        <FontAwesomeIcon icon={faChevronDown} className="filter-pill-caret" aria-hidden="true" />
      </button>

      {open && position && createPortal(
        <div ref={popoverRef} className="filter-popover date-popover" style={{ top: position.top, left: position.left }} role="dialog" aria-label={label}>
          <div className="date-presets">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`date-preset${activePreset === p.value ? ' is-selected' : ''}`}
                onClick={() => { onPreset(p.value); setOpen(false); }}
              >
                {p.label}
              </button>
            ))}
            {activeLabel && (
              <button type="button" className="date-clear" onClick={() => { onClear(); setOpen(false); }}>
                Clear
              </button>
            )}
          </div>

          <div className="date-calendar">
            <div className="date-cal-head">
              <button type="button" className="date-nav" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
              </button>
              <span className="date-cal-title">{monthTitle}</span>
              <button type="button" className="date-nav" onClick={() => shiftMonth(1)} aria-label="Next month">
                <FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />
              </button>
            </div>

            <div className="date-grid" onMouseLeave={() => setHoverDay(null)}>
              {WEEKDAYS.map((w) => <span key={w} className="date-weekday">{w}</span>)}
              {days.map((day, i) => {
                if (!day) return <span key={`blank-${i}`} />;
                const inRange = !!(selStart && selEnd && day >= selStart && day <= selEnd);
                const isEdge = day === selStart || day === selEnd;
                const classes = [
                  'date-day',
                  inRange ? 'in-range' : '',
                  isEdge && inRange ? 'is-edge' : '',
                  day === today ? 'is-today' : ''
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={day}
                    type="button"
                    className={classes}
                    onClick={() => handleDay(day)}
                    onMouseEnter={() => setHoverDay(day)}
                  >
                    {Number(day.slice(8))}
                  </button>
                );
              })}
            </div>

            <div className="date-hint">
              {pendingStart ? 'Now pick the end date' : 'Pick a start date, then an end date'}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
