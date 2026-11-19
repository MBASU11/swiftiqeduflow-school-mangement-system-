import { qs } from '../../components/dom.js';
import { renderItemsManager } from './itemsManager.js';
import { renderStockMovements } from './stockMovements.js';

export function renderInventory(container) {
  let tab = 'items';

  function render() {
    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Inventory</h1>
          <div class="pill-group">
            <button class="pill ${tab === 'items' ? 'active' : ''}" id="tab-items">Items</button>
            <button class="pill ${tab === 'movements' ? 'active' : ''}" id="tab-movements">Stock Movements</button>
          </div>
        </div>
        <div id="inventory-body"></div>
      </div>
    `;

    qs(container, '#tab-items').addEventListener('click', () => { tab = 'items'; render(); });
    qs(container, '#tab-movements').addEventListener('click', () => { tab = 'movements'; render(); });

    const body = qs(container, '#inventory-body');
    if (tab === 'items') renderItemsManager(body);
    else renderStockMovements(body);
  }

  render();
}
