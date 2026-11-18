import { listRecords } from './dataverseClient';
import type { PrescriptionSummary } from '../domain/types';
import type { Cr18c_prescriptions } from '../domain/dataverseModels/Cr18c_prescriptionsModel';
import type { PrescriptionRow } from '../domain/types';

function getFormattedValue(r: Cr18c_prescriptions, directKey: keyof Cr18c_prescriptions, rawKey: string): string | null {
  const direct = r[directKey] as string | undefined;
  if (direct) return direct;

  const annotationKey = `${rawKey}@OData.Community.Display.V1.FormattedValue`;
  const annotated = (r as unknown as Record<string, unknown>)[annotationKey] as string | undefined;
  return annotated ?? null;
}

export async function getPrescriptionsByPatientId(patientId: string): Promise<PrescriptionSummary[]> {
  const rows = await listRecords<Cr18c_prescriptions>('cr18c_prescriptions', {
    select: [
      'cr18c_prescriptionid',
      'cr18c_name',
      'cr18c_pharmacyname2',
      'chp_dispensedvalue',
      'cr18c_dispensed',
      'cr18c_monthlydispensingdate',
      'chp_eligibility',
      'chp_chronicstatus'
    ],
    filter: `_cr18c_patient_value eq ${patientId} and statecode eq 0`,
    orderBy: ['createdon desc'],
    top: 100
  }, 'Failed to load prescriptions');

  return rows.map((r) => ({
    id: r.cr18c_prescriptionid,
    name: r.cr18c_name,
    pharmacyName: r.cr18c_pharmacyname2 ?? null,
    dispensedValue: r.chp_dispensedvalue ?? null,
    dispensed: r.cr18c_dispensed,
    monthlyDispensingDate: r.cr18c_monthlydispensingdate ?? null,
    eligibility: getFormattedValue(r, 'chp_eligibilityname', 'chp_eligibility'),
    chronicStatus: getFormattedValue(r, 'chp_chronicstatusname', 'chp_chronicstatus')
  }));
}

/** One prescription under a Pharmacy Visit ID — for the Prep Queue visit popup. */
export interface VisitPrescription {
  id: string;
  name: string;
  pharmacyVisitId: string | null;
  patientId: string | null;
  monthlyDispensingDate: string | null;
  eligibility: string | null;
  chronicStatus: string | null;
}

export async function getPrescriptionsByPharmacyVisitId(pharmacyVisitId: string): Promise<VisitPrescription[]> {
  const rows = await listRecords<Cr18c_prescriptions>('cr18c_prescriptions', {
    select: [
      'cr18c_prescriptionid',
      'cr18c_name',
      'cr18c_pid',
      '_cr18c_patient_value',
      'cr18c_monthlydispensingdate',
      'chp_eligibility',
      'chp_chronicstatus'
    ],
    filter: `cr18c_pid eq '${pharmacyVisitId.replace(/'/g, "''")}' and statecode eq 0`,
    orderBy: ['createdon desc'],
    top: 50
  }, 'Failed to load prescriptions for this visit');

  return rows.map((r) => ({
    id: r.cr18c_prescriptionid,
    name: r.cr18c_name,
    pharmacyVisitId: r.cr18c_pid ?? null,
    patientId: r._cr18c_patient_value ?? null,
    monthlyDispensingDate: r.cr18c_monthlydispensingdate ?? null,
    eligibility: getFormattedValue(r, 'chp_eligibilityname', 'chp_eligibility'),
    chronicStatus: getFormattedValue(r, 'chp_chronicstatusname', 'chp_chronicstatus')
  }));
}

const PRESCRIPTION_ID_CHUNK = 50;

/**
 * Prescription id -> Pharmacy Visit ID (cr18c_pid), for screens that only hold
 * the prescription lookup (e.g. chp_omnitasks). Batched in ≤50-id `or` filters,
 * run in parallel — same chunking as getProductsByPrescriptionIds.
 */
export async function getPharmacyVisitIds(prescriptionIds: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(prescriptionIds));
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += PRESCRIPTION_ID_CHUNK) {
    chunks.push(unique.slice(i, i + PRESCRIPTION_ID_CHUNK));
  }

  const results = await Promise.all(chunks.map((chunk) => listRecords<Cr18c_prescriptions>('cr18c_prescriptions', {
    select: ['cr18c_prescriptionid', 'cr18c_pid'],
    filter: chunk.map((id) => `cr18c_prescriptionid eq ${id}`).join(' or '),
    top: chunk.length
  }, 'Failed to load pharmacy visit ids')));

  const map = new Map<string, string>();
  results.flat().forEach((r) => {
    if (r.cr18c_pid) map.set(r.cr18c_prescriptionid, r.cr18c_pid);
  });
  return map;
}

// Above this many patient ids, an `or`-chained filter risks Dataverse's
// query-complexity/URL-length limits (same concern as getProductsByPrescriptionIds) —
// fall back to the unscoped query and let the caller narrow it down client-side instead.
const MAX_PATIENT_ID_FILTER = 50;

export async function getAllPrescriptions(filter?: string, patientIds?: string[]): Promise<PrescriptionRow[]> {
  if (patientIds && patientIds.length === 0) return [];

  let combinedFilter = filter ?? 'statecode eq 0';
  if (patientIds && patientIds.length <= MAX_PATIENT_ID_FILTER) {
    const idClause = patientIds.map((id) => `_cr18c_patient_value eq ${id}`).join(' or ');
    combinedFilter = `${combinedFilter} and (${idClause})`;
  }

  const rows = await listRecords<Cr18c_prescriptions>('cr18c_prescriptions', {
    select: [
      'cr18c_prescriptionid',
      'cr18c_name',
      'cr18c_pid',
      '_cr18c_patient_value',
      'chp_patientname',
      'cr18c_patientmobile',
      'cr18c_pharmacyname2',
      'chp_eligibility',
      'chp_availability',
      'chp_chronicstatus',
      'chp_dispensedvalue',
      'cr18c_monthlydispensingdate',
      'cr18c_orderday1',
      'chp_bu',
      'cr18c_dispensed',
      'createdon'
    ],
    filter: combinedFilter,
    orderBy: ['createdon desc'],
    top: 500
  }, 'Failed to load prescriptions');

  return rows.map((r) => ({
    id: r.cr18c_prescriptionid,
    name: r.cr18c_name,
    pharmacyVisitId: r.cr18c_pid ?? null,
    patientId: r._cr18c_patient_value ?? null,
    patientName: r.chp_patientname ?? null,
    patientMobile: r.cr18c_patientmobile ?? null,
    pharmacyName: r.cr18c_pharmacyname2 ?? null,
    eligibility: getFormattedValue(r, 'chp_eligibilityname', 'chp_eligibility'),
    availability: getFormattedValue(r, 'chp_availabilityname', 'chp_availability'),
    chronicStatus: getFormattedValue(r, 'chp_chronicstatusname', 'chp_chronicstatus'),
    dispensedValue: r.chp_dispensedvalue ?? null,
    monthlyDispensingDate: r.cr18c_monthlydispensingdate ?? null,
    orderDay: r.cr18c_orderday1 ?? null,
    businessUnit: r.chp_bu ?? null,
    dispensed: r.cr18c_dispensed,
    createdOn: r.createdon ?? null
  }));
}