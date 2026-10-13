import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faTriangleExclamation, faArrowsRotate, type IconDefinition } from '@fortawesome/free-solid-svg-icons';
import './RefreshButton.css';

interface RefreshButtonProps {
  onRefresh: () => Promise<void> | void;
  label?: string;
}

type RefreshState = 'idle' | 'refreshing' | 'done' | 'error';

/**
 * Re-fetches a page's data in place — no full browser reload — with clear
 * feedback: a spinning icon while in flight, then a brief checkmark
 * confirmation so it's obvious the refresh actually happened.
 */
export function RefreshButton({ onRefresh, label = 'Refresh' }: RefreshButtonProps) {
  const [state, setState] = useState<RefreshState>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function handleClick() {
    if (state === 'refreshing') return;
    if (resetTimer.current) clearTimeout(resetTimer.current);

    setState('refreshing');
    try {
      await onRefresh();
      setState('done');
    } catch (err) {
      console.error('Refresh failed:', err);
      setState('error');
    } finally {
      resetTimer.current = setTimeout(() => setState('idle'), 1400);
    }
  }

  const icon: IconDefinition = state === 'done' ? faCheck : state === 'error' ? faTriangleExclamation : faArrowsRotate;
  const text = state === 'refreshing' ? 'Refreshing…' : state === 'done' ? 'Refreshed' : state === 'error' ? 'Failed' : label;

  return (
    <button
      type="button"
      className={`refresh-btn refresh-btn-${state}`}
      onClick={handleClick}
      disabled={state === 'refreshing'}
      aria-live="polite"
    >
      <FontAwesomeIcon icon={icon} className={`refresh-icon ${state === 'refreshing' ? 'spin' : ''}`} aria-hidden="true" />
      {text}
    </button>
  );
}
