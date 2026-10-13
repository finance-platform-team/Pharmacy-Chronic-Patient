import { getContext } from '@microsoft/power-apps/app';
import { listRecords } from './dataverseClient';
import type { Systemusers } from '../domain/dataverseModels/SystemusersModel';

export interface CurrentUser {
  id: string;
  name: string | null;
}

let cachedCurrentUser: Promise<CurrentUser | null> | null = null;

/**
 * Resolves the signed-in user's Dataverse systemuserid. The app context only
 * exposes the host's Entra identity (objectId / userPrincipalName), not a
 * Dataverse user id directly, so this matches that identity against
 * systemusers to find the corresponding record. Cached for the session —
 * the signed-in user can't change without a full reload.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (!cachedCurrentUser) {
    cachedCurrentUser = resolveCurrentUser();
  }
  return cachedCurrentUser;
}

async function resolveCurrentUser(): Promise<CurrentUser | null> {
  try {
    const context = await getContext();
    const objectId = context.user?.objectId;
    const upn = context.user?.userPrincipalName;

    if (!objectId && !upn) return null;

    const filterParts: string[] = [];
    if (objectId) filterParts.push(`azureactivedirectoryobjectid eq ${objectId}`);
    if (upn) filterParts.push(`domainname eq '${upn.replace(/'/g, "''")}'`);

    const rows = await listRecords<Systemusers>('systemusers', {
      select: ['systemuserid', 'fullname'],
      filter: filterParts.join(' or '),
      top: 1
    }, 'Failed to resolve current user');

    if (rows.length === 0) {
      return null;
    }

    const match = rows[0];
    return { id: match.systemuserid, name: match.fullname ?? context.user?.fullName ?? null };
  } catch (err) {
    console.error('Failed to resolve current user:', err);
    return null;
  }
}
