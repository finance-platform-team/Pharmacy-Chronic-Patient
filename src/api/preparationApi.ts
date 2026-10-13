import { listRecords, updateRecord } from './dataverseClient';
import type { ListOptions } from './dataverseClient';
import { Chp_omnitaskschp_fulfilmentpath, Chp_omnitaskschp_prepstatus, Chp_omnitaskschp_taskstatus } from '../domain/dataverseModels/Chp_omnitasksModel';

export interface PreparationTask {
  id: string;
  chpId: string | null;
  patient: string | null;
  bu: string | null;
  pharmacist: string | null;
  fulfilmentPath: string | null;
  opdVisit: string | null;
  prepStatus: string | null;
  prepStatusLabel: string | null;
  preparationSla: string | null;
  willDispense: boolean | null;
  modifiedOn: string | null;
  taskStatus: string | null;
  taskStatusLabel: string | null;
}

export async function getAllPreparationTasks(filter?: string): Promise<PreparationTask[]> {
  const options: ListOptions = {
    select: [
      'chp_omnitaskid',
      'chp_id',
      'chp_patient',
      'chp_bu',
      'chp_pharmacist',
      'chp_fulfilmentpath',
      'chp_doctorvisitid',
      'chp_prepstatus',
      'chp_preparationsla',
      'chp_willdispense',
      'chp_taskstatus',
      'modifiedon'
    ],
    orderBy: ['chp_id asc'],
    top: 200
  };

  if (filter) {
    options.filter = filter;
  }

  const rows = await listRecords<any>('chp_omnitasks', options, 'Failed to load preparation tasks');

  const getLabel = (map: Record<string, string>, value: unknown) => {
    if (value == null) return null;
    return map[String(value)] ?? null;
  };

  return rows.map((record: any) => {
    const willDispense = record.chp_willdispense === true
      || record.chp_willdispense === 1
      || record.chp_willdispense === '1'
      || String(record.chp_willdispense).toLowerCase() === 'yes';

    return {
      id: record.chp_omnitaskid,
      chpId: record.chp_id ?? null,
      patient: record.chp_patient ?? null,
      bu: record.chp_bu ?? null,
      pharmacist: record.chp_pharmacist ?? null,
      fulfilmentPath: record.chp_fulfilmentpathname ?? getLabel(Chp_omnitaskschp_fulfilmentpath, record.chp_fulfilmentpath),
      opdVisit: record.chp_doctorvisitid ?? null,
      prepStatus: record.chp_prepstatus != null ? String(record.chp_prepstatus) : null,
      prepStatusLabel: record.chp_prepstatusname ?? getLabel(Chp_omnitaskschp_prepstatus, record.chp_prepstatus),
      preparationSla: record.chp_preparationsla ?? null,
      willDispense: willDispense ? true : null,
      modifiedOn: record.modifiedon ?? null,
      taskStatus: record.chp_taskstatus != null ? String(record.chp_taskstatus) : null,
      taskStatusLabel: record.chp_taskstatusname ?? getLabel(Chp_omnitaskschp_taskstatus, record.chp_taskstatus)
    };
  });
}

export async function updatePreparationStatus(taskId: string, status: string, shouldSetStartTime: boolean): Promise<void> {
  const payload: Record<string, unknown> = { chp_prepstatus: status };

  if (shouldSetStartTime) {
    payload.chp_preparationsla = new Date().toISOString();
  }

  await updateRecord('chp_omnitasks', taskId, payload, 'Failed to update preparation status');
}

export async function setPreparationStartTime(taskId: string): Promise<void> {
  const payload: Record<string, unknown> = {
    chp_preparationsla: new Date().toISOString()
  };

  await updateRecord('chp_omnitasks', taskId, payload, 'Failed to set preparation start time');
}

// Closes out a cycle that's already Ready — chp_prepstatus has no "Fulfilled" value of
// its own, so this repurposes the otherwise-unused chp_taskstatus field (Not Reached /
// Completed) as the final step.
export async function markTaskFulfilled(taskId: string): Promise<void> {
  const payload: Record<string, unknown> = { chp_taskstatus: '766990002' };

  await updateRecord('chp_omnitasks', taskId, payload, 'Failed to mark cycle as fulfilled');
}
