document.addEventListener('DOMContentLoaded', async () => {
  await Auth.init();
  const user = Auth.requireAuth();
  if (!user) return;

  document.getElementById('nav-logout').addEventListener('click', Auth.logout);

  // ── State ──────────────────────────────────────────────────────────────────

  const params      = new URLSearchParams(window.location.search);
  let   filingId    = params.get('id');
  const isEditMode  = !!filingId;   // true when opening an existing filing
  let   filing      = null;
  let   seriesList = [];
  let   votePage  = 1;
  const voteLimit = 50;
  let   pendingDeleteVoteId = null;
  let   currentStep = 1;
  const TOTAL_STEPS = 4;

  // ── Elements ───────────────────────────────────────────────────────────────

  const globalError    = document.getElementById('global-error');
  const statusBadge    = document.getElementById('status-badge');
  const btnReturnDraft = document.getElementById('btn-return-draft');

  // ── Helpers ────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `alert alert-${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3500);
  }

  function showGlobalError(msg) {
    globalError.textContent = msg;
    globalError.classList.remove('hidden');
  }

  function setFieldsDisabled(disabled) {
    document.querySelectorAll('.step-panel .form-control').forEach((el) => {
      el.disabled = disabled;
    });
    ['btn-step1-save', 'btn-step1-exit', 'btn-step4-submit', 'btn-step4-exit',
    'btn-add-series', 'btn-add-vote', 'btn-clear-votes'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  function updateStatusUI() {
    if (!filing) return;
    const isComplete = filing.status === 'complete';
    statusBadge.textContent = filing.status;
    statusBadge.className   = `badge ${isComplete ? 'badge-complete' : 'badge-draft'}`;
    statusBadge.classList.remove('hidden');
    btnReturnDraft.classList.toggle('hidden', !isComplete);
    setFieldsDisabled(isComplete);
  }

  // ── Step navigation ────────────────────────────────────────────────────────

  function goToStep(n) {
    currentStep = Math.max(1, Math.min(TOTAL_STEPS, n));

    for (let i = 1; i <= TOTAL_STEPS; i++) {
      document.getElementById(`step-${i}`).classList.toggle('hidden', i !== currentStep);
    }

    document.querySelectorAll('.steps-trail .step').forEach((el) => {
      const s = parseInt(el.dataset.step, 10);
      el.classList.remove('active', 'completed');
      if (s === currentStep) {
        el.classList.add('active');
      } else if (s < currentStep || isEditMode) {
        // In edit mode all non-current steps appear completed (clickable)
        el.classList.add('completed');
      }
    });

    if (currentStep === 2 && filingId) loadSeries();
    if (currentStep === 3 && filingId) loadVotes(1);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.getElementById('steps-trail').addEventListener('click', (e) => {
    const stepEl = e.target.closest('.step');
    if (!stepEl) return;
    const n = parseInt(stepEl.dataset.step, 10);
    // In edit mode allow jumping to any step; in new-filing mode only allow completed/current
    if (isEditMode || stepEl.classList.contains('completed') || n === currentStep) goToStep(n);
  });

  // ── Load / populate filing ─────────────────────────────────────────────────

  function populateFiling(f) {
    filing = f;
    const displayName = f.filer_name || (isEditMode ? 'N-PX Filing' : 'New N-PX Filing');
    document.title = `Offaways — ${displayName}`;
    document.getElementById('page-title').textContent = displayName;

    // Show filing ID subtitle in edit mode
    const subtitleEl = document.getElementById('filing-id-subtitle');
    if (isEditMode && subtitleEl) {
      subtitleEl.textContent = `ID: ${f.id.slice(0, 8)}`;
      subtitleEl.classList.remove('hidden');
    }

    setVal('filer_type',       f.filer_type);
    setVal('report_type',      f.report_type);
    setVal('period_start',     fmtDate(f.period_start));
    setVal('period_end',       fmtDate(f.period_end));
    setVal('amendment_number', f.amendment_number);
    setVal('amendment_type',   f.amendment_type);
    setVal('filer_name',       f.filer_name);
    setVal('filer_cik',        f.filer_cik);
    setVal('filer_lei',        f.filer_lei);
    setVal('filer_crd',        f.filer_crd);
    setVal('filer_phone',      f.filer_phone);
    setVal('filer_street1',    f.filer_street1);
    setVal('filer_street2',    f.filer_street2);
    setVal('filer_city',       f.filer_city);
    setVal('filer_state',      f.filer_state);
    setVal('filer_zip',        f.filer_zip);
    setVal('filer_country',    f.filer_country || 'US');
    setVal('agent_name',       f.agent_name);
    setVal('agent_street1',    f.agent_street1);
    setVal('agent_street2',    f.agent_street2);
    setVal('agent_city',       f.agent_city);
    setVal('agent_state',      f.agent_state);
    setVal('agent_zip',        f.agent_zip);
    setVal('agent_country',    f.agent_country || 'US');
    setVal('agent_phone',      f.agent_phone);
    setVal('signatory_name',   f.signatory_name);
    setVal('signatory_title',  f.signatory_title);
    setVal('signature_date',   fmtDate(f.signature_date));

    toggleAmendmentFields();
    toggleSeriesNotice();
    updateStatusUI();
  }

  function setVal(name, val) {
    const el = document.querySelector(`[name="${name}"]`);
    if (el && val != null) el.value = val;
  }

  function fmtDate(d) {
    if (!d) return '';
    return d.slice(0, 10);
  }

  function toggleAmendmentFields() {
    const rt = document.getElementById('f-report-type').value;
    document.getElementById('amendment-fields').style.display = rt === 'NPX-A' ? '' : 'none';
  }

  function toggleSeriesNotice() {
    const ft = document.getElementById('f-filer-type').value;
    document.getElementById('series-im-notice').classList.toggle('hidden', ft !== 'IM');
    document.getElementById('series-content').style.display = ft === 'IM' ? 'none' : '';
  }

  document.getElementById('f-report-type').addEventListener('change', toggleAmendmentFields);
  document.getElementById('f-filer-type').addEventListener('change', toggleSeriesNotice);

  // ── Generic field save ─────────────────────────────────────────────────────

  async function saveFields(fieldNames, btn, successMsg) {
    if (!filingId) {
      showToast('Filing not ready yet — please wait.', 'error');
      return false;
    }
    const payload = {};
    fieldNames.forEach((name) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (el) payload[name] = el.value.trim() || null;
    });

    const origHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';

    try {
      filing = await API.put(`/filings/${filingId}`, payload);
      populateFiling(filing);
      if (successMsg) showToast(successMsg);
      return true;
    } catch (err) {
      showToast(err.message, 'error');
      return false;
    } finally {
      btn.disabled = false;
      btn.innerHTML = origHTML;
    }
  }

  // ── Step buttons (registered early so they always work) ────────────────────

  const COVER_FIELDS = [
    'filer_type', 'report_type', 'period_start', 'period_end',
    'amendment_number', 'amendment_type',
    'filer_name', 'filer_cik', 'filer_lei', 'filer_crd', 'filer_phone',
    'filer_street1', 'filer_street2', 'filer_city', 'filer_state',
    'filer_zip', 'filer_country',
    'agent_name', 'agent_street1', 'agent_street2', 'agent_city',
    'agent_state', 'agent_zip', 'agent_country', 'agent_phone',
  ];
  const SIG_FIELDS = ['signatory_name', 'signatory_title', 'signature_date'];

  document.getElementById('btn-step1-exit').addEventListener('click', async (e) => {
    const ok = await saveFields(COVER_FIELDS, e.currentTarget, null);
    if (ok) window.location.href = '/index.html';
  });
  document.getElementById('btn-step1-save').addEventListener('click', async (e) => {
    const ok = await saveFields(COVER_FIELDS, e.currentTarget, 'Cover page saved.');
    if (ok) goToStep(2);
  });

  document.getElementById('btn-step2-back').addEventListener('click', () => goToStep(1));
  document.getElementById('btn-step2-exit').addEventListener('click', () => { window.location.href = '/index.html'; });
  document.getElementById('btn-step2-next').addEventListener('click', () => goToStep(3));

  document.getElementById('btn-step3-back').addEventListener('click', () => goToStep(2));
  document.getElementById('btn-step3-exit').addEventListener('click', () => { window.location.href = '/index.html'; });
  document.getElementById('btn-step3-next').addEventListener('click', () => goToStep(4));

  document.getElementById('btn-step4-back').addEventListener('click', () => goToStep(3));
  document.getElementById('btn-step4-exit').addEventListener('click', async (e) => {
    const ok = await saveFields(SIG_FIELDS, e.currentTarget, null);
    if (ok) window.location.href = '/index.html';
  });

  // ── Submit Filing (save signature → mark complete) ─────────────────────────

  function openSubmitModal() {
    document.getElementById('submit-modal-error').classList.add('hidden');
    document.getElementById('submit-modal').classList.remove('hidden');
  }
  function closeSubmitModal() {
    document.getElementById('submit-modal').classList.add('hidden');
  }

  document.getElementById('btn-step4-submit').addEventListener('click', openSubmitModal);
  document.getElementById('btn-submit-cancel').addEventListener('click', closeSubmitModal);
  document.getElementById('submit-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('submit-modal')) closeSubmitModal();
  });

  document.getElementById('btn-submit-confirm').addEventListener('click', async () => {
    const btn    = document.getElementById('btn-submit-confirm');
    const errEl  = document.getElementById('submit-modal-error');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Submitting…';
    errEl.classList.add('hidden');

    try {
      // 1. Save signature fields first
      const payload = {};
      SIG_FIELDS.forEach((name) => {
        const el = document.querySelector(`[name="${name}"]`);
        if (el) payload[name] = el.value.trim() || null;
      });
      await API.put(`/filings/${filingId}`, payload);

      // 2. Mark complete
      filing = await API.put(`/filings/${filingId}/status`, { status: 'complete' });
      closeSubmitModal();
      populateFiling(filing);
      showToast('Filing submitted successfully.');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit Filing';
    }
  });

  // ── Status transitions ─────────────────────────────────────────────────────

  btnReturnDraft.addEventListener('click', async () => {
    btnReturnDraft.disabled = true;
    btnReturnDraft.innerHTML = '<span class="spinner"></span>';
    try {
      filing = await API.put(`/filings/${filingId}/status`, { status: 'draft' });
      populateFiling(filing);
      showToast('Filing returned to draft.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnReturnDraft.disabled = false;
      btnReturnDraft.textContent = 'Return to Draft';
    }
  });

  // ── Series ─────────────────────────────────────────────────────────────────

  async function loadSeries() {
    if (!filingId) return;
    try {
      seriesList = await API.get(`/filings/${filingId}/series`);
      renderSeries();
    } catch (err) {
      showToast('Could not load series: ' + err.message, 'error');
    }
  }

  function renderSeries() {
    const tbody = document.getElementById('series-tbody');
    const empty = document.getElementById('series-empty');
    tbody.innerHTML = '';
    if (!seriesList.length) { empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    seriesList.forEach((s) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(s.series_id || '—')}</td>
        <td>${esc(s.series_name || '—')}</td>
        <td>${esc(s.series_lei || '—')}</td>
        <td class="actions-cell">
          <button class="btn btn-sm btn-secondary" data-edit-series="${s.id}">Edit</button>
          <button class="btn btn-sm btn-danger"    data-delete-series="${s.id}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  let editingSeriesId = null;

  function openSeriesModal(series = null) {
    editingSeriesId = series ? series.id : null;
    document.getElementById('series-modal-title').textContent = series ? 'Edit Series' : 'Add Series';
    document.getElementById('sm-series-id').value   = series?.series_id   || '';
    document.getElementById('sm-series-name').value = series?.series_name || '';
    document.getElementById('sm-series-lei').value  = series?.series_lei  || '';
    document.getElementById('series-modal-error').classList.add('hidden');
    document.getElementById('series-modal').classList.remove('hidden');
  }

  function closeSeriesModal() {
    document.getElementById('series-modal').classList.add('hidden');
    editingSeriesId = null;
  }

  document.getElementById('btn-add-series').addEventListener('click', () => openSeriesModal());
  document.getElementById('btn-series-cancel').addEventListener('click', closeSeriesModal);
  document.getElementById('series-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('series-modal')) closeSeriesModal();
  });
  document.getElementById('series-tbody').addEventListener('click', (e) => {
    const editId   = e.target.dataset.editSeries;
    const deleteId = e.target.dataset.deleteSeries;
    if (editId)   { const s = seriesList.find((x) => x.id === editId); if (s) openSeriesModal(s); }
    if (deleteId) deleteSeries(deleteId);
  });
  document.getElementById('btn-series-save').addEventListener('click', async () => {
    const btn   = document.getElementById('btn-series-save');
    const errEl = document.getElementById('series-modal-error');
    const payload = {
      series_id:   document.getElementById('sm-series-id').value.trim()   || null,
      series_name: document.getElementById('sm-series-name').value.trim() || null,
      series_lei:  document.getElementById('sm-series-lei').value.trim()  || null,
    };
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    errEl.classList.add('hidden');
    try {
      if (editingSeriesId) {
        await API.put(`/filings/${filingId}/series/${editingSeriesId}`, payload);
      } else {
        await API.post(`/filings/${filingId}/series`, payload);
      }
      closeSeriesModal();
      await loadSeries();
      showToast('Series saved.');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  async function deleteSeries(id) {
    if (!confirm('Delete this series?')) return;
    try {
      await API.delete(`/filings/${filingId}/series/${id}`);
      await loadSeries();
      showToast('Series deleted.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ── Proxy Votes ────────────────────────────────────────────────────────────

  async function loadVotes(page) {
    if (!filingId) return;
    votePage = page;
    const loadingEl = document.getElementById('votes-loading');
    const emptyEl   = document.getElementById('votes-empty');
    const paginEl   = document.getElementById('votes-pagination');
    loadingEl.classList.remove('hidden');
    emptyEl.classList.add('hidden');
    try {
      const data = await API.get(`/filings/${filingId}/votes?page=${page}&limit=${voteLimit}`);
      renderVotes(data);
      renderPagination(data, paginEl);
    } catch (err) {
      showToast('Could not load votes: ' + err.message, 'error');
    } finally {
      loadingEl.classList.add('hidden');
    }
  }

  function renderVotes(data) {
    const tbody   = document.getElementById('votes-tbody');
    const emptyEl = document.getElementById('votes-empty');
    tbody.innerHTML = '';
    if (!data.votes.length) { emptyEl.classList.remove('hidden'); return; }
    emptyEl.classList.add('hidden');
    data.votes.forEach((v) => {
      const howVoted = (v.vote_records || []).map((r) => r.how_voted).filter(Boolean).join(', ') || '—';
      const shares   = (v.vote_records || []).reduce((sum, r) => sum + (parseFloat(r.shares) || 0), 0);
      const tr       = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(v.issuer_name || '—')}</td>
        <td>${esc(v.cusip || '—')}</td>
        <td>${v.meeting_date ? new Date(v.meeting_date).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '—'}</td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(v.vote_description || '—')}</td>
        <td>${esc(howVoted)}</td>
        <td>${shares ? shares.toLocaleString() : '—'}</td>
        <td class="actions-cell">
          <button class="btn btn-sm btn-secondary" data-edit-vote="${v.id}">Edit</button>
          <button class="btn btn-sm btn-danger"    data-delete-vote="${v.id}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
  }

  function renderPagination(data, el) {
    el.innerHTML = '';
    if (data.pages <= 1) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const prev = document.createElement('button');
    prev.className = 'btn btn-secondary btn-sm';
    prev.textContent = '← Prev';
    prev.disabled = data.page <= 1;
    prev.addEventListener('click', () => loadVotes(data.page - 1));
    el.appendChild(prev);
    const info = document.createElement('span');
    info.className = 'pagination-info';
    info.textContent = `Page ${data.page} of ${data.pages} (${data.total} votes)`;
    el.appendChild(info);
    const next = document.createElement('button');
    next.className = 'btn btn-secondary btn-sm';
    next.textContent = 'Next →';
    next.disabled = data.page >= data.pages;
    next.addEventListener('click', () => loadVotes(data.page + 1));
    el.appendChild(next);
  }

  let editingVoteId = null;

  function openVoteModal(vote = null) {
    editingVoteId = vote ? vote.id : null;
    document.getElementById('vote-modal-title').textContent = vote ? 'Edit Proxy Vote' : 'Add Proxy Vote';
    document.getElementById('vm-issuer-name').value     = vote?.issuer_name      || '';
    document.getElementById('vm-cusip').value            = vote?.cusip             || '';
    document.getElementById('vm-isin').value             = vote?.isin              || '';
    document.getElementById('vm-figi').value             = vote?.figi              || '';
    document.getElementById('vm-meeting-date').value     = fmtDate(vote?.meeting_date);
    document.getElementById('vm-meeting-type').value     = vote?.meeting_type      || '';
    document.getElementById('vm-vote-description').value = vote?.vote_description  || '';
    document.getElementById('vm-vote-source').value      = vote?.vote_source        || '';
    document.getElementById('vm-vote-category').value    = vote?.vote_category      || '';
    document.getElementById('vm-shares-voted').value     = vote?.shares_voted       ?? '';
    document.getElementById('vm-shares-on-loan').value   = vote?.shares_on_loan     ?? '';
    const container = document.getElementById('vote-records-container');
    container.innerHTML = '';
    const records = vote?.vote_records || [];
    if (records.length) records.forEach((r) => addVoteRecordRow(r));
    else addVoteRecordRow();
    document.getElementById('vote-modal-error').classList.add('hidden');
    document.getElementById('vote-modal').classList.remove('hidden');
  }

  function closeVoteModal() {
    document.getElementById('vote-modal').classList.add('hidden');
    editingVoteId = null;
  }

  function addVoteRecordRow(rec = {}) {
    const container = document.getElementById('vote-records-container');
    const div       = document.createElement('div');
    div.className   = 'vote-record-row';
    div.innerHTML   = `
      <div class="form-row" style="align-items:flex-end;gap:.5rem;">
        <div class="form-group">
          <label class="form-label">How Voted</label>
          <select class="form-control vr-how-voted">
            <option value="">— select —</option>
            <option value="for">For</option>
            <option value="against">Against</option>
            <option value="abstain">Abstain</option>
            <option value="withhold">Withhold</option>
            <option value="not_voted">Not Voted</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Mgmt Rec.</label>
          <select class="form-control vr-mgmt-rec">
            <option value="">— select —</option>
            <option value="for">For</option>
            <option value="against">Against</option>
            <option value="abstain">Abstain</option>
            <option value="withhold">Withhold</option>
            <option value="none">None</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Shares</label>
          <input class="form-control vr-shares" type="number" min="0" step="0.0001" />
        </div>
        <button type="button" class="btn btn-ghost btn-sm vr-remove" style="margin-bottom:.35rem;">✕</button>
      </div>`;
    div.querySelector('.vr-how-voted').value = rec.how_voted           || '';
    div.querySelector('.vr-mgmt-rec').value  = rec.mgmt_recommendation || '';
    div.querySelector('.vr-shares').value    = rec.shares               ?? '';
    div.querySelector('.vr-remove').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  document.getElementById('btn-add-record').addEventListener('click', () => addVoteRecordRow());
  document.getElementById('btn-add-vote').addEventListener('click', () => openVoteModal());
  document.getElementById('btn-vote-cancel').addEventListener('click', closeVoteModal);
  document.getElementById('vote-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('vote-modal')) closeVoteModal();
  });

  document.getElementById('votes-tbody').addEventListener('click', async (e) => {
    const editId   = e.target.dataset.editVote;
    const deleteId = e.target.dataset.deleteVote;
    if (editId) {
      try {
        const data = await API.get(`/filings/${filingId}/votes?page=1&limit=1000`);
        const vote = data.votes.find((v) => v.id === editId);
        if (vote) openVoteModal(vote);
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
    if (deleteId) openDeleteVoteModal(deleteId);
  });

  document.getElementById('btn-vote-save').addEventListener('click', async () => {
    const btn   = document.getElementById('btn-vote-save');
    const errEl = document.getElementById('vote-modal-error');
    const records = [];
    document.querySelectorAll('.vote-record-row').forEach((row, i) => {
      records.push({
        how_voted:           row.querySelector('.vr-how-voted').value || null,
        mgmt_recommendation: row.querySelector('.vr-mgmt-rec').value  || null,
        shares:              parseFloat(row.querySelector('.vr-shares').value) || null,
        sort_order:          i,
      });
    });
    const payload = {
      issuer_name:      document.getElementById('vm-issuer-name').value.trim()     || null,
      cusip:            document.getElementById('vm-cusip').value.trim()             || null,
      isin:             document.getElementById('vm-isin').value.trim()              || null,
      figi:             document.getElementById('vm-figi').value.trim()              || null,
      meeting_date:     document.getElementById('vm-meeting-date').value             || null,
      meeting_type:     document.getElementById('vm-meeting-type').value             || null,
      vote_description: document.getElementById('vm-vote-description').value.trim() || null,
      vote_source:      document.getElementById('vm-vote-source').value.trim()       || null,
      vote_category:    document.getElementById('vm-vote-category').value.trim()     || null,
      shares_voted:     parseFloat(document.getElementById('vm-shares-voted').value)   || null,
      shares_on_loan:   parseFloat(document.getElementById('vm-shares-on-loan').value) || null,
      vote_records:     records,
    };
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    errEl.classList.add('hidden');
    try {
      if (editingVoteId) {
        await API.put(`/filings/${filingId}/votes/${editingVoteId}`, payload);
      } else {
        await API.post(`/filings/${filingId}/votes`, payload);
      }
      closeVoteModal();
      await loadVotes(votePage);
      showToast('Vote saved.');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  function openDeleteVoteModal(id) {
    pendingDeleteVoteId = id;
    document.getElementById('delete-vote-modal').classList.remove('hidden');
  }
  function closeDeleteVoteModal() {
    pendingDeleteVoteId = null;
    document.getElementById('delete-vote-modal').classList.add('hidden');
  }
  document.getElementById('btn-delete-vote-cancel').addEventListener('click', closeDeleteVoteModal);
  document.getElementById('delete-vote-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('delete-vote-modal')) closeDeleteVoteModal();
  });
  document.getElementById('btn-delete-vote-confirm').addEventListener('click', async () => {
    if (!pendingDeleteVoteId) return;
    const btn = document.getElementById('btn-delete-vote-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await API.delete(`/filings/${filingId}/votes/${pendingDeleteVoteId}`);
      closeDeleteVoteModal();
      await loadVotes(votePage);
      showToast('Vote deleted.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Delete';
    }
  });

  document.getElementById('btn-clear-votes').addEventListener('click', () => {
    document.getElementById('clear-modal').classList.remove('hidden');
  });
  document.getElementById('btn-clear-cancel').addEventListener('click', () => {
    document.getElementById('clear-modal').classList.add('hidden');
  });
  document.getElementById('clear-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('clear-modal')) {
      document.getElementById('clear-modal').classList.add('hidden');
    }
  });
  document.getElementById('btn-clear-confirm').addEventListener('click', async () => {
    const btn = document.getElementById('btn-clear-confirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
      await API.delete(`/filings/${filingId}/votes`);
      document.getElementById('clear-modal').classList.add('hidden');
      await loadVotes(1);
      showToast('All votes cleared.');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Clear All';
    }
  });

  document.getElementById('csv-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const result = await API.post(`/filings/${filingId}/votes/import`, { csv: ev.target.result });
        await loadVotes(1);
        showToast(`Imported ${result.imported} vote(s).`);
      } catch (err) {
        showToast('CSV import failed: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('btn-download-template').addEventListener('click', () => {
    const cols = [
      'issuer_name', 'cusip', 'isin', 'figi',
      'meeting_date', 'meeting_type',
      'vote_description', 'vote_source', 'vote_category',
      'shares_voted', 'shares_on_loan',
      'how_voted', 'mgmt_recommendation', 'shares',
    ];
    const blob = new Blob([cols.join(',') + '\n'], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'npx-votes-template.csv'; a.click();
    URL.revokeObjectURL(url);
  });

  // ── Init (runs last so all listeners are registered first) ─────────────────

  async function init() {
    try {
      if (!filingId) {
        filing  = await API.post('/filings', { filer_type: 'RMIC', report_type: 'NPX' });
        filingId = filing.id;
        history.replaceState({}, '', `/filing.html?id=${filingId}`);
      } else {
        filing = await API.get(`/filings/${filingId}`);
      }
      populateFiling(filing);
    } catch (err) {
      showGlobalError('Could not load filing: ' + err.message);
    }
    goToStep(1);
  }

  await init();
});
