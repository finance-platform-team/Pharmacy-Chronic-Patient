import { createRecord, deleteFileColumn, downloadFileColumn, getRecord, listAllRecords, listRecords, updateRecord, uploadFileColumn } from './dataverseClient';
import type { Patient } from '../domain/types';
import type { Cr18c_patients, Cr18c_patientsFileColumnName } from '../domain/dataverseModels/Cr18c_patientsModel';

const PATIENT_SELECT = [
  'cr18c_patientid',
  'cr18c_name',
  'cr18c_phonenumber',
  '_cr18c_businessunit_value',
  '_cr18c_user_value',
  'chp_insurancecompany',
  'chp_pharmacyname',
  'chp_chronicstatus',
  'cr18c_noofprescriptions',
  'cr18c_noofprescriptions_date',
  'chp_totaldispensingvalue',
  'chp_totaldispensingvalue_date',
  'cr18c_orderday',
  'chp_description_name',
  'chp_insurancecard_name',
  'chp_approval_name',
  'createdon'
];

function getLookupName(r: Cr18c_patients, directNameKey: keyof Cr18c_patients, valueKey: string): string | null {
  const direct = r[directNameKey] as string | undefined;
  if (direct) return direct;

  const annotationKey = `${valueKey}@OData.Community.Display.V1.FormattedValue`;
  const annotated = (r as unknown as Record<string, unknown>)[annotationKey] as string | undefined;
  if (annotated) return annotated;

  return null;
}

function mapToPatient(r: Cr18c_patients): Patient {
  return {
    id: r.cr18c_patientid,
    name: r.cr18c_name,
    phoneNumber: r.cr18c_phonenumber,

    businessUnitId: r._cr18c_businessunit_value ?? null,
    businessUnitName: getLookupName(r, 'cr18c_businessunitname', '_cr18c_businessunit_value'),

    insuranceCompany: r.chp_insurancecompany ?? null,
    pharmacyName: r.chp_pharmacyname ?? null,

    userId: r._cr18c_user_value ?? null,
    userName: getLookupName(r, 'cr18c_username', '_cr18c_user_value'),

    noOfPrescriptions: r.cr18c_noofprescriptions ?? null,
    noOfPrescriptionsDate: r.cr18c_noofprescriptions_date ?? null,

    totalDispensingValue: r.chp_totaldispensingvalue ?? null,
    totalDispensingValueDate: r.chp_totaldispensingvalue_date ?? null,

    orderDay: r.cr18c_orderday ?? null,

    chronicPatientType: r.chp_chronicpatientname ?? null,
    chronicStatus: getLookupName(r, 'chp_chronicstatusname', 'chp_chronicstatus'),

    descriptionFileName: r.chp_description_name ?? null,
    insuranceCardFileName: r.chp_insurancecard_name ?? null,
    approvalFileName: r.chp_approval_name ?? null,

    createdOn: r.createdon ?? null
  };
}

export async function getAllPatients(filter?: string): Promise<Patient[]> {
  const rows = await listAllRecords<Cr18c_patients>('cr18c_patients', {
    select: PATIENT_SELECT,
    filter: filter ?? 'statecode eq 0',
    orderBy: ['createdon desc']
  }, 'Failed to load patients');

  return rows.map(mapToPatient);
}

/**
 * Distinct, sorted pharmacy names across all active patients — powers the
 * pharmacy-name filter's dropdown (it's a free-text field on Patient, not a
 * lookup to another entity, so there's no dedicated pharmacy list to query).
 */
export async function getDistinctPharmacyNames(): Promise<string[]> {
  const rows = await listRecords<Cr18c_patients>('cr18c_patients', {
    select: ['chp_pharmacyname'],
    filter: 'statecode eq 0 and chp_pharmacyname ne null',
    top: 500
  }, 'Failed to load pharmacy names');

  const names = new Set<string>();
  rows.forEach((r) => {
    const name = r.chp_pharmacyname?.trim();
    if (name) names.add(name);
  });

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export interface PatientUserAssignment {
  userId: string;
  userName: string | null;
}

/**
 * Patient id -> assigned user, for patients that actually have one. Used to
 * join Prescriptions (which have no User field of their own) to their
 * Patient's assignment — a Prescription is only "eligible" for the Due
 * Refill Queue when its Patient shows up here.
 *
 * Pass `userId` to scope this to one user's caseload (e.g. "My Work") — a much
 * smaller, faster query than pulling every assigned patient just to filter
 * client-side down to one person's rows.
 */
export async function getPatientUserAssignments(userId?: string): Promise<Map<string, PatientUserAssignment>> {
  const filter = userId
    ? `statecode eq 0 and _cr18c_user_value eq ${userId}`
    : 'statecode eq 0 and _cr18c_user_value ne null';

  const rows = await listRecords<Cr18c_patients>('cr18c_patients', {
    select: ['cr18c_patientid', '_cr18c_user_value'],
    filter,
    top: 500
  }, 'Failed to load patient user assignments');

  const map = new Map<string, PatientUserAssignment>();
  rows.forEach((r) => {
    const userId = r._cr18c_user_value;
    if (!userId) return;
    map.set(r.cr18c_patientid, {
      userId,
      userName: getLookupName(r, 'cr18c_username', '_cr18c_user_value')
    });
  });
  return map;
}

export async function getPatientById(id: string): Promise<Patient> {
  const record = await getRecord<Cr18c_patients>('cr18c_patients', id, PATIENT_SELECT, 'Failed to load patient');
  return mapToPatient(record);
}

export interface CreatePatientInput {
  name: string;
  phoneNumber: string;
  businessUnitId: string;
  userId?: string | null;
}

export async function createPatient(input: CreatePatientInput): Promise<string> {
  const payload: Record<string, unknown> = {
    cr18c_name: input.name,
    cr18c_phonenumber: input.phoneNumber,
    'cr18c_BusinessUnit@odata.bind': `/businessunits(${input.businessUnitId})`
  };

  if (input.userId) {
    payload['cr18c_User@odata.bind'] = `/systemusers(${input.userId})`;
  }

  const created = await createRecord<Cr18c_patients | undefined>('cr18c_patients', payload, 'Failed to create patient');
  if (!created?.cr18c_patientid) {
    throw new Error('Failed to create patient');
  }

  return created.cr18c_patientid;
}

export async function updatePatientUser(patientId: string, userId: string | null): Promise<void> {
  const payload: Record<string, unknown> = userId
    ? { 'cr18c_User@odata.bind': `/systemusers(${userId})` }
    : { 'cr18c_User@odata.bind': null };

  await updateRecord('cr18c_patients', patientId, payload, 'Failed to update user');
}

export interface BulkUpdateResult {
  succeededIds: string[];
  failed: { id: string; message: string }[];
}

/**
 * Dataverse access here is single-record create/update/delete only —
 * there is no batch endpoint to call into. This fires the updates concurrently and
 * uses allSettled (not all) so one failing record doesn't hide the outcome of the
 * rest, which the bulk-edit UI needs to report partial success/failure accurately.
 */
export async function bulkUpdatePatientUser(patientIds: string[], userId: string | null): Promise<BulkUpdateResult> {
  const results = await Promise.allSettled(
    patientIds.map((id) => updatePatientUser(id, userId))
  );

  const succeededIds: string[] = [];
  const failed: { id: string; message: string }[] = [];

  results.forEach((result, index) => {
    const id = patientIds[index];
    if (result.status === 'fulfilled') {
      succeededIds.push(id);
    } else {
      const message = result.reason instanceof Error ? result.reason.message : 'Failed to update user';
      failed.push({ id, message });
    }
  });

  return { succeededIds, failed };
}

export type PatientFileField = 'description' | 'insuranceCard' | 'approval';

const FILE_COLUMN_MAP: Record<PatientFileField, Cr18c_patientsFileColumnName> = {
  description: 'chp_description',
  insuranceCard: 'chp_insurancecard',
  approval: 'chp_approval'
};

// File column upload / download / delete, via the cross-environment helpers in dataverseClient.ts.
export async function uploadPatientFile(patientId: string, field: PatientFileField, file: File): Promise<void> {
  await uploadFileColumn('cr18c_patients', patientId, FILE_COLUMN_MAP[field], file, 'Failed to upload file');
}

export async function downloadPatientFile(patientId: string, field: PatientFileField, fileName: string): Promise<void> {
  const data = await downloadFileColumn('cr18c_patients', patientId, FILE_COLUMN_MAP[field], 'Failed to download file');

  const blob = new Blob([new Uint8Array(data)]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Opens the file in a new tab instead of forcing a save-as — the browser renders it
// inline when it can (PDF, image, text) and otherwise falls back to its own download
// prompt. The blob URL is kept alive briefly so the new tab has time to load it.
export async function previewPatientFile(patientId: string, field: PatientFileField): Promise<void> {
  const data = await downloadFileColumn('cr18c_patients', patientId, FILE_COLUMN_MAP[field], 'Failed to load file');

  const blob = new Blob([new Uint8Array(data)]);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function deletePatientFile(patientId: string, field: PatientFileField): Promise<void> {
  await deleteFileColumn('cr18c_patients', patientId, FILE_COLUMN_MAP[field], 'Failed to delete file');
}