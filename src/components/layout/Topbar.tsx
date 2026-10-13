import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronRight, faMoon, faSun, faBars } from '@fortawesome/free-solid-svg-icons';
import { NAV_ITEMS, type NavKey } from '../../domain/navigation';
import { useRegion } from '../../context/RegionContext';
import { useTheme } from '../../hooks/useTheme';
import type { Region } from '../../api/businessUnitsApi';
import './Topbar.css';

const REGION_OPTIONS: Region[] = ['EGY', 'KSA'];

interface TopbarProps {
  activeView: NavKey;
  onOpenMenu: () => void;
}

/** Global header: breadcrumb + page title on the left, region and theme switches on the right. */
export function Topbar({ activeView, onOpenMenu }: TopbarProps) {
  const { region, setRegion } = useRegion();
  const { theme, toggleTheme } = useTheme();
  const label = NAV_ITEMS.find((i) => i.key === activeView)?.label ?? '';

  return (
    <header className="topbar">
      <button type="button" className="topbar-menu" aria-label="Open menu" onClick={onOpenMenu}>
        <FontAwesomeIcon icon={faBars} />
      </button>

      <div className="topbar-page-context">
        <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
          <span>Pharmacy</span>
          <FontAwesomeIcon icon={faChevronRight} />
          <span>Chronic Program</span>
          <FontAwesomeIcon icon={faChevronRight} />
          <span aria-current="page">{label}</span>
        </nav>
        <h1>{label}</h1>
      </div>

      <div className="topbar-actions">
        <div className="topbar-region" role="group" aria-label="Region">
          {REGION_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              className={region === r ? 'is-active' : ''}
              aria-pressed={region === r}
              onClick={() => setRegion(r)}
            >
              {r}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="theme-switch"
          role="switch"
          aria-checked={theme === 'dark'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          onClick={toggleTheme}
        >
          <span className={theme === 'light' ? 'theme-active' : ''}><FontAwesomeIcon icon={faSun} /></span>
          <span className={theme === 'dark' ? 'theme-active' : ''}><FontAwesomeIcon icon={faMoon} /></span>
        </button>
      </div>
    </header>
  );
}
