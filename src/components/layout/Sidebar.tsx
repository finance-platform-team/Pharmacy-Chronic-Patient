import { useState, type MouseEvent } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBriefcaseMedical } from '@fortawesome/free-solid-svg-icons';
import { NAV_ITEMS, type NavKey } from '../../domain/navigation';
import { PulseNavigation, createDataverseClient } from 'pulse-shared-navigation';
import { MicrosoftDataverseService } from '../../generated/services/MicrosoftDataverseService';
import './Sidebar.css';

// Create once, outside the component.
const pulseClient = createDataverseClient(MicrosoftDataverseService);
const POWER_APP_ID = 'a295a81f-8cd5-4428-ab61-56d63ed50567';

interface SidebarProps {
  activeView: NavKey;
  onNavigate: (key: NavKey) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.54 8.31a2.46 2.46 0 1 0 0-4.92 2.46 2.46 0 0 0 0 4.92ZM6.46 8.31a2.46 2.46 0 1 0 0-4.92 2.46 2.46 0 0 0 0 4.92ZM17.54 20.61a2.46 2.46 0 1 0 0-4.92 2.46 2.46 0 0 0 0 4.92ZM6.46 20.61a2.46 2.46 0 1 0 0-4.92 2.46 2.46 0 0 0 0 4.92Z" />
    </svg>
  );
}

/** Synapse-style icon rail: brand tile, Pulse launcher, then one tile per page. */
export function Sidebar({ activeView, onNavigate, mobileOpen, onCloseMobile }: SidebarProps) {
  const [pulseOpen, setPulseOpen] = useState(false);
  // Always starts as the compact icon rail.
  const [expanded, setExpanded] = useState(false);

  function toggleExpanded() {
    setExpanded((prev) => !prev);
  }

  // Any click on the rail toggles it, except on the page tiles and the Pulse
  // launcher, which keep doing their own thing.
  function handleRailClick(e: MouseEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest('.rail-item, .rail-menu')) return;
    toggleExpanded();
  }

  function handleNavigate(key: NavKey) {
    onNavigate(key);
    onCloseMobile();
  }

  return (
    <>
      <PulseNavigation
        client={pulseClient}
        powerAppId={POWER_APP_ID}
        variant="overlay"
        isOpen={pulseOpen}
        onClose={() => setPulseOpen(false)}
        className="pulse-over-sidebar"
      />

      <div className={`mobile-backdrop${mobileOpen ? ' show' : ''}`} onClick={onCloseMobile} />

      <aside className={`rail${mobileOpen ? ' mobile-open' : ''}${expanded ? ' is-expanded' : ''}`} aria-label="Main navigation" onClick={handleRailClick}>
        <button
          type="button"
          className="rail-brand"
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-expanded={expanded}
        >
          <FontAwesomeIcon icon={faBriefcaseMedical} aria-hidden="true" />
        </button>
        <span className="rail-brand-copy">
          <strong>Andalusia Pharmacy</strong>
          <small>Chronic Program</small>
        </span>

        <button
          type="button"
          className="rail-menu"
          aria-label="Open Pulse navigation"
          data-tooltip="Pulse apps"
          onClick={() => setPulseOpen(true)}
        >
          <MenuIcon />
        </button>

        <nav className="rail-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`rail-item${activeView === item.key ? ' is-current' : ''}`}
              aria-current={activeView === item.key ? 'page' : undefined}
              data-tooltip={item.label}
              onClick={() => handleNavigate(item.key)}
            >
              <span className="rail-item-icon"><FontAwesomeIcon icon={item.icon} aria-hidden="true" /></span>
              <span className="rail-item-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>
    </>
  );
}
