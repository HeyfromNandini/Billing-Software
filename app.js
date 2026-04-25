/**
 * Billing app – Transport entries, auto total, PDF export
 * Logic: Total = Rate (flat per trip), Balance = Total - Advance
 */

(function () {
  'use strict';

  const DEFAULT_ROUTE = { from: 'Kalamboli', to: 'Khopoli' };

  let entries = [
    { id: 1, date: '2026-01-04', vehicle_number: 'MH46 AU 5188', invoice_number: '2227', from: 'Kalamboli', to: 'Khopoli', weight: 21830, rate: 8000, advance: 0 },
    { id: 2, date: '2026-01-05', vehicle_number: '', invoice_number: '8548', from: '', to: '', weight: 25480, rate: 8000, advance: 0 },
    { id: 3, date: '2026-01-06', vehicle_number: '', invoice_number: '8595', from: '', to: '', weight: 26280, rate: 9500, advance: 0 },
    { id: 4, date: '2026-01-07', vehicle_number: '', invoice_number: '2245', from: '', to: '', weight: 24240, rate: 9500, advance: 0 },
    { id: 5, date: '2026-01-09', vehicle_number: '', invoice_number: '8649', from: '', to: '', weight: 27420, rate: 8000, advance: 0 },
    { id: 6, date: '2026-01-12', vehicle_number: '', invoice_number: '2257', from: '', to: '', weight: 23420, rate: 8000, advance: 0 },
    { id: 7, date: '2026-01-17', vehicle_number: '', invoice_number: '8743', from: '', to: '', weight: 24930, rate: 8000, advance: 0 },
    { id: 8, date: '2026-01-21', vehicle_number: '', invoice_number: '2286', from: '', to: '', weight: 24420, rate: 8000, advance: 0 },
    { id: 9, date: '2026-01-21', vehicle_number: '', invoice_number: '8064', from: '', to: '', weight: 24705, rate: 8000, advance: 0 },
    { id: 10, date: '2026-01-22', vehicle_number: '', invoice_number: '8833', from: '', to: '', weight: 24580, rate: 8000, advance: 0 },
    { id: 11, date: '2026-01-25', vehicle_number: '', invoice_number: '26280', from: '', to: '', weight: 26280, rate: 8000, advance: 0 },
    { id: 12, date: '2026-01-28', vehicle_number: '', invoice_number: '2306', from: '', to: '', weight: 23370, rate: 8000, advance: 0 },
  ];

  let nextId = 13;
  let editingId = null;

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const tbody = $('#transport-tbody');
  const grandTotalEl = $('#grand-total');
  const modal = $('#entry-modal');
  const form = $('#entry-form');
  const modalTitle = $('#modal-title');
  const routeFrom = $('#route-from');
  const routeTo = $('#route-to');

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${day}.${m}`;
  }

  function total(row) {
    return row.rate || 0;
  }

  function balance(row) {
    return (row.rate || 0) - (row.advance || 0);
  }

  function renderRow(row, index) {
    const tot = total(row);
    const bal = balance(row);
    const advanceStr = row.advance ? String(row.advance) : '—';
    return `
      <tr data-id="${row.id}">
        <td class="num">${index + 1}</td>
        <td>${formatDate(row.date)}</td>
        <td>${row.vehicle_number || '—'}</td>
        <td>${row.invoice_number}</td>
        <td>${row.from || '—'}</td>
        <td>${row.to || '—'}</td>
        <td class="num">${row.weight || '—'}</td>
        <td class="num">${row.rate}</td>
        <td class="num">${tot}</td>
        <td class="num">${advanceStr}</td>
        <td class="num">${bal}</td>
        <td class="no-print">
          <div class="row-actions">
            <button type="button" class="btn-edit" aria-label="Edit">Edit</button>
            <span class="row-actions-sep" aria-hidden="true">|</span>
            <button type="button" class="btn-delete" aria-label="Delete">Delete</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderTable() {
    tbody.innerHTML = entries.map((row, i) => renderRow(row, i)).join('');
    const sum = entries.reduce((acc, r) => acc + balance(r), 0);
    grandTotalEl.textContent = '₹ ' + sum.toLocaleString('en-IN');

    $$('.btn-edit', tbody).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.closest('tr').dataset.id);
        openModal(id);
      });
    });
    $$('.btn-delete', tbody).forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.closest('tr').dataset.id);
        if (confirm('Remove this entry?')) deleteEntry(id);
      });
    });
  }

  function deleteEntry(id) {
    entries = entries.filter(e => e.id !== id);
    renderTable();
  }

  function openModal(id = null) {
    editingId = id;
    modal.setAttribute('aria-hidden', 'false');
    modalTitle.textContent = id ? 'Edit transport entry' : 'Add transport entry';
    form.querySelector('[name="entry_id"]').value = id || '';

    if (id) {
      const row = entries.find(e => e.id === id);
      if (row) {
        form.querySelector('[name="date"]').value = row.date || '';
        form.querySelector('[name="vehicle_number"]').value = row.vehicle_number || '';
        form.querySelector('[name="invoice_number"]').value = row.invoice_number || '';
        form.querySelector('[name="from"]').value = row.from || '';
        form.querySelector('[name="to"]').value = row.to || '';
        form.querySelector('[name="weight"]').value = row.weight || '';
        form.querySelector('[name="rate"]').value = row.rate || '';
        form.querySelector('[name="advance"]').value = row.advance || '';
      }
    } else {
      form.reset();
      form.querySelector('[name="advance"]').value = '0';
      form.querySelector('[name="from"]').value = DEFAULT_ROUTE.from;
      form.querySelector('[name="to"]').value = DEFAULT_ROUTE.to;
    }
  }

  function closeModal() {
    modal.setAttribute('aria-hidden', 'true');
    editingId = null;
  }

  function saveEntry(payload) {
    const advance = Number(payload.advance) || 0;
    const row = {
      date: payload.date,
      vehicle_number: (payload.vehicle_number || '').trim(),
      invoice_number: (payload.invoice_number || '').trim(),
      from: (payload.from || '').trim(),
      to: (payload.to || '').trim(),
      weight: Number(payload.weight) || 0,
      rate: Number(payload.rate) || 0,
      advance,
    };

    if (editingId) {
      const i = entries.findIndex(e => e.id === editingId);
      if (i !== -1) entries[i] = { ...entries[i], ...row };
    } else {
      entries.push({ id: nextId++, ...row });
    }
    renderTable();
    closeModal();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    saveEntry(Object.fromEntries(fd.entries()));
  });

  $('#btn-add-entry').addEventListener('click', () => openModal(null));
  $('.btn-cancel', modal).addEventListener('click', closeModal);
  $('.modal-backdrop', modal).addEventListener('click', closeModal);

  $('#btn-export-pdf').addEventListener('click', () => {
    window.print();
  });

  // Optional: mobile menu
  $('.menu-btn').addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });

  renderTable();
})();
