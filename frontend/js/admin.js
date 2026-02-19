document.addEventListener('DOMContentLoaded', async () => {
  await Auth.init();
  const user = Auth.requireAuth();
  if (!user) return;
  if (!Auth.isAdmin()) {
    window.location.href = '/index.html';
    return;
  }

  // ── Navbar ────────────────────────────────────────────────────────────────

  document.getElementById('nav-logout').addEventListener('click', Auth.logout);

  // ── State ─────────────────────────────────────────────────────────────────

  let users = [];

  // ── Load users ────────────────────────────────────────────────────────────

  const usersLoading = document.getElementById('users-loading');
  const usersTbody   = document.getElementById('users-tbody');
  const usersEmpty   = document.getElementById('users-empty');

  async function loadUsers() {
    usersLoading.classList.remove('hidden');
    usersTbody.innerHTML = '';
    usersEmpty.classList.add('hidden');
    usersTbody.closest('table').classList.add('hidden');

    try {
      users = await API.get('/admin/users');
      renderUsers();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      usersLoading.classList.add('hidden');
      usersTbody.closest('table').classList.remove('hidden');
    }
  }

  function renderUsers() {
    usersTbody.innerHTML = '';
    if (!users.length) {
      usersEmpty.classList.remove('hidden');
      return;
    }
    usersEmpty.classList.add('hidden');

    users.forEach((u) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(u.email)}</td>
        <td>${esc(u.first_name)} ${esc(u.last_name)}</td>
        <td><span class="badge badge-${u.role}">${u.role}</span></td>
        <td><span class="badge badge-${u.is_active ? 'active' : 'inactive'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>${u.filing_count}</td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td class="actions-cell">
          <a href="/user.html?id=${u.id}" class="btn btn-sm btn-secondary">Edit</a>
          <button class="btn btn-sm btn-danger"
                  data-delete-user="${u.id}"
                  ${u.id === user.id ? 'disabled' : ''}>
            Delete
          </button>
        </td>`;
      usersTbody.appendChild(tr);
    });
  }

  // ── Table actions ─────────────────────────────────────────────────────────

  usersTbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;

    if (btn.dataset.deleteUser) await deleteUser(btn.dataset.deleteUser);
  });

  async function deleteUser(id) {
    if (!confirm('Permanently delete this user and all their filings?')) return;
    try {
      await API.delete(`/admin/users/${id}`);
      showToast('User deleted.');
      await loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── New user ──────────────────────────────────────────────────────────────

  document.getElementById('btn-new-user').addEventListener('click', () => {
    window.location.href = '/user.html';
  });

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `alert alert-${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
  }

  // ── Utils ─────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  await loadUsers();
});
