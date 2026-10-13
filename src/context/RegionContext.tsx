import { createContext, useContext, useState, type ReactNode } from 'react';
import { getActiveRegion, setActiveRegion, type Region } from '../api/businessUnitsApi';

interface RegionContextValue {
  region: Region;
  setRegion: (region: Region) => void;
}

const RegionContext = createContext<RegionContextValue | null>(null);

export function RegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegionState] = useState<Region>(() => getActiveRegion());

  function setRegion(next: Region) {
    setActiveRegion(next);
    setRegionState(next);
  }

  return (
    <RegionContext.Provider value={{ region, setRegion }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion(): RegionContextValue {
  const ctx = useContext(RegionContext);
  if (!ctx) {
    throw new Error('useRegion must be used within a RegionProvider');
  }
  return ctx;
}
