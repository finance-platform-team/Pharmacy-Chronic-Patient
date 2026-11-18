import { listRecords, getRecord, createRecord, updateRecord } from './dataverseClient';
import type { Cr18c_prescriptions } from '../domain/dataverseModels/Cr18c_prescriptionsModel';
import type { Chp_omnitasks } from '../domain/dataverseModels/Chp_omnitasksModel';

export async function updatePrescriptionStatus(prescriptionId: string, fields: Partial<Pick<Cr18c_prescriptions, 'chp_availability' | 'chp_eligibility'>>): Promise<void> {
  await updateRecord('cr18c_prescriptions', prescriptionId, fields, 'Failed to update prescription status');
}

/**
 * "Send Task to Omni" for one Due Refill Queue prescription — replaces the old
 * Power Automate flow: creates the chp_omnitasks record directly (same fields
 * the flow set). The WhatsApp and CRM flows trigger off the new row in Dataverse.
 */
export async function sendTaskToOmni(prescriptionId: string): Promise<void> {
  const existing = await listRecords<Chp_omnitasks>('chp_omnitasks', {
    select: ['chp_omnitaskid'],
    filter: `statecode eq 0 and _chp_prescription_value eq ${prescriptionId}`,
    top: 1
  }, 'Failed to check existing Omni task');
  if (existing.length > 0) {
    throw new Error('This cycle was already sent to Omni');
  }

  const prescription = await getRecord<Cr18c_prescriptions>(
    'cr18c_prescriptions',
    prescriptionId,
    ['cr18c_name', 'cr18c_monthlydispensingdate'],
    'Failed to load prescription'
  );

  const created = await createRecord<Chp_omnitasks | undefined>('chp_omnitasks', {
    chp_id: crypto.randomUUID(),
    chp_dispatched: prescription.cr18c_monthlydispensingdate ?? null,
    chp_visitid: prescription.cr18c_name ?? null,
    'chp_Prescription@odata.bind': `/cr18c_prescriptions(${prescriptionId})`
  }, 'Failed to create Omni task');
  if (!created?.chp_omnitaskid) {
    throw new Error('Failed to create Omni task');
  }
}

/**
 * Prescription id -> earliest time it was actually sent to Omni, read from the
 * real chp_omnitasks record(s) that the flow creates (linked back via
 * chp_Prescription) — not from any local/in-memory flag. This is what makes
 * the "Sent" state on Due Refill Queue survive a refresh/reload instead of
 * reverting to "Send Task to Omni" every time the page reloads.
 */
export async function getSentToOmniTimestamps(): Promise<Map<string, number>> {
  const rows = await listRecords<Chp_omnitasks>('chp_omnitasks', {
    select: ['_chp_prescription_value', 'createdon'],
    filter: 'statecode eq 0 and _chp_prescription_value ne null',
    top: 500
  }, 'Failed to load Omni send status');

  const map = new Map<string, number>();
  rows.forEach((r) => {
    const prescriptionId = r._chp_prescription_value;
    if (!prescriptionId) return;
    const at = r.createdon ? Date.parse(r.createdon) : Date.now();
    const existing = map.get(prescriptionId);
    if (existing === undefined || at < existing) map.set(prescriptionId, at);
  });
  return map;
}
