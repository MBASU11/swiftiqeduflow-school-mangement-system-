import { LocalStorageRepository } from '../storage/Repository.js';
import { StorageManager } from '../storage/StorageManager.js';
import { getSupabaseClient } from './supabaseClient.js';
import { SupabaseRepository } from '../storage/SupabaseRepository.js';

// Document metadata (name, category, links, size) lives in one collection;
// the file contents live in a SEPARATE collection behind `fileStore`. Two
// reasons: listing documents never has to parse big base64 blobs, and
// `fileStore` is the one seam to replace when large files should go to real
// cloud storage instead of the browser — nothing else in the app changes.
export const documentRepo = new LocalStorageRepository('documents', 'document');

export const CATEGORIES = [
  ['students', 'Students'],
  ['staff', 'Staff'],
  ['admissions', 'Admissions'],
  ['school', 'School documents'],
  ['certificates', 'Certificates'],
  ['reports', 'Reports'],
  ['policies', 'Policies'],
];

// Browser storage is small (roughly 5 MB total for everything), and base64
// makes files about a third larger, so keep single files modest.
export const MAX_FILE_BYTES = 750 * 1024;

const FILE_COLLECTION = 'documentFiles';

export const fileStore = {
  save(id, dataUrl) {
    StorageManager.set(FILE_COLLECTION, id, { id, dataUrl });
  },
  get(id) {
    return StorageManager.get(FILE_COLLECTION, id)?.dataUrl;
  },
  remove(id) {
    StorageManager.delete(FILE_COLLECTION, id);
  },
};

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Returns a human-readable problem with the chosen file, or null if it's fine.
export function validateUpload(file) {
  if (!file) return 'Choose a file to upload.';
  if (file.size > MAX_FILE_BYTES) {
    return `This file is ${formatBytes(file.size)}, which is too large to keep in this browser. Files up to ${formatBytes(MAX_FILE_BYTES)} are supported for now.`;
  }
  return null;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

// Creates the metadata record, then stores the file. If storing the file
// fails (e.g. browser storage is full) the metadata is rolled back so there
// is never a listed document whose file is missing.
export function addDocument({ name, category, description, fileName, mimeType, size, relatedStudentId, relatedStaffId, relatedAdmissionId }, dataUrl) {
  const record = documentRepo.create(
    { name, category, description, fileName, mimeType, size, relatedStudentId, relatedStaffId, relatedAdmissionId },
    `uploaded document ${name}`
  );
  try {
    fileStore.save(record.id, dataUrl);
  } catch (err) {
    documentRepo.remove(record.id);
    throw err;
  }
  return record;
}

export function removeDocument(id) {
  fileStore.remove(id);
  documentRepo.remove(id, 'removed document');
}

export function updateDocumentMetadata(id, metadata) {
  const document = documentRepo.getById(id);
  if (!document) throw new Error('This document no longer exists.');
  return documentRepo.update(id, {
    name: String(metadata.name ?? '').trim(),
    category: metadata.category,
    description: String(metadata.description ?? '').trim() || undefined,
    relatedStudentId: metadata.relatedStudentId || undefined,
    relatedStaffId: metadata.relatedStaffId || undefined,
  }, 'updated document metadata');
}

export function allDocuments() {
  return documentRepo.getAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getDocumentsForStudent(studentId) {
  return allDocuments().filter((d) => d.relatedStudentId === studentId);
}

export function totalBytesStored() {
  return documentRepo.getAll().reduce((sum, d) => sum + (d.size || 0), 0);
}

export function downloadDocument(id) {
  const doc = documentRepo.getById(id);
  const dataUrl = fileStore.get(id);
  if (!doc || !dataUrl) return false;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = doc.fileName || doc.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

export function addDocumentMetadata(metadata) {
  return documentRepo.create(metadata, `uploaded document ${metadata.name}`);
}

export async function uploadRemoteDocument({ schoolId, file, metadata }) {
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Files up to 20 MB are supported in cloud storage.');
  }
  const client = await getSupabaseClient();
  const { data: uploaded, error: uploadError } = await client.storage
    .from('school-documents')
    .upload(`${schoolId}/${metadata.id}/${file.name}`, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
  if (uploadError) throw uploadError;
  try {
    const { data, error } = await client.from('school_records').insert({
      collection: 'documents',
      record_id: metadata.id,
      payload: { ...metadata, storagePath: uploaded.path },
    }).select('payload').single();
    if (error) throw error;
    return data.payload;
  } catch (error) {
    await client.storage.from('school-documents').remove([uploaded.path]);
    throw error;
  }
}

export async function removeRemoteDocument(document) {
  const client = await getSupabaseClient();
  const path = document.storagePath;
  if (path) {
    const { error } = await client.storage.from('school-documents').remove([path]);
    if (error) throw error;
  }
  const { error } = await client.from('school_records').delete()
    .eq('collection', 'documents')
    .eq('record_id', document.id);
  if (error) throw error;
}

export async function updateRemoteDocumentMetadata(id, metadata) {
  const repository = new SupabaseRepository('documents');
  const document = await repository.getById(id);
  if (!document) throw new Error('This document no longer exists.');
  return repository.update(id, {
    name: String(metadata.name ?? '').trim(),
    category: metadata.category,
    description: String(metadata.description ?? '').trim() || undefined,
    relatedStudentId: metadata.relatedStudentId || undefined,
    relatedStaffId: metadata.relatedStaffId || undefined,
  }, 'updated document metadata');
}

export async function downloadRemoteDocument(document) {
  if (!document.storagePath) return false;
  const client = await getSupabaseClient();
  const { data, error } = await client.storage.from('school-documents').download(document.storagePath);
  if (error) throw error;
  const url = URL.createObjectURL(data);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = document.fileName || document.name;
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}
