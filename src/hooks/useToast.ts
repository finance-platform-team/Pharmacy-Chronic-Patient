import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastMessage } from '../components/ui/Toast';

export interface UseToastResult {
  toast: ToastMessage | null;
  showToast: (message: string, tone?: ToastMessage['tone']) => void;
}

export function useToast(durationMs: number = 3200): UseToastResult {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, tone: ToastMessage['tone'] = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, tone });
    timerRef.current = setTimeout(() => setToast(null), durationMs);
  }, [durationMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast };
}
