document.addEventListener('DOMContentLoaded', async () => {
  await Auth.init();
  const user = Auth.requireAuth();
  if (!user) return;

  document.getElementById('nav-logout').addEventListener('click', Auth.logout);

  const params    = new URLSearchParams(window.location.search);
  const editingId = params.get('id');

  const form      = document.getElementById('filing-form');
  const formError = document.getElementById('form-error');
  const pageTitle = document.getElementById('page-title');
  const btnSave   = document.getElementById('btn-save');

  // ── Load existing filing when editing ─────────────────────────────────────

  if (editingId) {
    pageTitle.textContent = 'Edit Filing';
    document.title = 'Offaways — Edit Filing';

    try {
      const filing = await API.get(`/filings/${editingId}`);
      form.querySelector('[name=first_name]').value     = filing.first_name;
      form.querySelector('[name=last_name]').value      = filing.last_name;
      form.querySelector('[name=street_address]').value = filing.street_address;
      form.querySelector('[name=city]').value           = filing.city;
      form.querySelector('[name=state]').value          = filing.state;
      form.querySelector('[name=zip_code]').value       = filing.zip_code;
      form.querySelector('[name=country]').value        = filing.country;
      form.querySelector('[name=annual_salary]').value  = filing.annual_salary;
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.add('hidden');

    const payload = {
      first_name:     form.querySelector('[name=first_name]').value.trim(),
      last_name:      form.querySelector('[name=last_name]').value.trim(),
      street_address: form.querySelector('[name=street_address]').value.trim(),
      city:           form.querySelector('[name=city]').value.trim(),
      state:          form.querySelector('[name=state]').value.trim(),
      zip_code:       form.querySelector('[name=zip_code]').value.trim(),
      country:        form.querySelector('[name=country]').value.trim() || 'US',
      annual_salary:  parseFloat(form.querySelector('[name=annual_salary]').value),
    };

    btnSave.disabled = true;
    btnSave.innerHTML = '<span class="spinner"></span> Saving…';

    try {
      if (editingId) {
        await API.put(`/filings/${editingId}`, payload);
      } else {
        await API.post('/filings', payload);
      }
      window.location.href = '/index.html';
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
      btnSave.disabled = false;
      btnSave.textContent = 'Save';
    }
  });
});
