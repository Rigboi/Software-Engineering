'use strict';
(async () => {
  const $ = id => document.getElementById(id);
  const signup = document.body.dataset.authMode === 'signup';
  function message(text) { $('message').hidden = false; $('message').textContent = text; }
  function destination() {
    const value = new URLSearchParams(location.search).get('returnTo') || '/';
    // Only known component pages may be used as login destinations.
    return /^\/pages\/(Asset-Management|Asset-Borrowing|Asset-Returns|Storage-Management|Warranty-Report|Maintennance-schedule)\/[a-zA-Z0-9-]+\.html(?:\?[^\r\n]*)?$/.test(value) ? value : '/';
  }
  async function api(path, body) {
    const response = await fetch('/api/auth/' + path, { credentials: 'same-origin', cache: 'no-store',
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
    return data;
  }
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    if (response.ok) {
      const { user } = await response.json();
      if (!signup || user.role !== 'admin') { location.replace(destination()); return; }
      $('auth-form').hidden = true; $('login-link').hidden = true; $('invite-panel').hidden = false;
      $('heading').textContent = 'Invite a staff member'; $('intro').textContent = `Signed in as ${user.name}.`;
      $('create-invite').addEventListener('click', async () => {
        $('create-invite').disabled = true;
        try { const data = await api('invitations', {}); $('invite-code').hidden = false; $('code-label').hidden = false;
          $('invite-code').value = data.invitationCode; $('invite-expiry').textContent = 'Expires ' + new Date(data.expiresAt).toLocaleString();
        } catch (error) { message(error.message); } finally { $('create-invite').disabled = false; }
      }); return;
    }
    if (signup) {
      const status = await api('status'); $('invitation-field').hidden = !status.requiresInvitation;
      $('invitation').required = status.requiresInvitation;
      if (!status.requiresInvitation) { $('heading').textContent = 'Set up WJC MITS'; $('intro').textContent = 'Create the first administrator account. You can then invite the rest of your team.'; }
      $('submit').disabled = false;
    }
  } catch { message('Unable to connect. Check that the application server is running, then refresh.'); if (signup) return; }
  $('auth-form').addEventListener('submit', async event => {
    event.preventDefault(); $('message').hidden = true;
    if (signup && $('password').value !== $('confirmation').value) { message('The passwords do not match.'); $('confirmation').focus(); return; }
    $('submit').disabled = true;
    try {
      const body = { email: $('email').value.trim(), password: $('password').value };
      if (signup) Object.assign(body, { name: $('name').value.trim(), invitationCode: $('invitation').value.trim() });
      await api(signup ? 'signup' : 'login', body);
      location.replace(destination());
    } catch (error) { message(error.message); $('submit').disabled = false; }
  });
})();
