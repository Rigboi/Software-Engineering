'use strict';
(async () => {
  const login = () => location.replace('/login?returnTo=' + encodeURIComponent(location.pathname + location.search));
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const target = new URL(typeof args[0] === 'string' ? args[0] : args[0].url, location.href);
    if (target.origin === location.origin && target.pathname.startsWith('/api/') && response.status === 401) login();
    return response;
  };
  try {
    const response = await originalFetch('/api/auth/me', { cache: 'no-store' });
    if (!response.ok) { login(); return; }
    const { user } = await response.json();
    window.dispatchEvent(new CustomEvent('wjc-session-ready', { detail: user }));
    const menu = document.querySelector('#wjc-navigation .wjc-nav-links');
    if (menu) {
      const name = document.createElement('span'); name.className = 'wjc-account-name'; name.textContent = user.name; menu.append(name);
      if (user.role === 'admin') { const invite = document.createElement('a'); invite.href = '/signup'; invite.textContent = 'Invite staff'; menu.append(invite); }
      const logout = document.createElement('button'); logout.type = 'button'; logout.className = 'wjc-logout'; logout.textContent = 'Log out';
      logout.addEventListener('click', async () => {
        logout.disabled = true;
        try { const result = await originalFetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          if (!result.ok) throw new Error('Logout failed'); location.replace('/login');
        } catch { logout.disabled = false; logout.textContent = 'Retry logout'; }
      }); menu.append(logout);
    }
    // Extend the server session only on actual user activity, at most once a minute.
    let activeAt = Date.now(), refreshedAt = Date.now();
    const activity = () => {
      activeAt = Date.now();
      if (activeAt - refreshedAt >= 60000) { refreshedAt = activeAt; window.fetch('/api/auth/me', { cache: 'no-store' }).catch(() => {}); }
    };
    for (const event of ['pointerdown', 'keydown', 'scroll']) document.addEventListener(event, activity, { passive: true });
    setInterval(() => { if (Date.now() - activeAt >= 15 * 60000) login(); }, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - activeAt >= 15 * 60000) login(); });
    window.addEventListener('pageshow', event => { if (event.persisted) window.fetch('/api/auth/me', { cache: 'no-store' }).catch(() => {}); });
  } catch {
    const note = document.createElement('p'); note.setAttribute('role', 'alert');
    note.textContent = 'Your account could not be checked. Refresh the page when the server is available.';
    document.body.prepend(note);
  }
})();
