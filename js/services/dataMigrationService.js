import { getSupabaseClient } from './supabaseClient.js';

const COLLECTION_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;

export function validateSchoolBackup(json) {
  let backup;
  try {
    backup = JSON.parse(json);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!backup || typeof backup !== 'object' || !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
    return { ok: false, error: 'This file is not a SwiftIQ EduFlow school backup.' };
  }

  const records = [];
  for (const [collection, envelope] of Object.entries(backup.data)) {
    if (!COLLECTION_PATTERN.test(collection) || !envelope || typeof envelope.records !== 'object' || !envelope.records || Array.isArray(envelope.records)) {
      return { ok: false, error: `The "${collection}" section of this backup looks corrupted.` };
    }
    for (const [key, value] of Object.entries(envelope.records)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: `A record in the "${collection}" section is not valid.` };
      }
      const id = String(value.id ?? key);
      if (!id.trim()) return { ok: false, error: `A record in the "${collection}" section has no ID.` };
      records.push({ collection, record_id: id, payload: { ...value, id } });
    }
  }
  return { ok: true, records };
}

// Upserts in batches so a retry after a network interruption is safe. The
// database trigger derives school_id from the authenticated approved member.
export async function importSchoolBackup(json, { batchSize = 150 } = {}) {
  const validated = validateSchoolBackup(json);
  if (!validated.ok) return validated;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    return { ok: false, error: 'Choose a batch size between 1 and 500.' };
  }
  const client = await getSupabaseClient();
  const files = validated.records.filter((record) => record.collection === 'documentFiles');
  const records = validated.records.filter((record) => record.collection !== 'documentFiles');
  let uploadedFiles = 0;

  if (files.length > 0) {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) return { ok: false, error: userError.message, imported: 0 };
    const { data: membership, error: membershipError } = await client.from('school_memberships')
      .select('school_id')
      .eq('user_id', userData.user.id)
      .limit(1)
      .single();
    if (membershipError) return { ok: false, error: membershipError.message, imported: 0 };
    const documentRecords = new Map(records.filter((record) => record.collection === 'documents').map((record) => [record.record_id, record]));
    for (const fileRecord of files) {
      const metadata = documentRecords.get(fileRecord.record_id);
      const dataUrl = fileRecord.payload.dataUrl;
      if (!metadata || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue;
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const path = `${membership.school_id}/${metadata.record_id}/${metadata.payload.fileName || metadata.record_id}`;
      const { error } = await client.storage.from('school-documents').upload(path, blob, {
        upsert: true,
        contentType: metadata.payload.mimeType || blob.type || 'application/octet-stream',
      });
      if (error) return { ok: false, error: error.message, imported: 0, uploadedFiles };
      metadata.payload.storagePath = path;
      uploadedFiles += 1;
    }
  }

  if (records.length === 0) return { ok: true, imported: 0, uploadedFiles };
  let imported = 0;
  for (let start = 0; start < records.length; start += batchSize) {
    const batch = records.slice(start, start + batchSize);
    const { error } = await client.from('school_records').upsert(batch, {
      onConflict: 'school_id,collection,record_id',
    });
    if (error) return { ok: false, error: error.message, imported, uploadedFiles };
    imported += batch.length;
  }
  return { ok: true, imported, uploadedFiles };
}