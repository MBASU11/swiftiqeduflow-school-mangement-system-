import { escapeHtml } from './dom.js';

export function emptyState({ title, body, actionsHtml, iconHtml }) {
  return `
    <div class="empty-state">
      ${iconHtml ? `<div class="icon">${iconHtml}</div>` : ''}
      <h3>${escapeHtml(title)}</h3>
      ${body ? `<p>${escapeHtml(body)}</p>` : ''}
      ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ''}
    </div>
  `;
}

export function modulePlaceholder(moduleName) {
  return `
    <div class="card">
      ${emptyState({
        title: `${moduleName} is coming in the next phase`,
        body: 'The storage layer and navigation are already wired up for this module — it just hasn\'t been built yet.',
      })}
    </div>
  `;
}
