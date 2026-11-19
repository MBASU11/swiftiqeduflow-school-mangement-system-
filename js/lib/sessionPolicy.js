// How long a signed-in session may live. Pure functions so they can be tested without a browser.
// Idle = no activity for this long. Absolute = hard cap since sign-in, whatever the activity.
export const SESSION_LIMITS = {
  school: { idleMs: 60 * 60 * 1000, absoluteMs: 12 * 60 * 60 * 1000 },
  admin: { idleMs: 20 * 60 * 1000, absoluteMs: 4 * 60 * 60 * 1000 },
};

export function newSession(extra, now = Date.now()) {
  return { ...extra, startedAt: now, lastActive: now };
}

// A session without timestamps (created before this change) counts as expired: sign in again.
export function sessionState(session, kind, now = Date.now()) {
  const limit = SESSION_LIMITS[kind];
  if (!session || !limit || !session.startedAt || !session.lastActive) return 'expired';
  if (now - session.startedAt > limit.absoluteMs) return 'expired';
  if (now - session.lastActive > limit.idleMs) return 'expired';
  return 'valid';
}

export const touched = (session, now = Date.now()) => ({ ...session, lastActive: now });
