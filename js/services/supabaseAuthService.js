import { getPlan } from '../config/plans.js';
import { getSupabaseClient } from './supabaseClient.js';

export async function registerSchoolWithSupabase(details) {
  const plan = getPlan(details.planId);
  if (!plan) return { ok: false, error: 'Choose a valid school plan.' };

  const client = await getSupabaseClient();
  const { data, error } = await client.auth.signUp({
    email: String(details.email ?? '').trim().toLowerCase(),
    password: details.password,
    options: {
      data: {
        account_type: 'school',
        school_name: String(details.schoolName ?? '').trim(),
        contact_name: String(details.name ?? '').trim(),
        phone: String(details.phone ?? '').trim(),
        plan_id: plan.id,
        plan_name: plan.name,
        // The column that used to hold "single/both modules" now holds the billing frequency.
        plan_modules: ['monthly', 'termly', 'annual'].includes(details.billing) ? details.billing : 'annual',
        student_count: String(details.studentCount ?? '').trim(),
      },
    },
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    user: data.user,
    session: data.session,
    requiresEmailConfirmation: !data.session,
  };
}

export async function getSupabaseIdentity() {
  const client = await getSupabaseClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) return { ok: false, error: userError.message };
  const user = userData.user;
  if (!user) return { ok: false, error: 'Sign in to continue.' };

  const { data: admin, error: adminError } = await client.from('platform_admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (adminError) return { ok: false, error: adminError.message };
  if (admin) return { ok: true, kind: 'platform-admin', user };

  const { data: memberships, error: membershipError } = await client.from('school_memberships')
    .select('role, school:schools(id, name, contact_name, email, phone, student_count, status, status_note, plan_id, plan_name, plan_modules, registered_at)')
    .eq('user_id', user.id)
    .limit(1);
  if (membershipError) return { ok: false, error: membershipError.message };
  const membership = memberships?.[0];
  if (!membership?.school) return { ok: false, noSchool: true, user, error: 'This account is not part of a school yet. Enter your invitation code to join one.' };
  const row = membership.school;
  const school = {
    id: row.id,
    name: row.contact_name,
    schoolName: row.name,
    email: row.email || user.email,
    phone: row.phone ?? undefined,
    studentCount: row.student_count ?? undefined,
    status: row.status,
    statusNote: row.status_note ?? undefined,
    plan: { planId: row.plan_id, name: row.plan_name, billing: ['monthly', 'termly', 'annual'].includes(row.plan_modules) ? row.plan_modules : 'annual' },
    createdAt: row.registered_at,
    setupComplete: false,
  };
  if (row.status === 'approved') {
    const { data: setupRecord, error: setupError } = await client.from('school_records')
      .select('payload')
      .eq('collection', 'school')
      .eq('record_id', 'the-school')
      .maybeSingle();
    if (setupError) return { ok: false, error: setupError.message };
    school.setupComplete = setupRecord?.payload?.setupComplete === true;
  }
  return { ok: true, kind: 'school', user, role: membership.role, school };
}

export async function signInWithSupabase(email, password) {
  const client = await getSupabaseClient();
  const { error } = await client.auth.signInWithPassword({
    email: String(email ?? '').trim().toLowerCase(),
    password,
  });
  if (error) return { ok: false, error: error.message };

  const identity = await getSupabaseIdentity();
  // Someone invited to a school who hasn't entered their code yet stays signed in
  // and is taken to the "enter your invitation code" screen.
  if (identity.noSchool) return { ok: true, kind: 'no-school', user: identity.user };
  if (!identity.ok) {
    await client.auth.signOut();
    return identity;
  }
  return identity;
}

export async function signOutFromSupabase() {
  const client = await getSupabaseClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}
// A colleague invited by their school's administrator creates their own sign-in here.
// The invitation code ties the new account to the school and the role chosen for them.
export async function joinSchoolWithInvite({ name, email, password, code }) {
  const client = await getSupabaseClient();
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  const { data, error } = await client.auth.signUp({
    email: cleanEmail,
    password,
    options: { data: { account_type: 'staff', full_name: String(name ?? '').trim() } },
  });
  if (error) return { ok: false, error: error.message };
  if (!data.session) return { ok: true, requiresEmailConfirmation: true };
  const joined = await acceptInviteCode(code);
  if (!joined.ok) return joined;
  return { ok: true, joined: true, role: joined.role };
}

export async function acceptInviteCode(code) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('accept_school_invite', { invite_code: String(code ?? '') });
  if (error) return { ok: false, error: error.message };
  return { ok: true, role: data?.role };
}

// Password reset (cloud mode). The reply never reveals whether an email has an account.
// The reset link returns to this page with ?reset=1; supabase-js turns the token in the URL into a
// short-lived recovery session, which is only good for choosing a new password.
export async function requestPasswordReset(email) {
  const client = await getSupabaseClient();
  const redirectTo = `${window.location.origin}${window.location.pathname}?reset=1`;
  const { error } = await client.auth.resetPasswordForEmail(String(email || '').trim().toLowerCase(), { redirectTo });
  if (error && /rate|too many|limit/i.test(error.message)) throw new Error('Too many reset requests. Please wait a few minutes and try again.');
}

export async function hasRecoverySession() {
  const client = await getSupabaseClient();
  const current = await client.auth.getSession();
  if (current.data?.session) return true;

  // The client may still be exchanging the recovery code or access token
  // from the email URL when the reset screen first renders.
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let subscription;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.unsubscribe();
      if (error) reject(error);
      else resolve(value);
    };
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) finish(true);
    });
    subscription = listener.subscription;
    timer = setTimeout(async () => {
      try {
        const latest = await client.auth.getSession();
        finish(Boolean(latest.data?.session));
      } catch (error) {
        finish(false, error);
      }
    }, 2000);
  });
}

export async function setNewPassword(password) {
  const client = await getSupabaseClient();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error(error.message.includes('same') ? 'Choose a password you have not used before.' : 'We could not change the password. The link may have expired — request a new one.');
  await client.auth.signOut(); // make them sign in again with the new password
}
