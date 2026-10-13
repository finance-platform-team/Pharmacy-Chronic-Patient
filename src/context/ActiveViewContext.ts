import { createContext, useContext } from 'react';

// Every page stays mounted once visited (so switching back is instant), but
// only the page on screen should spend network calls on live updates. App
// wraps each page in a provider saying whether it's the visible one.
const ActiveViewContext = createContext(true);

export const ActiveViewProvider = ActiveViewContext.Provider;

export function useIsActiveView(): boolean {
  return useContext(ActiveViewContext);
}
