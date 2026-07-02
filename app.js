'use strict';

// ============================================================
// Чек-лист визита. Чтобы поменять вопросы — правьте этот список.
// type: 'yesno' | 'number' | 'select' | 'text' | 'textarea'
// ============================================================
const CHECKLIST = [
  { id: 'stand',          label: 'Фирменный стенд в наличии',            type: 'yesno' },
  { id: 'standCondition', label: 'Состояние стенда',                     type: 'select',
    options: ['Отличное', 'Требует ухода', 'Повреждён', 'Стенда нет'] },
  { id: 'skuCount',       label: 'Кол-во наших SKU в выкладке',          type: 'number' },
  { id: 'priceTags',      label: 'Ценники на всех позициях',             type: 'yesno' },
  { id: 'pos',            label: 'POS-материалы (каталоги, буклеты)',    type: 'yesno' },
  { id: 'samples',        label: 'Образцы доступны покупателю',          type: 'yesno' },
  { id: 'competitors',    label: 'Конкуренты рядом (какие бренды)',      type: 'text' },
  { id: 'comment',        label: 'Комментарий',                          type: 'textarea' },
];

const APP_VERSION = '2.0.0';
const MAX_PHOTOS = 10;
const PHOTO_MAX_SIDE = 1400;
const PHOTO_QUALITY = 0.72;

// ---------- Настройки (localStorage) ----------
const settings = {
  get employee()    { return localStorage.getItem('rc.employee') || ''; },
  set employee(v)   { localStorage.setItem('rc.employee', v); },
  get stores()      { try { return JSON.parse(localStorage.getItem('rc.stores')) || []; } catch { return []; } },
  set stores(v)     { localStorage.setItem('rc.stores', JSON.stringify(v)); },
};

// ---------- IndexedDB ----------
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('retail-check', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('visits', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('visits', mode);
    const store = tx.objectStore('visits');
    const out = fn(store);
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

const putVisit    = (v)  => idb('readwrite', s => s.put(v));
const deleteVisit = (id) => idb('readwrite', s => s.delete(id));
const getAllVisits = () => idb('readonly',  s => s.getAll());

// ---------- Утилиты ----------
const $ = (sel) => document.querySelector(sel);

function uuid() {
  return (crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)) + '-' + Date.now();
}

function toast(msg, ms = 3000) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

const pad2 = (n) => String(n).padStart(2, '0');

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' ' +
         d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// «02.07.2026 10:15» — Excel распознаёт как дату-время
function fmtExcel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const sanitizeName = (s) => String(s || '').replace(/[\\/:*?"<>|;#%&{}]/g, '_').replace(/\s+/g, ' ').trim();

// ---------- Навигация между экранами ----------
const VIEWS = { home: 'Retail Check', visit: 'Новый визит', settings: 'Настройки' };
let currentView = 'home';

function nav(view) {
  currentView = view;
  for (const v of Object.keys(VIEWS)) {
    $(`#view-${v}`).classList.toggle('hidden', v !== view);
  }
  $('#topbarTitle').textContent = VIEWS[view];
  $('#btnBack').classList.toggle('hidden', view === 'home');
  $('#btnSettings').classList.toggle('hidden', view !== 'home');
  window.scrollTo(0, 0);
  if (view === 'home') renderHome();
  if (view === 'settings') renderSettings();
}

// ---------- Главный экран ----------
async function renderHome() {
  const visits = (await getAllVisits()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const list = $('#visitList');
  list.innerHTML = '';
  $('#emptyHint').classList.toggle('hidden', visits.length > 0);
  $('#setupHint').classList.toggle('hidden', !!settings.employee);
  $('#offlineBanner').classList.toggle('hidden', navigator.onLine);

  const unsent = visits.filter(v => v.status === 'queued').length;
  const sent = visits.length - unsent;
  $('#btnShare').textContent = unsent ? `⇪ Отправить отчёт (${unsent})` : '⇪ Отправить отчёт';
  $('#btnClearSent').classList.toggle('hidden', sent === 0);

  const STATUS_LABEL = { queued: 'Не отправлен', sent: 'Отправлен' };

  for (const v of visits) {
    const li = document.createElement('li');
    const photos = v.photos ? v.photos.length : 0;
    li.innerHTML = `
      <div class="visit-info">
        <div class="visit-store"></div>
        <div class="visit-meta">${fmtDate(v.startedAt)} · 📷 ${photos}</div>
      </div>
      <span class="status ${v.status}">${STATUS_LABEL[v.status] || v.status}</span>
      <button class="visit-del" aria-label="Удалить">🗑</button>`;
    li.querySelector('.visit-store').textContent = v.store || '(без названия)';
    li.querySelector('.visit-del').onclick = async () => {
      if (v.status !== 'sent' && !confirm('Визит ещё не попал в отчёт. Удалить безвозвратно?')) return;
      await deleteVisit(v.id);
      renderHome();
    };
    list.appendChild(li);
  }
}

// ---------- Форма визита ----------
let draft = null; // текущий заполняемый визит

function newDraft() {
  draft = {
    id: uuid(),
    employee: settings.employee,
    store: '',
    startedAt: new Date().toISOString(),
    geo: null,
    answers: {},
    photos: [],       // [{blob, name}]
    status: 'queued',
  };
}

function buildChecklistUI() {
  const wrap = $('#checklistFields');
  wrap.innerHTML = '';
  for (const item of CHECKLIST) {
    const div = document.createElement('div');
    div.className = 'check-item';
    const label = document.createElement('label');
    label.textContent = item.label;
    div.appendChild(label);

    if (item.type === 'yesno') {
      const row = document.createElement('div');
      row.className = 'yesno';
      const yes = document.createElement('button');
      const no = document.createElement('button');
      yes.type = 'button'; no.type = 'button';
      yes.textContent = 'Да'; no.textContent = 'Нет';
      yes.onclick = () => { draft.answers[item.id] = 'Да';  yes.className = 'sel-yes'; no.className = ''; };
      no.onclick  = () => { draft.answers[item.id] = 'Нет'; no.className = 'sel-no'; yes.className = ''; };
      row.append(yes, no);
      div.appendChild(row);
    } else if (item.type === 'select') {
      const sel = document.createElement('select');
      sel.innerHTML = '<option value="">— выберите —</option>' +
        item.options.map(o => `<option>${o}</option>`).join('');
      sel.onchange = () => { draft.answers[item.id] = sel.value; };
      div.appendChild(sel);
    } else if (item.type === 'textarea') {
      const ta = document.createElement('textarea');
      ta.rows = 3;
      ta.oninput = () => { draft.answers[item.id] = ta.value; };
      div.appendChild(ta);
    } else {
      const inp = document.createElement('input');
      if (item.type === 'number') { inp.type = 'number'; inp.inputMode = 'numeric'; }
      inp.oninput = () => { draft.answers[item.id] = inp.value; };
      div.appendChild(inp);
    }
    wrap.appendChild(div);
  }
}

function startVisit() {
  if (!settings.employee) {
    toast('Сначала укажите ваше имя в настройках');
    nav('settings');
    return;
  }
  newDraft();
  $('#storeInput').value = '';
  $('#storeList').innerHTML = settings.stores.map(s => `<option value="${s.replace(/"/g, '&quot;')}">`).join('');
  buildChecklistUI();
  renderPhotos();
  nav('visit');
  captureGeo();
}

function captureGeo() {
  const chip = $('#geoStatus');
  const retry = $('#btnGeoRetry');
  chip.className = 'geo-chip';
  chip.textContent = '📍 Определяем местоположение…';
  retry.classList.add('hidden');

  if (!navigator.geolocation) {
    chip.textContent = '📍 Геолокация недоступна';
    chip.classList.add('fail');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      draft.geo = {
        lat: +pos.coords.latitude.toFixed(6),
        lng: +pos.coords.longitude.toFixed(6),
        accuracy: Math.round(pos.coords.accuracy),
      };
      chip.textContent = `📍 Место зафиксировано (±${draft.geo.accuracy} м)`;
      chip.classList.add('ok');
    },
    () => {
      chip.textContent = '📍 Не удалось определить место';
      chip.classList.add('fail');
      retry.classList.remove('hidden');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

// ---------- Фото ----------
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Не удалось обработать фото')),
        'image/jpeg', PHOTO_QUALITY
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото')); };
    img.src = url;
  });
}

async function addPhotos(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    if (draft.photos.length >= MAX_PHOTOS) {
      toast(`Максимум ${MAX_PHOTOS} фото на визит`);
      break;
    }
    try {
      const blob = await compressImage(file);
      draft.photos.push({ blob, name: `photo_${draft.photos.length + 1}.jpg` });
    } catch (e) {
      toast(e.message);
    }
  }
  renderPhotos();
}

function renderPhotos() {
  const grid = $('#photoGrid');
  grid.innerHTML = '';
  draft.photos.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'thumb';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(p.blob);
    img.onload = () => URL.revokeObjectURL(img.src);
    const rm = document.createElement('button');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = () => { draft.photos.splice(i, 1); renderPhotos(); };
    div.append(img, rm);
    grid.appendChild(div);
  });
}

// ---------- Сохранение визита ----------
async function saveVisit() {
  draft.store = $('#storeInput').value.trim();
  if (!draft.store) {
    toast('Укажите название точки');
    $('#storeInput').focus();
    return;
  }
  draft.finishedAt = new Date().toISOString();

  // запоминаем новую точку в списке подсказок
  if (!settings.stores.includes(draft.store)) {
    settings.stores = [...settings.stores, draft.store];
  }

  await putVisit(draft);
  draft = null;
  nav('home');
  toast('Визит сохранён. В конце дня нажмите «Отправить отчёт»');
}

// ============================================================
// Отчёт: CSV для Excel + фото, упакованные в один ZIP
// ============================================================

// --- ZIP без сжатия (фото уже сжаты в JPEG) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
const u32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);

function dosDateTime(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
    date: ((Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF,
  };
}

// entries: [{name, data: Uint8Array, date: Date}]
function buildZip(entries) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameB = enc.encode(e.name);
    const crc = crc32(e.data);
    const { time, date } = dosDateTime(e.date || new Date());
    // флаг 0x0800 — имена файлов в UTF-8 (кириллица)
    parts.push(
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(e.data.length), u32(e.data.length), u16(nameB.length), u16(0),
      nameB, e.data
    );
    central.push({ nameB, crc, size: e.data.length, time, date, offset });
    offset += 30 + nameB.length + e.data.length;
  }

  let cdLen = 0;
  for (const c of central) {
    parts.push(
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(c.time), u16(c.date),
      u32(c.crc), u32(c.size), u32(c.size), u16(c.nameB.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(c.offset), c.nameB
    );
    cdLen += 46 + c.nameB.length;
  }
  parts.push(
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(cdLen), u32(offset), u16(0)
  );
  return new Blob(parts, { type: 'application/zip' });
}

// --- CSV (разделитель «;», BOM — чтобы Excel понял кириллицу) ---
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv(visits, photoNames) {
  const headers = [
    'Сотрудник', 'Точка', 'Начало визита', 'Завершение',
    'Широта', 'Долгота', 'Точность (м)', 'Карта',
    ...CHECKLIST.map(c => c.label),
    'Фото', 'ID',
  ];
  const lines = [headers.map(csvEscape).join(';')];
  for (const v of visits) {
    lines.push([
      v.employee, v.store, fmtExcel(v.startedAt), fmtExcel(v.finishedAt),
      v.geo ? v.geo.lat : '', v.geo ? v.geo.lng : '', v.geo ? v.geo.accuracy : '',
      v.geo ? `https://yandex.ru/maps/?pt=${v.geo.lng},${v.geo.lat}&z=17` : '',
      ...CHECKLIST.map(c => v.answers[c.id] != null ? v.answers[c.id] : ''),
      (photoNames.get(v.id) || []).join(', '),
      v.id,
    ].map(csvEscape).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n');
}

// --- Сборка отчёта ---
async function buildReport(visits) {
  const now = new Date();
  const entries = [];
  const photoNames = new Map(); // id визита -> имена файлов фото
  const used = new Set();

  for (const v of visits) {
    const d = new Date(v.startedAt);
    const prefix = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}_${sanitizeName(v.store)}`;
    const names = [];
    for (let i = 0; i < (v.photos || []).length; i++) {
      let name = `${prefix}_${i + 1}.jpg`;
      let k = 2;
      while (used.has(name)) name = `${prefix}_${i + 1}_${k++}.jpg`;
      used.add(name);
      names.push(name);
      entries.push({
        name: `фото/${name}`,
        data: new Uint8Array(await v.photos[i].blob.arrayBuffer()),
        date: d,
      });
    }
    photoNames.set(v.id, names);
  }

  const csv = buildCsv(visits, photoNames);
  entries.unshift({ name: 'визиты.csv', data: new TextEncoder().encode(csv), date: now });

  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
  const filename = `RetailCheck_${sanitizeName(settings.employee) || 'отчёт'}_${stamp}.zip`;
  return { blob: buildZip(entries), filename };
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function shareReport() {
  const unsent = (await getAllVisits())
    .filter(v => v.status === 'queued')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  if (!unsent.length) {
    toast('Нет новых визитов для отчёта');
    return;
  }

  toast('Готовим отчёт…');
  const { blob, filename } = await buildReport(unsent);
  const file = new File([blob], filename, { type: 'application/zip' });

  let delivered = false;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Отчёт Retail Check' });
      delivered = true;
    } catch (err) {
      if (err.name === 'AbortError') {
        toast('Отправка отменена');
        return;
      }
      // не получилось поделиться — сохраним файлом
    }
  }
  if (!delivered) {
    downloadBlob(blob, filename);
    toast('Файл отчёта сохранён в загрузки — отправьте его коллегам вручную', 5000);
  } else {
    toast(`Отчёт отправлен: визитов — ${unsent.length}`);
  }

  const when = new Date().toISOString();
  for (const v of unsent) {
    v.status = 'sent';
    v.sentAt = when;
    await putVisit(v);
  }
  renderHome();
}

async function clearSent() {
  const sent = (await getAllVisits()).filter(v => v.status === 'sent');
  if (!sent.length) return;
  if (!confirm(`Удалить отправленные визиты (${sent.length})? Они уже есть в отчётах.`)) return;
  for (const v of sent) await deleteVisit(v.id);
  renderHome();
}

// ---------- Настройки ----------
function renderSettings() {
  $('#employeeInput').value = settings.employee;
  $('#storesInput').value = settings.stores.join('\n');
  $('#versionInfo').textContent = `Retail Check v${APP_VERSION}`;
}

function saveSettings() {
  settings.employee = $('#employeeInput').value.trim();
  settings.stores = $('#storesInput').value.split('\n').map(s => s.trim()).filter(Boolean);
  toast('Настройки сохранены');
  nav('home');
}

// ---------- Запуск ----------
async function main() {
  db = await openDB();

  $('#btnNewVisit').onclick = startVisit;
  $('#btnSaveVisit').onclick = saveVisit;
  $('#btnSettings').onclick = () => nav('settings');
  $('#btnSaveSettings').onclick = saveSettings;
  $('#btnShare').onclick = shareReport;
  $('#btnClearSent').onclick = clearSent;
  $('#btnGeoRetry').onclick = captureGeo;
  $('#btnBack').onclick = () => {
    if (currentView === 'visit' && draft &&
        !confirm('Выйти без сохранения визита?')) return;
    draft = null;
    nav('home');
  };
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.onclick = () => nav(el.dataset.nav);
  });

  $('#photoCamera').onchange = (e) => { addPhotos(e.target.files); e.target.value = ''; };
  $('#photoGallery').onchange = (e) => { addPhotos(e.target.files); e.target.value = ''; };

  window.addEventListener('online', renderHome);
  window.addEventListener('offline', renderHome);

  nav('home');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();
