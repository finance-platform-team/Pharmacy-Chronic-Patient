import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Topbar } from './components/layout/Topbar';
import { PatientsPage } from './components/patients/PatientsPage';
import type { NavKey } from './domain/navigation';
import { RegionProvider } from './context/RegionContext';
import { ActiveViewProvider } from './context/ActiveViewContext';
import './styles/synapse-surfaces.css';

// The landing page (Registry) ships in the main bundle; the others are split
// into their own chunks and only downloaded the first time they're opened.
const DueRefillQueuePage = lazy(() => import('./components/refills/DueRefillQueuePage').then((m) => ({ default: m.DueRefillQueuePage })));
const PreparationQueuePage = lazy(() => import('./components/preparation/PreparationQueuePage').then((m) => ({ default: m.PreparationQueuePage })));
const OmniTasksPage = lazy(() => import('./components/omnitasks/OmniTasksPage').then((m) => ({ default: m.OmniTasksPage })));

const PAGES: { key: NavKey; render: () => ReactNode }[] = [
  { key: 'registry', render: () => <PatientsPage /> },
  { key: 'dueRefillQueue', render: () => <DueRefillQueuePage /> },
  { key: 'preparationQueue', render: () => <PreparationQueuePage /> },
  { key: 'omniTasks', render: () => <OmniTasksPage /> }
];

function App() {
  const [activeView, setActiveView] = useState<NavKey>('registry');
  // Pages mount on first visit only (so startup loads just the page on
  // screen instead of all four at once competing for the connector), then
  // stay mounted so switching back is instant and keeps filters/scroll.
  const [visited, setVisited] = useState<Set<NavKey>>(() => new Set<NavKey>(['registry']));
  const [menuOpen, setMenuOpen] = useState(false);

  function navigate(key: NavKey) {
    setActiveView(key);
    setVisited((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }

  return (
    <RegionProvider>
      <div className="syn-frame">
        <Sidebar
          activeView={activeView}
          onNavigate={navigate}
          mobileOpen={menuOpen}
          onCloseMobile={() => setMenuOpen(false)}
        />

        <div className="syn-main">
          <Topbar activeView={activeView} onOpenMenu={() => setMenuOpen(true)} />

          <div className="app-content-area">
            {PAGES.filter((page) => visited.has(page.key)).map((page) => (
              <div
                key={page.key}
                style={{ display: activeView === page.key ? 'flex' : 'none', flex: '1 1 0%', minWidth: 0, overflow: 'hidden' }}
              >
                <ActiveViewProvider value={activeView === page.key}>
                  <Suspense fallback={<div className="loading-indicator">Loading…</div>}>
                    {page.render()}
                  </Suspense>
                </ActiveViewProvider>
              </div>
            ))}
          </div>
        </div>
      </div>
    </RegionProvider>
  );
}

export default App;
