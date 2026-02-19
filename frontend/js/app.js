document.addEventListener('DOMContentLoaded', async () => {
  await Auth.init();
  const user = Auth.requireAuth();
  if (!user) return;

  // ── Navbar ────────────────────────────────────────────────────────────────

  document.getElementById('nav-logout').addEventListener('click', Auth.logout);

  // ── State ─────────────────────────────────────────────────────────────────

  let filings = [];

  // ── Elements ──────────────────────────────────────────────────────────────

  const tbody       = document.getElementById('filings-tbody');
  const emptyState  = document.getElementById('empty-state');
  const loadingState= document.getElementById('loading-state');
  const deleteModal = document.getElementById('delete-modal');

  // ── Load filings ───────────────────────────────────────────────────────────

  async function load() {
    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');
    tbody.innerHTML = '';

    try {
      filings = await API.get('/filings');
      render();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      loadingState.classList.add('hidden');
    }
  }

  // ── Render table ──────────────────────────────────────────────────────────

  function statusBadge(status) {
    const cls = status === 'complete' ? 'badge-complete' : 'badge-draft';
    return `<span class="badge ${cls}">${esc(status)}</span>`;
  }

  function render() {
    tbody.innerHTML = '';
    if (!filings.length) {
      emptyState.classList.remove('hidden');
      return;
    }
    emptyState.classList.add('hidden');

    filings.forEach((f) => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td style="font-family:monospace;font-size:.8rem;">${esc(f.id.slice(0, 8))}</td>
        <td>${esc(f.report_type || 'N-PX')}</td>
        <td>${statusBadge(f.status)}</td>
        <td>${new Date(f.created_at).toLocaleDateString()}</td>
        <td class="actions-cell">
          <button class="btn btn-sm btn-secondary" data-edit="${f.id}">Edit</button>
          <button class="btn btn-sm btn-danger"    data-delete="${f.id}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });

  }

  // ── Table click delegation ────────────────────────────────────────────────

  tbody.addEventListener('click', (e) => {
    const editId   = e.target.dataset.edit;
    const deleteId = e.target.dataset.delete;

    if (editId)   window.location.href = `/filing.html?id=${editId}`;
    if (deleteId) openDeleteModal(deleteId);
  });

  // ── New filing ────────────────────────────────────────────────────────────

  document.getElementById('btn-new').addEventListener('click', () => {
    window.location.href = '/new-filing.html';
  });

  // ── Delete modal ──────────────────────────────────────────────────────────

  let pendingDeleteId = null;

  function openDeleteModal(id) {
    pendingDeleteId = id;
    deleteModal.classList.remove('hidden');
  }

  function closeDeleteModal() {
    pendingDeleteId = null;
    deleteModal.classList.add('hidden');
  }

  document.getElementById('btn-delete-cancel').addEventListener('click', closeDeleteModal);
  deleteModal.addEventListener('click', (e) => { if (e.target === deleteModal) closeDeleteModal(); });

  document.getElementById('btn-delete-confirm').addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    const btn = document.getElementById('btn-delete-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      await API.delete(`/filings/${pendingDeleteId}`);
      showToast('Filing deleted.');
      closeDeleteModal();
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Delete';
    }
  });

  // ── Toast ─────────────────────────────────────────────────────────────────

  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `alert alert-${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  await load();
});
