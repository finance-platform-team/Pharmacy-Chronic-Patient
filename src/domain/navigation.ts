import { faUsers, faTruckMedical, faClipboardList, faHeadset } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export type NavKey = 'registry' | 'dueRefillQueue' | 'preparationQueue' | 'omniTasks';

export interface NavItem {
  key: NavKey;
  label: string;
  icon: IconDefinition;
}

// Same icons each page already uses in its own header (faUsers / faTruckMedical /
// faClipboardList / faHeadset), reused here so the sidebar visually matches each destination.
export const NAV_ITEMS: NavItem[] = [
  { key: 'registry', label: 'Chronic App (Registry)', icon: faUsers },
  { key: 'dueRefillQueue', label: 'Due Refill Queue', icon: faTruckMedical },
  { key: 'preparationQueue', label: 'Preparation Queue', icon: faClipboardList },
  { key: 'omniTasks', label: 'Omni Tasks', icon: faHeadset },
];