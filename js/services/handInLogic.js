// A learner handing homework in: what is allowed, and what a valid answer looks like. Pure functions (no storage, no DOM).
export const MAX_TEXT = 5000;
export const MAX_FILE = 300 * 1024; // browser storage is small; larger work should be handed in on paper or by link
export const FILE_TYPES = { 'image/png': 'PNG image', 'image/jpeg': 'JPEG image', 'application/pdf': 'PDF', 'text/plain': 'text file' };

// May this learner hand in (or change) this homework today? Late hand-ins are allowed and flagged; a deadline freezes a hand-in
// that was already made, and marking freezes it for good.
export function handInCheck({ homework, student, submission, today }) {
  if (!homework || (homework.status ?? 'published') !== 'published') return { ok: false, reason: 'This homework is not available.', late: false };
  if (!student || homework.classId !== student.classId) return { ok: false, reason: 'This homework is not for your class.', late: false };
  const late = today > homework.dueDate;
  if (submission?.status === 'marked') return { ok: false, reason: 'Your teacher has already marked this, so it can no longer be changed.', late };
  if (submission && ['submitted', 'late'].includes(submission.status) && late) return { ok: false, reason: 'The deadline has passed, so your hand-in can no longer be changed.', late };
  return { ok: true, reason: '', late };
}

export function validateAnswer({ text = '', attachment } = {}) {
  const e = []; const t = String(text ?? '').trim();
  if (t.length > MAX_TEXT) e.push(`Keep the written answer under ${MAX_TEXT.toLocaleString()} characters.`);
  if (!t && !attachment) e.push('Write your answer or attach a file.');
  if (attachment) {
    if (!FILE_TYPES[attachment.type]) e.push('Attach a PNG or JPEG picture, a PDF or a text file.');
    if (!(attachment.size > 0) || attachment.size > MAX_FILE) e.push(`The file must be smaller than ${Math.round(MAX_FILE / 1024)} KB.`);
    if (!String(attachment.name ?? '').trim() || String(attachment.name).length > 120) e.push('The file needs a name of up to 120 characters.');
    const prefix = `data:${attachment.type};base64,`;
    if (typeof attachment.dataUrl !== 'string' || !attachment.dataUrl.startsWith(prefix) || !/^[A-Za-z0-9+/=]+$/.test(attachment.dataUrl.slice(prefix.length)) || attachment.dataUrl.length > MAX_FILE * 1.4 + 200) e.push('The file could not be read. Try attaching it again.');
  }
  return e;
}
