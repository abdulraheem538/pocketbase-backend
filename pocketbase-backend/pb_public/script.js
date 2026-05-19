let pbUrl = '';
let pbConnected = false;
let allStudents = [];
let selectedFiles = [];
let currentVoucher = null;
let allPayments = [];

const PB_PORT = '8091';

function getDefaultPbUrl() {
  if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
    return window.location.origin;
  }
  return localStorage.getItem('pbUrl') || `http://127.0.0.1:${PB_PORT}`;
}

function isLocalHost() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1';
}

async function detectLocalNetworkIp() {
  if (!window.RTCPeerConnection) return null;
  return new Promise((resolve) => {
    let resolved = false;
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('');
    pc.onicecandidate = (e) => {
      if (!e?.candidate?.candidate || resolved) return;
      const match = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(e.candidate.candidate);
      if (match && !match[1].startsWith('127.') && !match[1].startsWith('169.254.')) {
        resolved = true;
        resolve(match[1]);
        pc.close();
      }
    };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => resolve(null));
    setTimeout(() => { if (!resolved) { pc.close(); resolve(null); } }, 2500);
  });
}

async function updateNetworkHint() {
  const el = document.getElementById('pb-network-hint');
  if (!el) return;

  if (!isLocalHost()) {
    el.style.display = 'none';
    return;
  }

  const ip = await detectLocalNetworkIp();
  const port = window.location.port || PB_PORT;
  const networkUrl = ip ? `http://${ip}:${port}` : `http://YOUR_PC_IP:${port}`;
  el.innerHTML = `📱 <strong>Phone / tablet:</strong> use the same Wi‑Fi, then open <code>${networkUrl}</code> in the browser.`;
  el.style.display = 'block';
}

// ── PocketBase ──────────────────────────────────────
async function connectPocketBase() {
  pbUrl = document.getElementById('pb-url').value.trim().replace(/\/$/, '');
  try {
    const res = await fetch(pbUrl + '/api/health', { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      pbConnected = true;
      localStorage.setItem('pbUrl', pbUrl);
      setStatus('Connected to PocketBase', 'connected');
      toast('Connected to PocketBase!', 'success');
      await ensureCollection();
      loadStudents();
      loadPaymentHistory();
    } else throw new Error();
  } catch {
    pbConnected = false;
    setStatus('Cannot connect — is PocketBase running?', 'error');
    toast('Connection failed. Is PocketBase running?', 'error');
  }
}

async function ensureCollection() {
  // PocketBase auto-creates collections via API if using admin, otherwise use UI
  // Here we just check if collection exists
  try {
    await fetch(pbUrl + '/api/collections/students/records?perPage=1');
  } catch {}
}

function setStatus(msg, type) {
  document.getElementById('pb-status-text').textContent = msg;
  const dot = document.getElementById('pb-dot');
  dot.className = 'pb-dot' + (type ? ' ' + type : '');
}

// ── Fee Calc ────────────────────────────────────────
function calcFee() {
  const base = parseFloat(document.getElementById('base-fee').value) || 0;
  const pct = parseFloat(document.getElementById('discount-pct').value) || 0;
  const discAmt = Math.round(base * pct / 100);
  document.getElementById('discount-amt').value = discAmt || '';
  updateFeeDisplay(base, discAmt);
}
function calcFeeFromAmt() {
  const base = parseFloat(document.getElementById('base-fee').value) || 0;
  const discAmt = parseFloat(document.getElementById('discount-amt').value) || 0;
  const pct = base > 0 ? Math.round(discAmt / base * 100) : 0;
  document.getElementById('discount-pct').value = pct || '';
  updateFeeDisplay(base, discAmt);
}
function updateFeeDisplay(base, disc) {
  const net = base - disc;
  document.getElementById('display-base').textContent = 'PKR ' + base.toLocaleString();
  document.getElementById('display-discount').textContent = '- PKR ' + disc.toLocaleString();
  document.getElementById('display-net').textContent = 'PKR ' + net.toLocaleString();
}

// ── File Upload ─────────────────────────────────────
function handleFiles(input) {
  Array.from(input.files).forEach(f => selectedFiles.push(f));
  renderFileList();
}
function renderFileList() {
  const el = document.getElementById('file-list');
  el.innerHTML = selectedFiles.map((f, i) =>
    `<div class="file-chip"><span>${f.name}</span><span class="remove" onclick="removeFile(${i})">×</span></div>`
  ).join('');
}
function removeFile(i) { selectedFiles.splice(i, 1); renderFileList(); }

/** Next STD-0001 style number: max existing STD-nnnn + 1 (ignores bad/old ids). */
async function getNextStudentSerial(pbBaseUrl) {
  let max = 0;
  let page = 1;
  let totalPages = 1;
  do {
    const res = await fetch(
      `${pbBaseUrl}/api/collections/students/records?perPage=500&page=${page}&fields=student_id`
    );
    if (!res.ok) break;
    const data = await res.json();
    totalPages = data.totalPages || 1;
    for (const r of data.items || []) {
      const m = /^STD-(\d+)$/i.exec(String(r.student_id || '').trim());
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    page++;
  } while (page <= totalPages);
  return max + 1;
}

// ── Save Student ────────────────────────────────────
async function saveStudent() {
  const name = document.getElementById('full-name').value.trim();
  const contact = document.getElementById('contact').value.trim();
  const baseFee = parseFloat(document.getElementById('base-fee').value) || 0;
  if (!name) { toast('Please enter student name', 'error'); return; }
  if (!contact) { toast('Please enter contact number', 'error'); return; }
  if (!baseFee) { toast('Please enter base fee', 'error'); return; }

  const discAmt = parseFloat(document.getElementById('discount-amt').value) || 0;
  const studentData = {
    full_name: name,
    father_name: document.getElementById('father-name').value.trim(),
    dob: document.getElementById('dob').value,
    gender: document.getElementById('gender').value,
    contact: contact,
    email: document.getElementById('email').value.trim(),
    address: document.getElementById('address').value.trim(),
    class_name: document.getElementById('class-name').value.trim(),
    program: document.getElementById('program').value.trim(),
    cnic: document.getElementById('cnic').value.trim(),
    prev_school: document.getElementById('prev-school').value.trim(),
    enrollment_date: document.getElementById('enrollment-date').value || new Date().toISOString().split('T')[0],
    base_fee: baseFee,
    discount_pct: parseFloat(document.getElementById('discount-pct').value) || 0,
    discount_amt: discAmt,
    net_fee: baseFee - discAmt,
    fee_notes: document.getElementById('fee-notes').value.trim(),
  };

  if (!pbConnected) {
    // Save locally in localStorage as fallback
    const students = JSON.parse(localStorage.getItem('students') || '[]');
    const id = 'STD-' + String(students.length + 1).padStart(4, '0');
    studentData.student_id = id;
    studentData.id = id;
    students.push(studentData);
    localStorage.setItem('students', JSON.stringify(students));
    document.getElementById('student-id-display').textContent = id;
    toast('Saved locally (PocketBase not connected): ' + id, 'success');
    allStudents = students;
    return;
  }

  try {
    const formData = new FormData();
    Object.entries(studentData).forEach(([k, v]) => formData.append(k, v));
    selectedFiles.forEach(f => formData.append('documents', f));
 
    const res = await fetch(pbUrl + '/api/collections/students/records', {
      method: 'POST', body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Save failed');

    const serial = await getNextStudentSerial(pbUrl);
    const sid = 'STD-' + String(serial).padStart(4, '0');
    const patchRes = await fetch(pbUrl + '/api/collections/students/records/' + data.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: sid })
    });
    if (!patchRes.ok) {
      const errBody = await patchRes.json().catch(() => ({}));
      throw new Error(errBody.message || 'Could not assign student ID');
    }
    document.getElementById('student-id-display').textContent = sid;
    toast('Student registered: ' + sid, 'success');
    loadStudents();
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ── Load Students ───────────────────────────────────
async function loadStudents() {
  if (!pbConnected) {
    allStudents = JSON.parse(localStorage.getItem('students') || '[]');
  } else {
    try {
      const res = await fetch(pbUrl + '/api/collections/students/records?perPage=500&sort=-created');
      const data = await res.json();
      allStudents = data.items || [];
    } catch { allStudents = JSON.parse(localStorage.getItem('students') || '[]'); }
  }
  renderStudentTable();
}

function renderStudentTable() {
  const q = (document.getElementById('search-input').value || '').toLowerCase();
  const filtered = allStudents.filter(s =>
    !q || (s.full_name||'').toLowerCase().includes(q) ||
    (s.student_id||'').toLowerCase().includes(q) ||
    (s.class_name||'').toLowerCase().includes(q) ||
    (s.contact||'').toLowerCase().includes(q)
  );
  const wrap = document.getElementById('student-table-wrap');
  if (!filtered.length) {
    wrap.innerHTML = '<div class="empty-state">No students found.</div>'; return;
  }
  wrap.innerHTML = `<table class="student-table">
    <thead><tr>
      <th>ID</th><th>Name</th><th>Father</th><th>Class</th><th>Contact</th><th>Net Fee</th><th>Actions</th>
    </tr></thead>
    <tbody>${filtered.map(s => `<tr>
      <td><span class="id-tag">${s.student_id || s.id}</span></td>
      <td><strong>${s.full_name || ''}</strong></td>
      <td>${s.father_name || ''}</td>
      <td>${s.class_name || ''}</td>
      <td>${s.contact || ''}</td>
      <td>PKR ${(s.net_fee || 0).toLocaleString()}</td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openVoucherForStudent('${s.student_id || s.id}')">Voucher</button>
      </td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function openVoucherForStudent(sid) {
  switchPage('voucher');
  document.getElementById('voucher-student-id').value = sid;
  fetchStudentForVoucher();
}

// ── Fee payments (persist paid status) ─────────────
function buildVoucherNo(studentId, month, year) {
  return 'VCH-' + String(studentId).replace('STD-', '') + '-' + month.slice(0, 3).toUpperCase() + String(year).slice(-2);
}

function paymentKey(studentId, month, year) {
  return `${studentId}|${month}|${year}`;
}

function getLocalPayments() {
  return JSON.parse(localStorage.getItem('feePayments') || '[]');
}

function saveLocalPayment(record) {
  const payments = getLocalPayments();
  const key = paymentKey(record.student_id, record.month, record.year);
  const idx = payments.findIndex(p => paymentKey(p.student_id, p.month, p.year) === key);
  if (idx >= 0) payments[idx] = { ...payments[idx], ...record };
  else payments.push(record);
  localStorage.setItem('feePayments', JSON.stringify(payments));
  allPayments = payments;
}

function findPayment(studentId, month, year) {
  const key = paymentKey(studentId, month, year);
  return allPayments.find(p => paymentKey(p.student_id, p.month, String(p.year)) === key);
}

async function loadPaymentHistory() {
  const local = getLocalPayments();
  if (!pbConnected) {
    allPayments = local;
  } else {
    try {
      const res = await fetch(pbUrl + '/api/collections/fee_payments/records?perPage=500&sort=-paid_at,-created');
      if (res.ok) {
        const remote = (await res.json()).items || [];
        const merged = new Map();
        for (const p of [...local, ...remote]) {
          const key = paymentKey(p.student_id, p.month, String(p.year));
          const existing = merged.get(key);
          if (!existing || ((p.status || '').toLowerCase() === 'paid' && (existing.status || '').toLowerCase() !== 'paid')) {
            merged.set(key, p);
          }
        }
        allPayments = Array.from(merged.values());
      } else {
        allPayments = local;
      }
    } catch {
      allPayments = local;
    }
  }
  renderPaymentHistory();
}

function renderPaymentHistory() {
  const wrap = document.getElementById('payment-history-wrap');
  if (!wrap) return;

  const q = (document.getElementById('payment-search-input')?.value || '').toLowerCase();
  const filtered = allPayments.filter(p => {
    if (!q) return true;
    return (p.student_id || '').toLowerCase().includes(q) ||
      (p.student_name || '').toLowerCase().includes(q) ||
      (p.month || '').toLowerCase().includes(q) ||
      (p.voucher_no || '').toLowerCase().includes(q);
  });

  if (!filtered.length) {
    wrap.innerHTML = '<div class="empty-state">No payment records yet. Mark a voucher as paid to see it here.</div>';
    return;
  }

  wrap.innerHTML = `<table class="student-table">
    <thead><tr>
      <th>Student ID</th><th>Name</th><th>Month</th><th>Voucher No.</th><th>Amount</th><th>Status</th><th>Paid On</th><th></th>
    </tr></thead>
    <tbody>${filtered.map(p => {
      const isPaid = (p.status || '').toLowerCase() === 'paid';
      const paidOn = p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
      return `<tr>
        <td><span class="id-tag">${p.student_id || ''}</span></td>
        <td><strong>${p.student_name || ''}</strong></td>
        <td>${p.month || ''} ${p.year || ''}</td>
        <td style="font-family:monospace;font-size:0.82rem">${p.voucher_no || ''}</td>
        <td>PKR ${(p.amount || 0).toLocaleString()}</td>
        <td><span class="badge ${isPaid ? 'badge-paid' : 'badge-pending'}">${isPaid ? '✓ Paid' : 'Pending'}</span></td>
        <td>${paidOn}</td>
        <td><button class="btn btn-sm btn-outline" onclick="openVoucherFromPayment('${p.student_id}', '${p.month}', ${p.year})">View</button></td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function openVoucherFromPayment(studentId, month, year) {
  document.getElementById('voucher-student-id').value = studentId;
  document.getElementById('voucher-month').value = month;
  document.getElementById('voucher-year').value = year;
  fetchStudentForVoucher();
  document.getElementById('voucher-output')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setVoucherStatusBadge(status) {
  const badge = document.getElementById('voucher-status-badge');
  const markBtn = document.getElementById('mark-paid-btn');
  const paidStamp = document.getElementById('v-paid-stamp');
  const isPaid = status === 'paid';
  badge.className = 'badge ' + (isPaid ? 'badge-paid' : 'badge-pending');
  badge.textContent = isPaid ? '✓ Paid' : 'Pending';
  if (paidStamp) paidStamp.style.display = isPaid ? 'inline-block' : 'none';
  if (markBtn) {
    markBtn.disabled = isPaid;
    markBtn.textContent = isPaid ? 'Already Paid' : 'Mark as Paid';
  }
}

async function savePaymentRecord(record) {
  saveLocalPayment(record);

  if (!pbConnected) return record;

  try {
    const filter = encodeURIComponent(
      `(student_id='${record.student_id}' && month='${record.month}' && year=${record.year})`
    );
    const existingRes = await fetch(pbUrl + `/api/collections/fee_payments/records?filter=${filter}&perPage=1`);
    if (existingRes.status === 404) return record;

    const existingData = await existingRes.json();
    const existing = existingData.items && existingData.items[0];

    const payload = {
      student_id: record.student_id,
      student_name: record.student_name,
      month: record.month,
      year: Number(record.year),
      voucher_no: record.voucher_no,
      status: record.status,
      amount: record.amount,
      paid_at: record.paid_at || ''
    };

    let res;
    if (existing) {
      res = await fetch(pbUrl + '/api/collections/fee_payments/records/' + existing.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetch(pbUrl + '/api/collections/fee_payments/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) return record;
    const data = await res.json();
    saveLocalPayment({ ...record, id: data.id });
    return data;
  } catch {
    return record;
  }
}

// ── Voucher ─────────────────────────────────────────
async function fetchStudentForVoucher() {
  const sid = document.getElementById('voucher-student-id').value.trim();
  if (!sid) { toast('Enter a Student ID', 'error'); return; }

  let student = allStudents.find(s => (s.student_id || s.id) === sid);

  if (!student && pbConnected) {
    try {
      const res = await fetch(pbUrl + `/api/collections/students/records?filter=(student_id='${sid}')`);
      const data = await res.json();
      student = data.items && data.items[0];
    } catch {}
  }

  if (!student) { toast('Student not found: ' + sid, 'error'); return; }

  const month = document.getElementById('voucher-month').value;
  const year = document.getElementById('voucher-year').value;
  const today = new Date();
  const dueDate = new Date(today.getFullYear(), today.getMonth() + 1, 10);
  const voucherNo = buildVoucherNo(student.student_id || student.id, month, year);
  const netFee = student.net_fee || student.base_fee || 0;

  document.getElementById('v-student-id').textContent = student.student_id || student.id;
  document.getElementById('v-name').textContent = student.full_name || '';
  document.getElementById('v-father').textContent = student.father_name || '';
  document.getElementById('v-class').textContent = [student.class_name, student.program].filter(Boolean).join(' — ');
  document.getElementById('v-month').textContent = month + ' ' + year;
  document.getElementById('v-issue-date').textContent = today.toLocaleDateString('en-PK', {day:'2-digit',month:'short',year:'numeric'});
  document.getElementById('v-due-date').textContent = dueDate.toLocaleDateString('en-PK', {day:'2-digit',month:'short',year:'numeric'});
  document.getElementById('v-voucher-no').textContent = voucherNo;
  document.getElementById('v-base-fee').textContent = 'PKR ' + (student.base_fee || 0).toLocaleString();
  document.getElementById('v-discount').textContent = '- PKR ' + (student.discount_amt || 0).toLocaleString();
  document.getElementById('v-net-fee').textContent = 'PKR ' + netFee.toLocaleString();
  if (student.fee_notes) {
    document.getElementById('v-notes-row').style.display = '';
    document.getElementById('v-notes-label').textContent = '📌 ' + student.fee_notes;
  } else {
    document.getElementById('v-notes-row').style.display = 'none';
  }

  currentVoucher = {
    student_id: student.student_id || student.id,
    student_name: student.full_name || '',
    month,
    year: Number(year),
    voucher_no: voucherNo,
    amount: netFee
  };

  await loadPaymentHistory();
  const payment = findPayment(currentVoucher.student_id, month, year);
  const status = payment && (payment.status || '').toLowerCase() === 'paid' ? 'paid' : 'pending';
  currentVoucher.status = status;
  currentVoucher.paid_at = payment?.paid_at || '';

  document.getElementById('voucher-output').style.display = 'block';
  setVoucherStatusBadge(status);
}

async function markPaid() {
  if (!currentVoucher) {
    toast('Generate a voucher first', 'error');
    return;
  }
  if (currentVoucher.status === 'paid') {
    toast('This voucher is already marked as paid', 'error');
    return;
  }

  const paidAt = new Date().toISOString().split('T')[0];
  try {
    await savePaymentRecord({
      ...currentVoucher,
      status: 'paid',
      paid_at: paidAt
    });
    currentVoucher.status = 'paid';
    currentVoucher.paid_at = paidAt;
    setVoucherStatusBadge('paid');
    await loadPaymentHistory();
    toast('Voucher marked as paid', 'success');
  } catch (e) {
    toast('Error: ' + e.message, 'error');
  }
}

// ── Utilities ───────────────────────────────────────
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn')[['registration','voucher','students'].indexOf(name)].classList.add('active');
  if (name === 'students') loadStudents();
  if (name === 'voucher') loadPaymentHistory();
}

function clearForm() {
  ['full-name','father-name','dob','contact','email','address','class-name','program','cnic','prev-school','base-fee','discount-pct','discount-amt','fee-notes','enrollment-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('gender').value = '';
  document.getElementById('student-id-display').textContent = 'Will be assigned on save';
  selectedFiles = [];
  renderFileList();
  updateFeeDisplay(0, 0);
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  setTimeout(() => el.className = '', 3200);
}

// ── Init ─────────────────────────────────────────────
window.onload = async () => {
  document.getElementById('enrollment-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('voucher-year').value = new Date().getFullYear();
  allStudents = JSON.parse(localStorage.getItem('students') || '[]');
  allPayments = getLocalPayments();

  const urlInput = document.getElementById('pb-url');
  pbUrl = getDefaultPbUrl();
  urlInput.value = pbUrl;
  updateNetworkHint();
  await connectPocketBase();

  if (!pbConnected && allStudents.length) {
    setStatus('Using local storage (' + allStudents.length + ' students). Connect PocketBase for cloud sync.', '');
  }
};