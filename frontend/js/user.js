document.addEventListener('DOMContentLoaded', async () => {
  await Auth.init();
  const user = Auth.requireAuth();
  if (!user) return;
  if (!Auth.isAdmin()) {
    window.location.href = '/index.html';
    return;
  }

  document.getElementById('nav-logout').addEventListener('click', Auth.logout);

  const form        = document.getElementById('user-form');
  const formError   = document.getElementById('form-error');
  const btnSave     = document.getElementById('btn-save');
  const pageTitle   = document.getElementById('page-title');
  const passwordInput    = document.getElementById('u-password');
  const passwordRequired = document.getElementById('password-required');
  const passwordHint     = document.getElementById('password-hint');
  const activeGroup      = document.getElementById('active-group');

  const params  = new URLSearchParams(window.location.search);
  const editId  = params.get('id');
  const isEdit  = !!editId;

  // ── Edit mode setup ──────────────────────────────────────────────────────────

  if (isEdit) {
    pageTitle.textContent   = 'Edit User';
    btnSave.textContent     = 'Save Changes';
    passwordRequired.classList.add('hidden');
    passwordHint.classList.remove('hidden');
    activeGroup.classList.remove('hidden');

    try {
      const u = await API.get(`/admin/users/${editId}`);
      form.querySelector('[name=first_name]').value = u.first_name || '';
      form.querySelector('[name=last_name]').value  = u.last_name  || '';
      form.querySelector('[name=email]').value      = u.email      || '';
      form.querySelector('[name=role]').value       = u.role       || 'user';
      form.querySelector('[name=is_active]').value  = String(u.is_active !== false);
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
      btnSave.disabled = true;
    }
  } else {
    passwordInput.required = true;
  }

  // ── Submit ───────────────────────────────────────────────────────────────────

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.add('hidden');

    const password = form.querySelector('[name=password]').value;

    const payload = {
      email:      form.querySelector('[name=email]').value.trim(),
      first_name: form.querySelector('[name=first_name]').value.trim(),
      last_name:  form.querySelector('[name=last_name]').value.trim(),
      role:       form.querySelector('[name=role]').value,
    };

    if (isEdit) {
      payload.is_active = form.querySelector('[name=is_active]').value === 'true';
      if (password) payload.password = password;
    } else {
      payload.password = password;
    }

    btnSave.disabled = true;
    btnSave.innerHTML = `<span class="spinner"></span> ${isEdit ? 'Saving…' : 'Creating…'}`;

    try {
      if (isEdit) {
        await API.put(`/admin/users/${editId}`, payload);
      } else {
        await API.post('/admin/users', payload);
      }
      window.location.href = '/admin.html';
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
      btnSave.disabled = false;
      btnSave.textContent = isEdit ? 'Save Changes' : 'Create User';
    }
  });
});
