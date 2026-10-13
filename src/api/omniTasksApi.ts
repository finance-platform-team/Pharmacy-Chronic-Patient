// Omni / Medical Contact Center task log — same underlying chp_omnitasks table
// as preparationApi.ts's Prep Queue, but a different view of it: contact
// dispatch/attempts/agent tracking rather than pharmacy-prep status. Kept as
// its own file/select list (like prescriptionsApi.ts vs refillsApi.ts both
// reading cr18c_prescriptions for different pages) rather than extending
// preparationApi.ts.

import { listRecords, updateRecord } from './dataverseClient';
import { Chp_omnitaskschp_fulfilmentpath } from '../domain/dataverseModels/Chp_omnitasksModel';
import type { Chp_omnitasks } from '../domain/dataverseModels/Chp_omnitasksModel';

// Reverse of the generated Chp_omnitaskschp_fulfilmentpath map (766990000:
// 'Pickup', 766990001: 'Home Delivery') — writes need the numeric option
// value, but the UI/OmniTaskRow only carries the display label.
const FULFILMENT_PATH_TO_VALUE: Record<string, number> = Object.fromEntries(
  Object.entries(Chp_omnitaskschp_fulfilmentpath).map(([value, label]) => [label, Number(value)])
);

export type OmniTaskStatus = 'Completed' | 'Sent' | 'Not Reached – Retry Pending' | 'Not Reached – Escalated' | 'Unknown';

// The real, raw chp_taskstatus choice values as they exist in Dataverse —
// this is what an editable Task Status control should offer, as opposed to
// OmniTaskStatus's derived display states (see deriveStatus below). "Sent" is
// no longer a stored choice: a task with no status yet is one that was sent to
// Omni and is still waiting on the CRM's response.
export const RAW_TASK_STATUS_OPTIONS = ['Not Reached', 'Completed'] as const;
export type RawTaskStatus = typeof RAW_TASK_STATUS_OPTIONS[number];

export interface OmniTaskRow {
  id: string;
  cycleId: string | null;
  patient: string | null;
  patientMobile: string | null;
  bu: string | null;
  dispatched: string | null;
  attempts: string | null;
  status: OmniTaskStatus;
  /** chp_agent — plain text, filled in by the CRM's response flow. */
  agent: string | null;
  /** chp_pharmacist — read-only text column on chp_omnitasks. */
  pharmacist: string | null;
  fulfilmentPath: string | null;
  /** chp_insurancerequired — a real Boolean-type choice field on chp_omnitasks. */
  insuranceRequired: boolean | null;
  /**
   * chp_willdispense — read-only formula column (Task Status = Completed),
   * drives Prep Queue's SLA clock.
   */
  willDispense: boolean | null;
}

function getFormattedValue(r: Chp_omnitasks, directKey: keyof Chp_omnitasks, rawKey: string): string | null {
  const direct = r[directKey] as string | undefined;
  if (direct) return direct;

  const annotationKey = `${rawKey}@OData.Community.Display.V1.FormattedValue`;
  const annotated = (r as unknown as Record<string, unknown>)[annotationKey] as string | undefined;
  return annotated ?? null;
}

// chp_taskstatus only has 2 raw values (Not Reached / Completed); an empty
// status reads as "Sent" (awaiting the CRM). The "Retry Pending" vs
// "Escalated" split isn't a separate stored value either, it's derived here
// from chp_attempts ("used/max") once a task is still "Not Reached":
// maxed-out attempts reads as Escalated, anything short of that reads as
// still-retryable.
export function deriveStatus(taskStatusName: string | null, attempts: string | null): OmniTaskStatus {
  if (!taskStatusName) return 'Sent';
  if (taskStatusName === 'Completed') return 'Completed';
  if (taskStatusName === 'Not Reached') {
    const match = attempts?.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (match) {
      const [, used, max] = match;
      if (Number(used) >= Number(max)) return 'Not Reached – Escalated';
    }
    return 'Not Reached – Retry Pending';
  }
  return 'Unknown';
}

// Reverse mapping for the editable dropdown's value — collapses the derived
// display states back down to whichever raw choice actually produced them
// ('' for "Sent", i.e. no status stored yet).
export function toRawStatus(status: OmniTaskStatus): RawTaskStatus | '' {
  if (status === 'Completed') return 'Completed';
  if (status === 'Sent') return '';
  return 'Not Reached';
}

export async function getAllOmniTasks(): Promise<OmniTaskRow[]> {
  const rows = await listRecords<Chp_omnitasks>('chp_omnitasks', {
    select: [
      'chp_omnitaskid',
      'chp_id',
      'chp_patient',
      'chp_patientmobile',
      'chp_bu',
      'chp_dispatched',
      'chp_attempts',
      'chp_taskstatus',
      'chp_agent',
      'chp_pharmacist',
      'chp_fulfilmentpath',
      'chp_insurancerequired',
      'chp_willdispense'
    ],
    filter: 'statecode eq 0',
    orderBy: ['chp_id asc'],
    top: 200
  }, 'Failed to load Omni tasks');

  return rows.map((r) => {
    const taskStatusName = getFormattedValue(r, 'chp_taskstatusname', 'chp_taskstatus');
    return {
      id: r.chp_omnitaskid,
      cycleId: r.chp_id ?? null,
      patient: r.chp_patient ?? null,
      patientMobile: r.chp_patientmobile ?? null,
      bu: r.chp_bu ?? null,
      dispatched: r.chp_dispatched ?? null,
      attempts: r.chp_attempts ?? null,
      status: deriveStatus(taskStatusName, r.chp_attempts ?? null),
      agent: r.chp_agent ?? null,
      pharmacist: r.chp_pharmacist ?? null,
      fulfilmentPath: getFormattedValue(r, 'chp_fulfilmentpathname', 'chp_fulfilmentpath'),
      insuranceRequired: r.chp_insurancerequired ?? null,
      willDispense: r.chp_willdispense ?? null
    };
  });
}

export async function updateOmniTaskInsuranceRequired(taskId: string, value: boolean): Promise<void> {
  await updateRecord('chp_omnitasks', taskId, { chp_insurancerequired: value }, 'Failed to update Insurance Required');
}

export async function updateOmniTaskFulfilmentPath(taskId: string, label: string): Promise<void> {
  const value = FULFILMENT_PATH_TO_VALUE[label];
  if (value === undefined) {
    throw new Error(`Unknown Fulfilment Path value: ${label}`);
  }
  await updateRecord('chp_omnitasks', taskId, { chp_fulfilmentpath: value }, 'Failed to update Fulfilment Path');
}

export async function updateOmniTaskAgent(taskId: string, agent: string | null): Promise<void> {
  await updateRecord('chp_omnitasks', taskId, { chp_agent: agent?.trim() || null }, 'Failed to update Agent');
}
