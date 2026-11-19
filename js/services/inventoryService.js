import { LocalStorageRepository } from '../storage/Repository.js';

export const inventoryItemRepo = new LocalStorageRepository('inventory', 'inventory item');
export const inventoryTransactionRepo = new LocalStorageRepository('inventoryTransactions', 'inventory transaction');

export const CATEGORIES = [
  ['furniture', 'Furniture'],
  ['electronics', 'Electronics'],
  ['books', 'Books & stationery'],
  ['sports', 'Sports equipment'],
  ['lab', 'Lab equipment'],
  ['kitchen', 'Kitchen & catering'],
  ['other', 'Other'],
];

export const CONDITIONS = [
  ['new', 'New'],
  ['good', 'Good'],
  ['fair', 'Fair'],
  ['poor', 'Poor'],
  ['damaged', 'Damaged'],
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function getTransactionsForItem(itemId) {
  return inventoryTransactionRepo.find((t) => t.itemId === itemId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function updateInventoryCatalogItem(id, details) {
  const item = inventoryItemRepo.getById(id);
  if (!item) throw new Error('This inventory item no longer exists.');
  if (Number(details.quantity) !== Number(item.quantity)) throw new Error('Stock levels must be changed through Stock movements so the ledger remains accurate.');
  return inventoryItemRepo.update(id, { ...details, quantity: item.quantity }, 'updated inventory item');
}

export function removeInventoryCatalogItem(id) {
  if (getTransactionsForItem(id).length) throw new Error('This item has stock movement history. Keep it in the catalog; movement history is retained for audit.');
  return inventoryItemRepo.remove(id, 'removed inventory item');
}

// Stock changes always go through here, never a direct quantity edit, so the
// transaction log and the item's running total can never drift apart.
export function stockIn(itemId, quantity, note) {
  const item = inventoryItemRepo.getById(itemId);
  if (!item || !quantity || quantity <= 0) return { ok: false, error: 'Enter a quantity greater than zero.' };
  inventoryItemRepo.update(itemId, { quantity: item.quantity + quantity }, `stocked in ${quantity} × ${item.name}`);
  inventoryTransactionRepo.create({ itemId, type: 'in', quantity, date: todayISO(), note: note || undefined });
  return { ok: true };
}

export function stockOut(itemId, quantity, note) {
  const item = inventoryItemRepo.getById(itemId);
  if (!item || !quantity || quantity <= 0) return { ok: false, error: 'Enter a quantity greater than zero.' };
  if (quantity > item.quantity) return { ok: false, error: `Only ${item.quantity} in stock — cannot remove ${quantity}.` };
  inventoryItemRepo.update(itemId, { quantity: item.quantity - quantity }, `stocked out ${quantity} × ${item.name}`);
  inventoryTransactionRepo.create({ itemId, type: 'out', quantity, date: todayISO(), note: note || undefined });
  return { ok: true };
}

export function correctStockMovement(transactionId) {
  const movement = inventoryTransactionRepo.getById(transactionId);
  if (!movement) return { ok: false, error: 'This stock movement no longer exists.' };
  if (inventoryTransactionRepo.getAll().some((entry) => entry.correctionOf === transactionId)) {
    return { ok: false, error: 'This movement has already been corrected.' };
  }
  const note = `Audited reversal of movement ${transactionId}`;
  const result = movement.type === 'in'
    ? stockOut(movement.itemId, Number(movement.quantity), note)
    : stockIn(movement.itemId, Number(movement.quantity), note);
  if (!result.ok) return result;
  const reversal = inventoryTransactionRepo.getAll().find((entry) => entry.itemId === movement.itemId && entry.note === note);
  if (reversal) inventoryTransactionRepo.update(reversal.id, { correctionOf: transactionId }, `linked correction of ${transactionId}`);
  return result;
}

export function lowStockItems(threshold = 3) {
  return inventoryItemRepo.getAll().filter((i) => i.quantity <= threshold);
}
