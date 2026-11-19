import { SupabaseRepository } from '../storage/SupabaseRepository.js';
import { getSupabaseClient } from './supabaseClient.js';

export async function loadInventoryWorkspace() {
  const [items, transactions, teachers] = await Promise.all([
    new SupabaseRepository('inventory').getAll(),
    new SupabaseRepository('inventoryTransactions').getAll(),
    new SupabaseRepository('teachers').getAll(),
  ]);
  return { items, transactions, teachers };
}

export function transactionsForItem(data, itemId) {
  return data.transactions
    .filter((transaction) => transaction.itemId === itemId)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export async function createInventoryItem(details) {
  return new SupabaseRepository('inventory').create(details, 'added inventory item');
}

export async function updateInventoryItem(id, details) {
  const items = await new SupabaseRepository('inventory').getAll();
  const existing = items.find((item) => item.id === id);
  if (!existing) throw new Error('This inventory item no longer exists.');
  if (Number(details.quantity) !== Number(existing.quantity)) throw new Error('Stock levels must be changed through Stock movements so the ledger remains accurate.');
  return new SupabaseRepository('inventory').update(id, { ...details, quantity: existing.quantity }, 'updated inventory item');
}

export async function removeInventoryItem(id) {
  const [items, transactions] = await Promise.all([
    new SupabaseRepository('inventory').getAll(),
    new SupabaseRepository('inventoryTransactions').getAll(),
  ]);
  if (!items.some((item) => item.id === id)) throw new Error('This inventory item no longer exists.');
  if (transactions.some((transaction) => transaction.itemId === id)) {
    throw new Error('This item has stock movement history. Keep it in the catalog; movement history is retained for audit.');
  }
  const client = await getSupabaseClient();
  const { error } = await client.rpc('remove_inventory_item', { target_item_id: id });
  if (error) throw error;
  return true;
}

export async function recordRemoteInventoryMovement(itemId, type, quantity, note) {
  const client = await getSupabaseClient();
  const { data, error } = await client.rpc('record_inventory_movement', {
    target_item_id: itemId,
    movement_type: type,
    movement_quantity: Number(quantity),
    movement_note: note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

export async function correctRemoteInventoryMovement(transactionId) {
  const data = await loadInventoryWorkspace();
  const movement = data.transactions.find((entry) => entry.id === transactionId);
  if (!movement) return { ok: false, error: 'This stock movement no longer exists.' };
  if (data.transactions.some((entry) => entry.note?.includes(`reversal of movement ${transactionId}`))) {
    return { ok: false, error: 'This movement has already been corrected.' };
  }
  return recordRemoteInventoryMovement(
    movement.itemId,
    movement.type === 'in' ? 'out' : 'in',
    movement.quantity,
    `Audited reversal of movement ${transactionId}`,
  );
}

export function lowStockRemote(items, threshold = 3) {
  return items.filter((item) => item.quantity <= threshold);
}