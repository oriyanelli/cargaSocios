// ══════════════════════════════════════════════
//  REEMPLAZÁ CON TU URL DE APPS SCRIPT
// ══════════════════════════════════════════════
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyB__5WYIzVzjeN8O2vK7FwQuImCj8xlXazdiPP_jKvM3uIOmRprHl-35_TjqQpO84BDg/exec';

const MESES = ['Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

let todosLosSocios = []; // caché para autocomplete
let currentSocio  = null;
let monthData     = {};
let selectedMonth = null;
let acIdx         = -1; // índice activo en autocomplete

// ── JSONP (evita CORS con Apps Script) ─────────
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = 'cb_' + Math.random().toString(36).slice(2);
    const sc = document.createElement('script');
    window[cb] = data => { delete window[cb]; document.head.removeChild(sc); resolve(data); };
    sc.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
    sc.onerror = () => { delete window[cb]; document.head.removeChild(sc); reject(new Error('Error de red')); };
    document.head.appendChild(sc);
  });
}

// ── Cargar lista de socios al iniciar ──────────
const CACHE_KEY = 'socios_lista';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

async function cargarTodos() {
  // 1. Intentar desde sessionStorage primero
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const { ts, lista } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) {
        todosLosSocios = lista;
        searchInput.placeholder = `Buscar entre ${lista.length} alumnos...`;
        searchInput.disabled = false;
        return; // listo, sin llamada al script
      }
    }
  } catch(e) {}

  // 2. Si no hay caché válido, cargar desde el script
  searchInput.placeholder = 'Cargando alumnos...';
  searchInput.disabled = true;
  try {
    const data = await jsonp(`${SCRIPT_URL}?action=todos`);
    if (data.ok && data.lista) {
      todosLosSocios = data.lista;
      // Guardar en sessionStorage con timestamp
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), lista: data.lista }));
      } catch(e) {}
      buildIndex();
      searchInput.placeholder = `Buscar entre ${todosLosSocios.length} alumnos...`;
    } else {
      searchInput.placeholder = 'Error: ' + (data.error || 'respuesta inválida');
      searchInput.style.borderColor = 'var(--danger)';
    }
  } catch(e) {
    searchInput.placeholder = 'Error de conexión';
    searchInput.style.borderColor = 'var(--danger)';
    console.error(e);
  } finally {
    searchInput.disabled = false;
  }
}

// Forzar recarga del caché (útil si se agregan alumnos nuevos)
function refrescarLista() {
  sessionStorage.removeItem(CACHE_KEY);
  cargarTodos();
}

document.addEventListener('DOMContentLoaded', cargarTodos);

// ── Autocomplete ───────────────────────────────
const searchInput = document.getElementById('searchInput');
const acBox       = document.getElementById('autocomplete');

function normalizar(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}

// Índice normalizado pre-calculado para búsqueda rápida
let indiceNorm = [];
function buildIndex() {
  indiceNorm = todosLosSocios.map(s => ({
    ...s,
    _nombre: normalizar(s.nombre),
    _ref:    normalizar(s.ref)
  }));
}

let debounceTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const q = normalizar(searchInput.value.trim());
    acIdx = -1;
    if (q.length < 2) { acBox.classList.remove('show'); return; }

    // Usar índice pre-calculado
    if (!indiceNorm.length && todosLosSocios.length) buildIndex();

    const matches = indiceNorm.filter(s =>
      s._nombre.includes(q) || s._ref.includes(q)
    ).slice(0, 10);

    if (!matches.length) {
      acBox.innerHTML = '<div class="ac-empty">Sin resultados</div>';
      acBox.classList.add('show');
      return;
    }

    // Resaltar el texto buscado
    const hl = txt => { try { return txt.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark style="background:var(--accent-lt);color:var(--accent);border-radius:2px">${m}</mark>`); } catch(e) { return txt; } };

    acBox.innerHTML = matches.map((s, i) => `
      <div class="ac-item" data-idx="${i}" data-rowidx="${s.rowIdx}" onclick="elegirSocio(${s.rowIdx})">
        <div class="ac-nombre">${hl(s.nombre)}</div>
        <div class="ac-ref">${hl(s.ref)}</div>
      </div>`).join('');
    acBox.classList.add('show');
  }, 120); // 120ms debounce
});

searchInput.addEventListener('keydown', e => {
  const items = acBox.querySelectorAll('.ac-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { acIdx = Math.min(acIdx+1, items.length-1); highlightAc(items); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { acIdx = Math.max(acIdx-1, 0); highlightAc(items); e.preventDefault(); }
  else if (e.key === 'Enter' && acIdx >= 0) { items[acIdx].click(); e.preventDefault(); }
  else if (e.key === 'Escape') { acBox.classList.remove('show'); }
});

document.addEventListener('click', e => {
  if (!acBox.contains(e.target) && e.target !== searchInput) acBox.classList.remove('show');
});

function highlightAc(items) {
  items.forEach((it, i) => it.classList.toggle('active', i === acIdx));
  if (acIdx >= 0) items[acIdx].scrollIntoView({block:'nearest'});
}

// ── Seleccionar socio ──────────────────────────
async function elegirSocio(rowIdx) {
  acBox.classList.remove('show');
  searchInput.value = '';

  try {
    const data = await jsonp(`${SCRIPT_URL}?action=getSocio&rowIdx=${rowIdx}`);
    if (data.error) { alert(data.error); return; }
    mostrarSocio(data.socio);
  } catch(e) { alert('Error de conexión al cargar el socio.'); }
}

function mostrarSocio(socio) {
  currentSocio = socio;
  monthData    = {};

  // Pre-cargar datos existentes
  Object.entries(socio.meses).forEach(([k,v]) => {
    if (v.monto || v.recibo || v.donacion) monthData[parseInt(k)] = v;
  });

  // Sidebar card
  document.getElementById('socioTag').textContent     = 'Seleccionado';
  document.getElementById('socioCardNombre').textContent = socio.nombre;
  document.getElementById('socioCardMeta').innerHTML  =
    `REF: <span>${socio.ref}</span><br>` +
    `Nº: <span>${socio.nroOrden}</span>` +
    (socio.dni && socio.dni !== '—' ? ` · DNI: <span>${socio.dni}</span>` : '') +
    (socio.telefono && socio.telefono !== '—' ? `<br>Tel: <span>${socio.telefono}</span>` : '');
  document.getElementById('socioCard').classList.remove('hidden');

  goTo(2);
}

// ── Navegación ─────────────────────────────────
function goTo(n) {
  [1,2,3].forEach(i => {
    document.getElementById('panel'+i).classList.toggle('active', i===n);
    const dot = document.getElementById('dot'+i);
    const nav = document.getElementById('nav'+i);
    dot.classList.remove('active','done');
    nav.classList.toggle('active', i===n);
    if (i < n)  dot.classList.add('done');
    if (i === n) dot.classList.add('active');
  });
  if (n===2) { buildMonthGrid(); document.getElementById('monthForm').classList.remove('show'); }
  if (n===3) {
    if (!Object.keys(monthData).length) {
      alert('Primero cargá al menos un mes antes de continuar.');
      goTo(2); return;
    }
    renderSummary();
  }
}

// ── Meses ──────────────────────────────────────
function buildMonthGrid() {
  const grid = document.getElementById('monthGrid');
  grid.innerHTML = '';
  MESES.forEach((m, i) => {
    const btn        = document.createElement('button');
    const enSheet    = currentSocio?.meses?.[i]?.monto;
    const enForm     = monthData[i];
    const isPending  = enSheet && !enForm;
    btn.className = 'month-btn' +
      (enForm    ? ' loaded'   : '') +
      (isPending ? ' pending'  : '') +
      (selectedMonth===i ? ' selected' : '');
    btn.innerHTML = `<span>${m}</span>` +
      (enForm    ? `<small>✓ cargado</small>` : '') +
      (isPending ? `<small>en planilla</small>` : '');
    btn.onclick = () => selectMonth(i);
    grid.appendChild(btn);
  });
}

function selectMonth(idx) {
  // Advertir si el mes ya tiene datos cargados desde el sheet
  if (currentSocio?.meses?.[idx]?.monto && !monthData[idx]) {
    if (!confirm(`${MESES[idx]} ya tiene datos cargados en la planilla. ¿Querés modificarlos?`)) return;
  }
  selectedMonth = idx;
  buildMonthGrid();
  const ex = monthData[idx] || {};
  document.getElementById('fieldMonto').value    = ex.monto    ?? '';
  document.getElementById('fieldRecibo').value   = ex.recibo   ? ex.recibo.split('/')[0].replace('00002-00000','').trim() : '';
  document.getElementById('fieldMonto2').value   = ex.monto2   ?? '';
  document.getElementById('fieldRecibo2').value  = ex.recibo2  ? ex.recibo2.replace('00002-00000','').trim() : '';
  document.getElementById('fieldDonacion').value = ex.donacion ?? '';
  const hasDiff = !!(ex.monto2 || ex.recibo2);
  document.getElementById('diffCheck').checked = hasDiff;
  document.getElementById('diffSection').classList.toggle('show', hasDiff);
  document.getElementById('monthFormTitle').textContent = MESES[idx];
  clearAlert('alertMonthErr');
  document.getElementById('monthForm').classList.add('show');
}

function cancelMonth() {
  document.getElementById('monthForm').classList.remove('show');
  selectedMonth = null;
  buildMonthGrid();
}

function toggleDiff() {
  const checked = document.getElementById('diffCheck').checked;
  document.getElementById('diffSection').classList.toggle('show', checked);
  if (!checked) {
    document.getElementById('fieldMonto2').value  = '';
    document.getElementById('fieldRecibo2').value = '';
  }
}

function guardarMes() {
  if (selectedMonth === null) return;
  const monto    = document.getElementById('fieldMonto').value.trim();
  const recibo   = document.getElementById('fieldRecibo').value.trim();
  const monto2   = document.getElementById('fieldMonto2').value.trim();
  const recibo2  = document.getElementById('fieldRecibo2').value.trim();
  const donacion = document.getElementById('fieldDonacion').value.trim();
  const hasDiff  = document.getElementById('diffCheck').checked;

  if (!monto && !recibo) { showAlert('alertMonthErr','error','Ingresá al menos el monto o el Nº de factura principal.'); return; }
  if (hasDiff && !monto2 && !recibo2) { showAlert('alertMonthErr','error','Completá el monto o factura de la diferencia, o desmarcá la opción.'); return; }
  clearAlert('alertMonthErr');

  const reciboFull  = recibo  ? '00002-00000' + String(recibo).padStart(3,'0')  : '';
  const recibo2Full = recibo2 ? '00002-00000' + String(recibo2).padStart(3,'0') : '';

  monthData[selectedMonth] = {
    monto, recibo: reciboFull,
    monto2:   hasDiff ? monto2   : '',
    recibo2:  hasDiff ? recibo2Full : '',
    donacion
  };

  cancelMonth();
  showAlert('alertStep2ok','success', `✓ ${MESES[selectedMonth]} guardado.`);
  setTimeout(() => clearAlert('alertStep2ok'), 2000);
}

// ── Resumen ────────────────────────────────────
function renderSummary() {
  const keys = Object.keys(monthData).map(Number).sort((a,b)=>a-b);
  const el   = document.getElementById('summaryContent');
  clearAlert('alertStep3err'); clearAlert('alertStep3ok');

  if (!keys.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--muted)">No cargaste datos para ningún mes todavía.</p>';
    return;
  }

  const fmt = v => v ? '$' + parseFloat(v).toLocaleString('es-AR',{minimumFractionDigits:2}) : '—';
  const rows = keys.map(i => {
    const d = monthData[i];
    const montoTotal = (parseFloat(d.monto)||0) + (parseFloat(d.monto2)||0);
    const reciboStr  = d.recibo + (d.recibo2 ? ' + ' + d.recibo2 : '');
    return `<tr>
      <td>${MESES[i]}</td>
      <td>${fmt(montoTotal)}${d.monto2 ? `<br><span style="font-size:11px;color:var(--muted)">${fmt(d.monto)} + ${fmt(d.monto2)}</span>` : ''}</td>
      <td style="font-size:12px">${reciboStr || '—'}</td>
      <td>${fmt(d.donacion)}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="font-size:14px;margin-bottom:1rem">
      Alumno: <strong>${currentSocio.nombre}</strong>
      &nbsp;<span class="badge">${keys.length} ${keys.length===1?'mes':'meses'}</span>
    </div>
    <table class="summary-table">
      <thead><tr><th>Mes</th><th>Monto</th><th>Facturas</th><th>Donación</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Guardar en Sheets ──────────────────────────
async function guardarEnSheet() {
  const keys = Object.keys(monthData);
  if (!keys.length) { showAlert('alertStep3err','error','No hay datos para guardar.'); return; }

  const btn = document.getElementById('btnGuardar');
  btn.innerHTML = '<span class="spinner"></span> Guardando…';
  btn.disabled  = true;
  clearAlert('alertStep3err'); clearAlert('alertStep3ok');

  try {
    const url  = `${SCRIPT_URL}?action=guardar&rowIdx=${currentSocio.rowIdx}&meses=${encodeURIComponent(JSON.stringify(monthData))}`;
    const data = await jsonp(url);
    if (data.error) { showAlert('alertStep3err','error', data.error); return; }
    showAlert('alertStep3ok','success','✓ ' + data.mensaje);
    monthData = {};
    document.getElementById('socioCard').classList.add('hidden');
    currentSocio = null;
    setTimeout(() => { goTo(1); clearAlert('alertStep3ok'); }, 2500);
  } catch(e) {
    showAlert('alertStep3err','error','Error al guardar. Verificá tu conexión.');
  } finally {
    btn.innerHTML = 'Guardar en Google Sheets ↑';
    btn.disabled  = false;
  }
}

// ── Helpers ────────────────────────────────────
function showAlert(id, type, msg) {
  const el = document.getElementById(id);
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}
function clearAlert(id) {
  const el = document.getElementById(id);
  el.className = 'alert';
  el.textContent = '';
}
