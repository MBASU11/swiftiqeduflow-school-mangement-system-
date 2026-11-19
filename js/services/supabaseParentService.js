// Parent portal on the Supabase backend. Staff (administrators and registrars) invite
// parents; parents read their own children's information through parent_portal().
import { getSupabaseClient } from './supabaseClient.js';

async function rpc(name, args) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export const fetchParentPortal = () => rpc('parent_portal');
export const listParentAccess = async () => (await rpc('list_parent_access')) ?? [];
export const inviteParent = (parentId, email) => rpc('invite_parent', { target_parent_id: parentId, invite_email: email });
export const revokeParentAccess = (parentId) => rpc('revoke_parent_access', { target_parent_id: parentId });
