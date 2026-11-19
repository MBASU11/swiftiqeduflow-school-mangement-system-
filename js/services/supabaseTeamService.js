// Team management for a school on the Supabase backend (administrators only; the
// database refuses everyone else).
import { getSupabaseClient } from './supabaseClient.js';

async function rpc(name, args) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function loadRemoteTeam() {
  const data = await rpc('list_school_team');
  return {
    members: data.members.map((m) => ({ id: m.userId, name: m.name, email: m.email, role: m.role, isOwner: m.isOwner, isMe: m.isMe })),
    invites: data.invites.map((i) => ({ id: i.id, name: i.name, email: i.email, role: i.role, code: i.code, expired: i.expired, expiresAt: i.expiresAt })),
  };
}

export const inviteRemoteMember = ({ email, name, role }) => rpc('create_school_invite', { invite_email: email, invite_name: name ?? '', invite_role: role });
export const revokeRemoteInvite = (id) => rpc('revoke_school_invite', { target_invite_id: id });
export const setRemoteMemberRole = (userId, role) => rpc('set_member_role', { target_user_id: userId, new_role: role });
export const removeRemoteMember = (userId) => rpc('remove_school_member', { target_user_id: userId });

// 'ABCD1234EFGH' -> 'ABCD-1234-EFGH' (easier to read out over the phone)
export const formatInviteCode = (code) => String(code ?? '').replace(/(.{4})(?=.)/g, '$1-');
