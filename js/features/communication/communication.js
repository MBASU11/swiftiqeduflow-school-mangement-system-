import { qs } from '../../components/dom.js';
import { renderAnnouncements } from './announcements.js';
import { renderMessages } from './messages.js';

export function renderCommunication(container) {
  let tab = 'announcements';

  function render() {
    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex justify-between items-center flex-wrap gap-3">
          <h1 class="text-xl" style="font-weight:600;">Communication</h1>
          <div class="pill-group">
            <button class="pill ${tab === 'announcements' ? 'active' : ''}" id="tab-announcements">Announcements</button>
            <button class="pill ${tab === 'messages' ? 'active' : ''}" id="tab-messages">Messages</button>
          </div>
        </div>
        <div id="comm-body"></div>
      </div>
    `;

    qs(container, '#tab-announcements').addEventListener('click', () => { tab = 'announcements'; render(); });
    qs(container, '#tab-messages').addEventListener('click', () => { tab = 'messages'; render(); });

    const body = qs(container, '#comm-body');
    if (tab === 'announcements') renderAnnouncements(body);
    else renderMessages(body);
  }

  render();
}
