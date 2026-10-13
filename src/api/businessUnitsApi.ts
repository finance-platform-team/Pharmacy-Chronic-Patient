import { listRecords } from './dataverseClient';
import type { Businessunits } from '../domain/dataverseModels/BusinessunitsModel';

export interface LookupOption {
  id: string;
  name: string;
}

export type Region = 'EGY' | 'KSA';

const REGION_STORAGE_KEY = 'chronic.region';

// Business units whose name starts with one of these belong to EGY; every
// other business unit (e.g. anything KSA-side) belongs to KSA. There's no
// real region/country field on the Dataverse businessunit entity to read
// this from, so this is an explicit literal rule per product decision.
// Assumption: matched by prefix (not exact name), so sub-branches like
// "SMH – ARC" / "SMH – AAC" are still treated as EGY.
// Business units whose name starts with one of these are Egypt; everything else is KSA.
const EGY_NAME_PREFIXES = ['AAC', 'ARC', 'ASH', 'SMH', 'AMH'];

function readStoredRegion(): Region {
  try {
    return window.localStorage.getItem(REGION_STORAGE_KEY) === 'KSA' ? 'KSA' : 'EGY';
  } catch {
    return 'EGY';
  }
}

let activeRegion: Region = readStoredRegion();

/** Called by RegionProvider whenever the sidebar's EGY/KSA toggle changes. */
export function setActiveRegion(region: Region): void {
  activeRegion = region;
  try {
    window.localStorage.setItem(REGION_STORAGE_KEY, region);
  } catch {
    // best-effort persistence only
  }
}

export function getActiveRegion(): Region {
  return activeRegion;
}

function matchesRegion(name: string, region: Region): boolean {
  const isEgyName = EGY_NAME_PREFIXES.some((prefix) => name.trim().toUpperCase().startsWith(prefix));
  return region === 'EGY' ? isEgyName : !isEgyName;
}

/**
 * Region check for a single already-resolved BU display name — lets any page
 * that already fetched its rows (Patients, Due Refill Queue, Preparation
 * Queue, Omni Tasks — all of which carry their own BU name field) filter its
 * list client-side against the active region with no extra network round
 * trip, so switching region re-filters instantly. Only the Egypt BUs count as
 * EGY; everything else — including records with no BU — is KSA.
 */
export function recordMatchesRegion(buName: string | null | undefined, region: Region = activeRegion): boolean {
  // A record with no BU isn't one of the Egypt BUs, so it belongs to KSA.
  return matchesRegion(buName ?? '', region);
}

export async function searchBusinessUnits(term: string): Promise<LookupOption[]> {
  if (term.trim().length < 2) return [];
  const escaped = term.replace(/'/g, "''");

  const rows = await listRecords<Businessunits>('businessunits', {
    select: ['businessunitid', 'name'],
    filter: `contains(name,'${escaped}') and isdisabled eq false`,
    top: 8
  }, 'Failed to search business units');

  return rows.map((r) => ({ id: r.businessunitid, name: r.name }));
}
let businessUnitsCache: LookupOption[] | null = null;
let businessUnitsCacheTime = 0;

/** Active Business Units belonging to the given region (for the BU filter pickers). */
export async function getRegionBusinessUnits(region: Region = activeRegion): Promise<LookupOption[]> {
  const units = await getAllBusinessUnits();
  return units.filter((u) => matchesRegion(u.name, region));
}

// Returns every real, active Business Unit record from Dataverse.
export async function getAllBusinessUnits(): Promise<LookupOption[]> {
  const now = Date.now();
  if (!businessUnitsCache || now - businessUnitsCacheTime >= 1000 * 60 * 10) {
    const rows = await listRecords<Businessunits>('businessunits', {
      select: ['businessunitid', 'name'],
      filter: 'isdisabled eq false',
      orderBy: ['name asc'],
      top: 200
    }, 'Failed to load business units');

    businessUnitsCache = rows.map((r) => ({ id: r.businessunitid, name: r.name }));
    businessUnitsCacheTime = now;
  }

  return businessUnitsCache;
}