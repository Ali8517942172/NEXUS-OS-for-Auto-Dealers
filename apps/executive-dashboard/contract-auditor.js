// n8n KYC/AML Document Auditor — n8n on the GCP VM (https://35.224.126.225.nip.io)
const WEBHOOK_URL = String(import.meta.env.VITE_N8N_BASE_URL || "").trim() + "/webhook/audit-kyc";

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileChip = document.getElementById('fileChip');
const fileNameEl = document.getElementById('fileName');
const clearFile = document.getElementById('clearFile');
const submitBtn = document.getElementById('submitBtn');
const results = document.getElementById('results');
const errorMsg = document.getElementById('errorMsg');
const refNum = document.getElementById('refNum');

let selectedFile = null;
refNum.textContent = 'REF-' + Math.random().toString(36).slice(2, 8).toUpperCase();

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  if (e.dataTransfer.files.length) setFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) setFile(fileInput.files[0]);
});
clearFile.addEventListener('click', e => {
  e.stopPropagation();
  selectedFile = null;
  fileChip.classList.remove('show');
  submitBtn.disabled = true;
  results.classList.remove('show');
});

function setFile(file) {
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileChip.classList.add('show');
  submitBtn.disabled = false;
  errorMsg.style.display = 'none';
}

submitBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Auditing…';
  errorMsg.style.display = 'none';
  results.classList.remove('show');

  const formData = new FormData();
  formData.append('data', selectedFile);

  try {
    const res = await fetch(WEBHOOK_URL, { method: 'POST', body: formData });
    const data = await res.json();
    renderResults(data);
  } catch (err) {
    errorMsg.textContent = 'Could not reach the audit service. Please try again.';
    errorMsg.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Run Audit';
  }
});

function renderResults(data) {
  if (data.status === 'error') {
    errorMsg.textContent = data.message || 'Could not read this document. Try a clearer photo.';
    errorMsg.style.display = 'block';
    return;
  }

  const stampEl = document.getElementById('stampEl');
  const hidden = data.hidden_fee_aed || 0;
  stampEl.className = 'stamp ' + (hidden > 0 ? 'flag' : 'ok');
  stampEl.textContent = hidden > 0 ? '⚠ Discrepancy Found' : '✓ Verified Clean';

  const lineItemsEl = document.getElementById('lineItems');
  lineItemsEl.innerHTML = '';
  (data.line_items || []).forEach(li => {
    const row = document.createElement('div');
    row.className = 'line-item';
    row.innerHTML = `<span>${li.label}</span><span class="amt">AED ${li.amount_aed}</span>`;
    lineItemsEl.appendChild(row);
  });

  document.getElementById('chargedVal').textContent = 'AED ' + (data.registration_fee_charged_aed ?? '—');
  document.getElementById('officialVal').textContent = 'AED ' + (data.official_rta_fee_aed ?? '—');

  const verdictBox = document.getElementById('verdictBox');
  verdictBox.className = 'verdict ' + (hidden > 0 ? 'flag' : 'ok');
  verdictBox.textContent = data.alert || '';

  results.classList.add('show');
}
