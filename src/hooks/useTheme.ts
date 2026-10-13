import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'chronic.theme';

function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Called once before the first render so the saved theme shows without a flash. */
export function initTheme(): void {
  applyTheme(readStoredTheme());
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
