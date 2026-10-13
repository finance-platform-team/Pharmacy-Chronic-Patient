// Cross-environment Dataverse access. The code app itself is deployed to one
// environment, but its data (cr18c_patients, cr18c_prescriptions, chp_omnitasks,
// ...) lives in a different one. The generated per-table services
// (Cr18c_patientsService etc.) always read/write the app's HOME environment no
// matter which connection they use, so every Dataverse call in src/api goes
// through the connector's *WithOrganization operations here instead, which
// take the target environment URL explicitly on each call.

import { MicrosoftDataverseService } from '../generated/services/MicrosoftDataverseService';

const DEFAULT_ORG_URL = 'https://org319b4ea9.crm4.dynamics.com';

/** The environment that holds the app's data — overridable via VITE_DATAVERSE_ORG_URL. */
export const DATAVERSE_ORG_URL = (import.meta.env.VITE_DATAVERSE_ORG_URL || DEFAULT_ORG_URL).replace(/\/+$/, '');

// Asks for formatted-value annotations so lookup/choice display names come back
// as `<field>@OData.Community.Display.V1.FormattedValue`, which the mappers in
// src/api/* already fall back on.
const PREFER_ANNOTATIONS = 'return=representation,odata.include-annotations="OData.Community.Display.V1.FormattedValue"';
const ACCEPT_JSON = 'application/json';

export interface ListOptions {
  select?: string[];
  filter?: string;
  orderBy?: string[];
  top?: number;
}

function errorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message || fallback;
  }
  return `${fallback}: ${JSON.stringify(error)}`;
}

export async function listRecords<T>(entitySetName: string, options: ListOptions, failureMessage: string): Promise<T[]> {
  const result = await MicrosoftDataverseService.ListRecordsWithOrganization(
    DATAVERSE_ORG_URL,
    entitySetName,
    PREFER_ANNOTATIONS,
    ACCEPT_JSON,
    undefined,
    undefined,
    options.select?.join(','),
    options.filter,
    options.orderBy?.join(','),
    undefined,
    undefined,
    options.top
  );

  if (!result.success) {
    throw new Error(errorMessage(result.error, failureMessage));
  }

  const value = (result.data as { value?: unknown } | undefined)?.value;
  return (Array.isArray(value) ? value : []) as T[];
}

/**
 * Like listRecords, but follows the connector's paging (@odata.nextLink /
 * $skiptoken) until every matching row is loaded, instead of stopping at one
 * page. `maxPages` is a safety stop against a runaway loop.
 */
export async function listAllRecords<T>(entitySetName: string, options: Omit<ListOptions, 'top'>, failureMessage: string, maxPages = 50): Promise<T[]> {
  const all: T[] = [];
  let skipToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await MicrosoftDataverseService.ListRecordsWithOrganization(
      DATAVERSE_ORG_URL,
      entitySetName,
      PREFER_ANNOTATIONS,
      ACCEPT_JSON,
      undefined,
      undefined,
      options.select?.join(','),
      options.filter,
      options.orderBy?.join(','),
      undefined,
      undefined,
      undefined,
      skipToken
    );

    if (!result.success) {
      throw new Error(errorMessage(result.error, failureMessage));
    }

    const data = result.data as { value?: unknown; '@odata.nextLink'?: string } | undefined;
    if (Array.isArray(data?.value)) all.push(...(data.value as T[]));

    skipToken = result.skipToken || skipTokenFromNextLink(data?.['@odata.nextLink']);
    if (!skipToken) break;
  }

  return all;
}

/**
 * A cheap "has anything changed?" token for a table: the newest modifiedon
 * across all its rows (one row, one column). Any create, edit, or
 * deactivate bumps it; used by useLiveRefresh to decide when to reload.
 */
export async function getLatestModifiedOn(entitySetName: string): Promise<string | null> {
  const result = await MicrosoftDataverseService.ListRecordsWithOrganization(
    DATAVERSE_ORG_URL,
    entitySetName,
    undefined,
    ACCEPT_JSON,
    undefined,
    undefined,
    'modifiedon',
    undefined,
    'modifiedon desc',
    undefined,
    undefined,
    1
  );

  if (!result.success) {
    throw new Error(errorMessage(result.error, `Failed to check ${entitySetName} for changes`));
  }

  const value = (result.data as { value?: { modifiedon?: string }[] } | undefined)?.value;
  return value?.[0]?.modifiedon ?? null;
}

function skipTokenFromNextLink(nextLink: string | undefined): string | undefined {
  if (!nextLink) return undefined;
  try {
    return new URL(nextLink).searchParams.get('$skiptoken') ?? undefined;
  } catch {
    return undefined;
  }
}

export async function getRecord<T>(entitySetName: string, id: string, select: string[] | undefined, failureMessage: string): Promise<T> {
  const result = await MicrosoftDataverseService.GetItemWithOrganization(
    PREFER_ANNOTATIONS,
    ACCEPT_JSON,
    DATAVERSE_ORG_URL,
    entitySetName,
    id,
    undefined,
    undefined,
    select?.join(',')
  );

  if (!result.success || !result.data) {
    throw new Error(errorMessage(result.error, failureMessage));
  }

  return result.data as T;
}

/** Creates a row and returns the created record (prefer: return=representation). */
export async function createRecord<T>(entitySetName: string, item: Record<string, unknown>, failureMessage: string): Promise<T> {
  const result = await MicrosoftDataverseService.CreateRecordWithOrganization(
    'return=representation',
    ACCEPT_JSON,
    DATAVERSE_ORG_URL,
    entitySetName,
    item
  );

  if (!result.success) {
    throw new Error(errorMessage(result.error, failureMessage));
  }

  return result.data as unknown as T;
}

// Uses the update-only operation (If-Match: *) rather than
// UpdateRecordWithOrganization, which is an upsert — an update against a row id
// that no longer exists must fail, not silently create a new row.
export async function updateRecord(entitySetName: string, id: string, item: Record<string, unknown>, failureMessage: string): Promise<void> {
  const result = await MicrosoftDataverseService.UpdateOnlyRecordWithOrganization(
    'return=representation',
    ACCEPT_JSON,
    '*',
    DATAVERSE_ORG_URL,
    entitySetName,
    id,
    item
  );

  if (!result.success) {
    throw new Error(errorMessage(result.error, failureMessage));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

export async function uploadFileColumn(entitySetName: string, id: string, columnName: string, file: File, failureMessage: string): Promise<void> {
  const base64 = arrayBufferToBase64(await file.arrayBuffer());

  const result = await MicrosoftDataverseService.UpdateEntityFileImageFieldContentWithOrganization(
    'application/octet-stream',
    DATAVERSE_ORG_URL,
    entitySetName,
    id,
    columnName,
    base64,
    file.name
  );

  if (!result.success) {
    throw new Error(errorMessage(result.error, failureMessage));
  }
}

// The connector only returns the first 4 MB chunk per call (Range header), so
// this keeps requesting chunks until one comes back short.
const DOWNLOAD_CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_DOWNLOAD_CHUNKS = 32;

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') {
    const binary = window.atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  throw new Error('Unexpected file content returned from Dataverse');
}

export async function downloadFileColumn(entitySetName: string, id: string, columnName: string, failureMessage: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (let i = 0; i < MAX_DOWNLOAD_CHUNKS; i++) {
    const start = i * DOWNLOAD_CHUNK_SIZE;
    const result = await MicrosoftDataverseService.GetEntityFileImageFieldContentWithOrganization(
      `bytes=${start}-${start + DOWNLOAD_CHUNK_SIZE - 1}`,
      DATAVERSE_ORG_URL,
      entitySetName,
      id,
      columnName
    );

    if (!result.success) {
      if (i > 0) break; // past the end of a file that was an exact multiple of the chunk size
      throw new Error(errorMessage(result.error, failureMessage));
    }

    const chunk = toBytes(result.data);
    chunks.push(chunk);
    total += chunk.length;
    if (chunk.length < DOWNLOAD_CHUNK_SIZE) break;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.length;
  });
  return bytes;
}

// The connector has no cross-environment "delete file" operation, so this reads
// the file column's value (the FileAttachment id) and calls Dataverse's
// DeleteFile action with it.
export async function deleteFileColumn(entitySetName: string, id: string, columnName: string, failureMessage: string): Promise<void> {
  const record = await getRecord<Record<string, unknown>>(entitySetName, id, [columnName], failureMessage);
  const fileId = record[columnName];
  if (typeof fileId !== 'string' || !fileId) return; // nothing to delete

  const result = await MicrosoftDataverseService.PerformUnboundActionWithOrganization(DATAVERSE_ORG_URL, 'DeleteFile', { FileId: fileId });
  if (!result.success) {
    throw new Error(errorMessage(result.error, failureMessage));
  }
}
