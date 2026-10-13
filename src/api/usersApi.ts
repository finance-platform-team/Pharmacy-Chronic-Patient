import { listRecords } from './dataverseClient';
import type { Systemusers } from '../domain/dataverseModels/SystemusersModel';
import type { LookupOption } from './businessUnitsApi';

export async function searchUsers(term: string): Promise<LookupOption[]> {
  if (term.trim().length < 2) return [];
  const escaped = term.replace(/'/g, "''");

  const rows = await listRecords<Systemusers>('systemusers', {
    select: ['systemuserid', 'fullname'],
    filter: `contains(fullname,'${escaped}') and isdisabled eq false`,
    top: 8
  }, 'Failed to search users');

  return rows.map((r) => ({ id: r.systemuserid, name: r.fullname ?? '(no name)' }));
}

export async function getAllUsers(): Promise<LookupOption[]> {
  const rows = await listRecords<Systemusers>('systemusers', {
    select: ['systemuserid', 'fullname'],
    filter: 'isdisabled eq false',
    orderBy: ['fullname asc'],
    top: 100
  }, 'Failed to load users');

  return rows.map((r) => ({ id: r.systemuserid, name: r.fullname ?? '(no name)' }));
}