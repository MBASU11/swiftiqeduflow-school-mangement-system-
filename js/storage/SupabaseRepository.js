import { uuid } from '../lib/uuid.js';
import { getSupabaseClient } from '../services/supabaseClient.js';

// Async counterpart to LocalStorageRepository. Postgres RLS derives the active
// school from the authenticated user; callers cannot supply a tenant ID.
export class SupabaseRepository {
  constructor(collection) {
    this.collection = collection;
  }

  async getAll() {
    const client = await getSupabaseClient();
    const records = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from('school_records')
        .select('payload')
        .eq('collection', this.collection)
        .order('record_id')
        .range(offset, offset + 999);
      if (error) throw error;
      records.push(...data.map((row) => row.payload));
      if (data.length < 1000) return records;
    }
  }

  async getById(id) {
    const client = await getSupabaseClient();
    const { data, error } = await client.from('school_records')
      .select('payload')
      .eq('collection', this.collection)
      .eq('record_id', id)
      .maybeSingle();
    if (error) throw error;
    return data?.payload;
  }

  async find(predicate) {
    return (await this.getAll()).filter(predicate);
  }

  async create(data) {
    const client = await getSupabaseClient();
    const now = new Date().toISOString();
    const payload = { ...data, id: uuid(), createdAt: now, updatedAt: now };
    const { error } = await client.from('school_records').insert({
      collection: this.collection,
      record_id: payload.id,
      payload,
    });
    if (error) throw error;
    return payload;
  }

  // Bulk insert in batches (imports). Honors a pre-assigned `id`.
  async createMany(items) {
    const client = await getSupabaseClient();
    if (this.collection === 'students') {
      // Refuse the WHOLE import up front rather than failing half-way. The database trigger
      // still enforces the limit row by row, so this is only for a clean, early message.
      const { data: room, error: roomError } = await client.rpc('check_enrolment', { adding: items.length });
      if (!roomError && room && room.allowed === false) {
        throw new Error(`Your school has reached its maximum permitted population of ${room.limits?.max} students. Please upgrade your subscription or contact SwiftIQ EduFlow support to request additional capacity. (This import would add up to ${items.length}; ${room.active} are active now. Nothing was imported.)`);
      }
    }
    const now = new Date().toISOString();
    const payloads = items.map((data) => ({ ...data, id: data.id ?? uuid(), createdAt: now, updatedAt: now }));
    for (let i = 0; i < payloads.length; i += 200) {
      const batch = payloads.slice(i, i + 200).map((payload) => ({ collection: this.collection, record_id: payload.id, payload }));
      const { error } = await client.from('school_records').insert(batch);
      if (error) throw error;
    }
    return payloads;
  }

  async update(id, patch) {
    const client = await getSupabaseClient();
    const existing = await this.getById(id);
    if (!existing) return undefined;
    const payload = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    const { data, error } = await client.from('school_records')
      .update({ payload, updated_at: payload.updatedAt })
      .eq('collection', this.collection)
      .eq('record_id', id)
      .select('payload')
      .maybeSingle();
    if (error) throw error;
    return data?.payload;
  }

  async remove(id) {
    const client = await getSupabaseClient();
    const { data, error } = await client.from('school_records')
      .delete()
      .eq('collection', this.collection)
      .eq('record_id', id)
      .select('record_id');
    if (error) throw error;
    return data.length > 0;
  }
}