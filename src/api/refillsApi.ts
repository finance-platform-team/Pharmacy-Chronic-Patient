import { listRecords, getRecord, createRecord, updateRecord } from './dataverseClient';
import type { Cr18c_prescriptions } from '../domain/dataverseModels/Cr18c_prescriptionsModel';
import type { Chp_omnitasks } from '../domain/dataverseModels/Chp_omnitasksModel';

export async function updatePrescriptionStatus(prescriptionId: string, fields: Partial<Pick<Cr18c_prescriptions, 'chp_availability' | 'chp_eligibility'>>): Promise<void> {
  await updateRecord('cr18c_prescriptions', prescriptionId, fields, 'Failed to update prescription status');
}

function getCrmLeadUrl(): string {
  const url = import.meta.env.VITE_CRM_LEAD_URL;
  if (!url) {
    throw new Error('VITE_CRM_LEAD_URL is not configured — set it in .env (see .env.example)');
  }
  return url;
}

/**
 * Thrown when the chp_omnitasks record was created but the CRM push failed.
 * The caller must still treat the row as sent — the task exists, so sending
 * again would create a duplicate.
 */
export class CrmSendError extends Error {}

interface CrmLeadPayload {
  Country: string;
  Lead_Name: string;
  Topic: string;
  MobileNumber: string;
  Campaign: string;
  Lead_Source: string;
  Notes: string;
  BU: string;
  Ads: string;
  AD_set: string;
}

type OmniTaskForCrm = Pick<Chp_omnitasks, 'chp_omnitaskid' | 'chp_patient' | 'chp_patientmobile' | 'chp_bu' | 'chp_notes'>;

function buildCrmLeadPayload(task: OmniTaskForCrm): CrmLeadPayload {
  return {
    Country: 'egy',
    Lead_Name: task.chp_patient ?? '',
    Topic: 'Chronic Patient',
    MobileNumber: task.chp_patientmobile ?? '',
    Campaign: 'Chronic Patients Pharmacy',
    Lead_Source: 'Chronic Patients Pharmacy',
    Notes: task.chp_notes ?? '',
    BU: task.chp_bu ?? '',
    Ads: '',
    AD_set: task.chp_omnitaskid ?? ''
  };
}

async function sendLeadToCrm(payload: CrmLeadPayload): Promise<void> {
  let response: Response;
  try {
    response = await fetch(getCrmLeadUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new Error(`Failed to reach CRM: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = await response.text().catch(() => '');
  if (text) {
    try {
      console.info('CRM response:', JSON.parse(text));
    } catch {
      console.info('CRM response (non-JSON):', text);
    }
  }

  if (!response.ok) {
    console.error(`CRM send failed (${response.status})`, text);
    throw new Error(`CRM send failed (${response.status}${response.statusText ? ` ${response.statusText}` : ''})${text ? `: ${text}` : ''}`);
  }
}

/**
 * "Send Task to Omni" for one Due Refill Queue prescription — replaces the old
 * Power Automate flow: creates the chp_omnitasks record directly (same fields
 * the flow set), then pushes it to the CRM as a lead.
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

  try {
    // Re-read so the patient/mobile/BU columns derived from the prescription are populated.
    const task = await getRecord<OmniTaskForCrm>(
      'chp_omnitasks',
      created.chp_omnitaskid,
      ['chp_omnitaskid', 'chp_patient', 'chp_patientmobile', 'chp_bu', 'chp_notes'],
      'Failed to load created Omni task'
    );
    await sendLeadToCrm(buildCrmLeadPayload(task));
  } catch (err) {
    throw new CrmSendError(`Omni task created, but CRM send failed — ${err instanceof Error ? err.message : String(err)}`);
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
