// Patient document attachments, stored in the "Chronic_Patients" SharePoint
// document library on the Training site — one folder per patient, named by
// the patient's id. Talks to SharePoint directly through the app's SharePoint
// connection (no Power Automate flow).
//
// The generated Chronic_PatientsService only covers list-item CRUD, so the two
// file operations it lacks (upload a file's bytes, list one folder) are
// registered below as extra connector operations on the same data source.

import { getClient } from '@microsoft/power-apps/data';
import { dataSourcesInfo } from '../../.power/schemas/appschemas/dataSourcesInfo';
import type { Chronic_PatientsRead } from '../generated/models/Chronic_PatientsModel';

export interface PatientDocumentActionResponse {
  ok: boolean;
  name?: string;
  path?: string;
  url?: string;
}

export interface PatientDocumentListItem {
  name: string;
  url: string;
  /** The library item ID (as a string) — what deletePatientDocument takes. */
  path: string;
  /** The library listing doesn't carry file size. */
  size: number | null;
}

const DATA_SOURCE = 'chronic_patients';
/** Library folder (server-relative to the site) that holds one subfolder per patient. */
const LIBRARY_FOLDER = 'Chronic_Patients';

type ApiParam = { name: string; in: 'path' | 'query' | 'body'; required: boolean; type: string; format?: string };
type ApiDef = { path: string; method: string; parameters: ApiParam[]; responseInfo: Record<string, { type: string }> };

const pathParams: ApiParam[] = [
  { name: 'connectionId', in: 'path', required: true, type: 'string' },
  { name: 'dataset', in: 'path', required: true, type: 'string' }
];

const FILE_APIS: Record<string, ApiDef> = {
  // SharePoint connector "Create file".
  CreateFile: {
    path: '/{connectionId}/datasets/{dataset}/files',
    method: 'POST',
    parameters: [
      ...pathParams,
      { name: 'folderPath', in: 'query', required: true, type: 'string' },
      { name: 'name', in: 'query', required: true, type: 'string' },
      { name: 'queryParametersSingleEncoded', in: 'query', required: false, type: 'boolean' },
      { name: 'body', in: 'body', required: true, type: 'string', format: 'binary' }
    ],
    responseInfo: { '200': { type: 'object' } }
  },
  // SharePoint connector "Get items", limited to one folder of the library.
  GetFolderItems: {
    path: '/{connectionId}/datasets/{dataset}/tables/{tableName}/items',
    method: 'GET',
    parameters: [
      ...pathParams,
      { name: 'tableName', in: 'path', required: true, type: 'string' },
      { name: 'folderPath', in: 'query', required: false, type: 'string' },
      { name: 'viewScopeOption', in: 'query', required: false, type: 'string' },
      { name: '$top', in: 'query', required: false, type: 'integer' }
    ],
    responseInfo: { '200': { type: 'object' } }
  }
};

// The runtime keeps one shared dataSourcesInfo object, so adding the extra
// operations to it here makes them callable through any client. Done in code
// (not in the generated file) so re-running add-data-source doesn't drop them.
const source = (dataSourcesInfo as unknown as Record<string, { tableId: string; apis: Record<string, unknown> }>)[DATA_SOURCE];
Object.assign(source.apis, FILE_APIS);

const client = getClient(dataSourcesInfo);

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return `${fallback}: ${error.message}`;
  return fallback;
}

function patientFolder(folderName: string): string {
  return `${LIBRARY_FOLDER}/${folderName}`;
}

/**
 * Uploads a patient document into that patient's folder (created on first upload).
 * @param fileBase64 Raw base64 file content (no `data:...;base64,` prefix).
 */
export async function uploadPatientDocument(
  fileBase64: string,
  fileName: string,
  folderName: string
): Promise<PatientDocumentActionResponse> {
  const result = await client.executeAsync<Record<string, unknown>, { Name?: string; Path?: string }>({
    connectorOperation: {
      tableName: DATA_SOURCE,
      operationName: 'CreateFile',
      parameters: {
        folderPath: `/${patientFolder(folderName)}`,
        name: fileName,
        queryParametersSingleEncoded: true,
        body: fileBase64
      }
    }
  });
  if (!result.success) {
    console.error('SharePoint upload failed', result.error);
    throw new Error(errorMessage(result.error, 'Failed to upload document'));
  }
  return { ok: true, name: result.data?.Name, path: result.data?.Path };
}

/** Lists the documents in a patient's folder. A patient with no folder yet has no documents. */
export async function listPatientDocuments(folderName: string): Promise<PatientDocumentListItem[]> {
  const folder = patientFolder(folderName);
  const result = await client.executeAsync<Record<string, unknown>, { value?: Chronic_PatientsRead[] } | Chronic_PatientsRead[]>({
    connectorOperation: {
      tableName: DATA_SOURCE,
      operationName: 'GetFolderItems',
      parameters: { tableName: source.tableId, folderPath: folder, $top: 500 }
    }
  });
  if (!result.success) {
    // A folder that doesn't exist yet comes back as a 404 — that's just "no documents".
    const status = (result.error as { status?: number } | undefined)?.status;
    if (status === 404) return [];
    console.error('SharePoint list failed', result.error);
    throw new Error(errorMessage(result.error, 'Failed to load documents'));
  }

  const rows = Array.isArray(result.data) ? result.data : result.data?.value ?? [];
  const prefix = `${folder}/`.toLowerCase();
  return rows
    // Belt and braces: keep only files sitting directly in this patient's folder.
    .filter((r) => !r['{IsFolder}'] && (r['{Path}'] ?? '').toLowerCase() === prefix)
    .map((r) => ({
      name: r['{FilenameWithExtension}'] ?? r['{Name}'] ?? 'Document',
      url: r['{Link}'] ?? '',
      path: r.ID !== undefined ? String(r.ID) : '',
      size: null
    }));
}

/** Deletes a document. `filePath` is the library item ID returned by listPatientDocuments. */
export async function deletePatientDocument(_folderName: string, filePath: string | null | undefined): Promise<PatientDocumentActionResponse> {
  if (!filePath || !filePath.trim()) {
    throw new Error('Cannot delete this document: its SharePoint item ID is unavailable.');
  }
  const result = await client.deleteRecordAsync(DATA_SOURCE, filePath);
  if (!result.success) {
    console.error('SharePoint delete failed', result.error);
    throw new Error(errorMessage(result.error, 'Failed to delete document'));
  }
  return { ok: true };
}
