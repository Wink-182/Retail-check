'use strict';

// ============================================================
// Чек-лист визита. Чтобы поменять вопросы — правьте этот список.
// Типы полей:
//   yesno       — Да/Нет
//   number      — число
//   select      — один вариант из списка (options)
//   multi       — несколько вариантов из списка (options);
//                 highlight — какие варианты подсветить
//   percents    — проценты по полям (fields), остаток до 100%
//                 считается автоматически (autoLabel)
//   checkgroup  — галочки есть/нет по списку items
//   ratinggroup — для каждого из items один вариант из options
//   text, textarea — свободный ввод
// ============================================================
const CHECKLIST = [
  { id: 'clients',  label: 'Кол-во клиентов', type: 'number' },
  { id: 'segment',  label: 'Сегмент магазина', type: 'select',
    options: ['Бюджет', 'Средний', 'Средний +', 'Премиум'] },
  { id: 'assortment', label: 'Ассортимент, %', type: 'percents',
    fields: [
      { id: 'laminate', label: 'Ламинат' },
      { id: 'spc',      label: 'SPC' },
    ],
    autoLabel: 'Другое' },
  { id: 'sales', label: 'Продажи', type: 'select',
    options: ['Ниже прошлого года', 'Так же', 'Выше прошлого года'] },
  { id: 'competitors', label: 'Конкуренты', type: 'multi',
    options: ['AGT', 'Alpine Floor', 'Classen', 'Egger', 'Ever', 'Kronopol',
              'Kronospan', 'Kronostar', 'Kronotex', 'Quick-Step', 'Tarkett',
              'Unilin', 'Woodstyle'] },
  { id: 'collections', label: 'Коллекции Кастамону', type: 'multi',
    options: ['Amber', 'Black', 'Blue', 'Cherry', 'Color block', 'CraftCore',
              'Emerald', 'Green', 'Grey', 'Lagoon', 'LaMoena', 'Malva',
              'Marsala', 'Nanoclick', 'Orange', 'Prime', 'Red', 'River',
              'Royce', 'Ruby', 'Stonex', 'Sunfloor', 'Ultramarine', 'Violet',
              'Wings', 'Yellow'],
    highlight: ['CraftCore', 'LaMoena'] },
  { id: 'stands', label: 'Стенды', type: 'checkgroup',
    items: ['Кастамону', 'LaMoena', 'CraftCore'] },
  { id: 'communication', label: 'Коммуникация', type: 'multi',
    options: ['Интернет', 'Сайт', 'Соцсети', 'Сарафанное радио', 'Другое'] },
  { id: 'awareness', label: 'Знание брендов', type: 'ratinggroup',
    items: ['Кастамону', 'LaMoena', 'CraftCore'],
    options: ['Не знают', 'Знают плохо', 'Знают хорошо'] },
  { id: 'priceTags', label: 'Ценники на всех позициях', type: 'yesno' },
  { id: 'pos', label: 'POS-материалы (каталоги, буклеты)', type: 'yesno' },
  { id: 'comment', label: 'Комментарии', type: 'textarea' },
];

const APP_VERSION = '2.2.1';
const MAX_PHOTOS = 10;
const PHOTO_MAX_SIDE = 1400;
const PHOTO_QUALITY = 0.72;

// ---------- Настройки (localStorage) ----------
const settings = {
  get employee()    { return localStorage.getItem('rc.employee') || ''; },
  set employee(v)   { localStorage.setItem('rc.employee', v); },
  get stores()      { try { return JSON.parse(localStorage.getItem('rc.stores')) || []; } catch { return []; } },
  set stores(v)     { localStorage.setItem('rc.stores', JSON.stringify(v)); },
  get cities()      { try { return JSON.parse(localStorage.getItem('rc.cities')) || []; } catch { return []; } },
  set cities(v)     { localStorage.setItem('rc.cities', JSON.stringify(v)); },
  get lastCity()    { return localStorage.getItem('rc.lastCity') || ''; },
  set lastCity(v)   { localStorage.setItem('rc.lastCity', v); },
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
const VIEWS = { home: 'Retail Check', visit: 'Визит', settings: 'Настройки' };
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

  // группируем по городам; порядок городов — по самому свежему визиту
  const byCity = new Map();
  for (const v of visits) {
    const c = v.city || 'Без города';
    if (!byCity.has(c)) byCity.set(c, []);
    byCity.get(c).push(v);
  }

  for (const [city, cityVisits] of byCity) {
    const closed = collapsedCities.has(city);
    const header = document.createElement('li');
    header.className = 'city-header' + (closed ? ' closed' : '');
    header.innerHTML = `<span class="chev">▾</span><span class="city-name"></span><span class="count"></span>`;
    header.querySelector('.city-name').textContent = city;
    header.querySelector('.count').textContent = cityVisits.length;
    header.onclick = () => {
      if (collapsedCities.has(city)) collapsedCities.delete(city);
      else collapsedCities.add(city);
      renderHome();
    };
    list.appendChild(header);
    if (closed) continue;

    for (const v of cityVisits) {
      const li = document.createElement('li');
      const photos = v.photos ? v.photos.length : 0;
      li.innerHTML = `
        <div class="visit-info" title="Открыть и изменить">
          <div class="visit-store"></div>
          <div class="visit-meta">${fmtDate(v.startedAt)} · 📷 ${photos} · ✎ изменить</div>
        </div>
        <span class="status ${v.status}">${STATUS_LABEL[v.status] || v.status}</span>
        <button class="visit-del" aria-label="Удалить">🗑</button>`;
      li.querySelector('.visit-store').textContent = v.store || '(без названия)';
      li.querySelector('.visit-info').onclick = () => openVisit(v);
      li.querySelector('.visit-del').onclick = async () => {
        if (v.status !== 'sent' && !confirm('Визит ещё не попал в отчёт. Удалить безвозвратно?')) return;
        await deleteVisit(v.id);
        renderHome();
      };
      list.appendChild(li);
    }
  }
}

const collapsedCities = new Set();

// ---------- Форма визита ----------
let draft = null; // текущий заполняемый визит

function newDraft() {
  draft = {
    id: uuid(),
    employee: settings.employee,
    store: '',
    city: '',
    startedAt: new Date().toISOString(),
    geo: null,
    answers: {},
    photos: [],       // [{blob, name}]
    status: 'queued',
  };
}

function ensureObj(id) {
  if (!draft.answers[id]) draft.answers[id] = {};
  return draft.answers[id];
}

function buildChecklistUI() {
  const wrap = $('#checklistFields');
  wrap.innerHTML = '';
  const a = draft.answers;

  for (const item of CHECKLIST) {
    const div = document.createElement('div');
    div.className = 'check-item';
    const label = document.createElement('label');
    label.textContent = item.label;
    div.appendChild(label);

    switch (item.type) {

      case 'yesno': {
        const row = document.createElement('div');
        row.className = 'yesno';
        const yes = document.createElement('button');
        const no = document.createElement('button');
        yes.type = 'button'; no.type = 'button';
        yes.textContent = 'Да'; no.textContent = 'Нет';
        const paint = () => {
          yes.className = a[item.id] === 'Да' ? 'sel-yes' : '';
          no.className = a[item.id] === 'Нет' ? 'sel-no' : '';
        };
        yes.onclick = () => { a[item.id] = 'Да'; paint(); };
        no.onclick  = () => { a[item.id] = 'Нет'; paint(); };
        paint();
        row.append(yes, no);
        div.appendChild(row);
        break;
      }

      case 'select': {
        const sel = document.createElement('select');
        sel.innerHTML = '<option value="">— выберите —</option>' +
          item.options.map(o => `<option>${o}</option>`).join('');
        if (a[item.id]) sel.value = a[item.id];
        sel.onchange = () => { a[item.id] = sel.value; };
        div.appendChild(sel);
        break;
      }

      case 'multi': {
        const selected = Array.isArray(a[item.id]) ? a[item.id] : (a[item.id] = []);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'multi-toggle';
        const txt = document.createElement('span');
        const arr = document.createElement('span');
        arr.className = 'arr';
        btn.append(txt, arr);

        const listEl = document.createElement('div');
        listEl.className = 'multi-list hidden';

        const refresh = () => {
          txt.textContent = selected.length === 0 ? 'Выбрать…'
            : selected.length <= 2 ? selected.join(', ')
            : `Выбрано: ${selected.length}`;
          arr.textContent = listEl.classList.contains('hidden') ? '▾' : '▴';
        };
        btn.onclick = () => { listEl.classList.toggle('hidden'); refresh(); };

        for (const opt of item.options) {
          const optLabel = document.createElement('label');
          optLabel.className = 'multi-opt' +
            (item.highlight && item.highlight.includes(opt) ? ' hl' : '');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = selected.includes(opt);
          cb.onchange = () => {
            const i = selected.indexOf(opt);
            if (cb.checked && i === -1) selected.push(opt);
            if (!cb.checked && i !== -1) selected.splice(i, 1);
            refresh();
          };
          const span = document.createElement('span');
          span.textContent = opt;
          optLabel.append(cb, span);
          listEl.appendChild(optLabel);
        }
        refresh();
        div.append(btn, listEl);
        break;
      }

      case 'percents': {
        const obj = ensureObj(item.id);
        const autoRow = document.createElement('div');
        autoRow.className = 'pct-row auto';
        const autoName = document.createElement('span');
        autoName.textContent = item.autoLabel;
        const autoVal = document.createElement('b');
        autoRow.append(autoName, autoVal);

        const recompute = () => {
          const nums = item.fields
            .map(f => parseFloat(obj[f.id]))
            .filter(n => !isNaN(n));
          if (!nums.length) { autoVal.textContent = '—'; autoRow.classList.remove('neg'); return; }
          const rest = Math.round((100 - nums.reduce((s, n) => s + n, 0)) * 10) / 10;
          autoVal.textContent = rest + ' %';
          autoRow.classList.toggle('neg', rest < 0);
        };

        for (const f of item.fields) {
          const row = document.createElement('div');
          row.className = 'pct-row';
          const name = document.createElement('span');
          name.textContent = f.label;
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.inputMode = 'numeric';
          inp.min = 0; inp.max = 100;
          inp.placeholder = '%';
          if (obj[f.id] != null) inp.value = obj[f.id];
          inp.oninput = () => { obj[f.id] = inp.value; recompute(); };
          row.append(name, inp);
          div.appendChild(row);
        }
        recompute();
        div.appendChild(autoRow);
        break;
      }

      case 'checkgroup': {
        const obj = ensureObj(item.id);
        for (const sub of item.items) {
          const optLabel = document.createElement('label');
          optLabel.className = 'check-opt';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!obj[sub];
          cb.onchange = () => { obj[sub] = cb.checked; };
          const span = document.createElement('span');
          span.textContent = sub;
          optLabel.append(cb, span);
          div.appendChild(optLabel);
        }
        break;
      }

      case 'ratinggroup': {
        const obj = ensureObj(item.id);
        for (const sub of item.items) {
          const row = document.createElement('div');
          row.className = 'rate-row';
          const name = document.createElement('span');
          name.className = 'rate-name';
          name.textContent = sub;
          const seg = document.createElement('div');
          seg.className = 'seg';
          const btns = [];
          for (const opt of item.options) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = opt;
            b.onclick = () => {
              obj[sub] = opt;
              btns.forEach(x => x.classList.toggle('sel', x.textContent === opt));
            };
            if (obj[sub] === opt) b.classList.add('sel');
            btns.push(b);
            seg.appendChild(b);
          }
          row.append(name, seg);
          div.appendChild(row);
        }
        break;
      }

      case 'textarea': {
        const ta = document.createElement('textarea');
        ta.rows = 3;
        if (a[item.id]) ta.value = a[item.id];
        ta.oninput = () => { a[item.id] = ta.value; };
        div.appendChild(ta);
        break;
      }

      default: { // number, text
        const inp = document.createElement('input');
        if (item.type === 'number') { inp.type = 'number'; inp.inputMode = 'numeric'; }
        if (a[item.id] != null) inp.value = a[item.id];
        inp.oninput = () => { a[item.id] = inp.value; };
        div.appendChild(inp);
      }
    }
    wrap.appendChild(div);
  }
}

function fillStoreDatalist() {
  $('#storeList').innerHTML = settings.stores.map(s => `<option value="${s.replace(/"/g, '&quot;')}">`).join('');
  $('#cityList').innerHTML = settings.cities.map(s => `<option value="${s.replace(/"/g, '&quot;')}">`).join('');
}

function startVisit() {
  if (!settings.employee) {
    toast('Сначала укажите ваше имя в настройках');
    nav('settings');
    return;
  }
  newDraft();
  $('#storeInput').value = '';
  $('#cityInput').value = settings.lastCity; // обычно за день обходят один город
  fillStoreDatalist();
  buildChecklistUI();
  renderPhotos();
  nav('visit');
  captureGeo();
}

// Открыть сохранённый визит для редактирования
function openVisit(v) {
  draft = {
    ...v,
    answers: JSON.parse(JSON.stringify(v.answers || {})),
    photos: (v.photos || []).map(p => ({ blob: p.blob, name: p.name })),
  };
  $('#storeInput').value = v.store || '';
  $('#cityInput').value = v.city || '';
  fillStoreDatalist();
  buildChecklistUI();
  renderPhotos();
  nav('visit');
  renderGeoChip();
}

// Показать сохранённое гео без повторного запроса —
// при редактировании из дома координаты перезаписывать нельзя
function renderGeoChip() {
  const chip = $('#geoStatus');
  const retry = $('#btnGeoRetry');
  if (draft.geo) {
    chip.className = 'geo-chip ok';
    chip.textContent = `📍 Место зафиксировано (±${draft.geo.accuracy} м)`;
    retry.classList.add('hidden');
  } else {
    chip.className = 'geo-chip fail';
    chip.textContent = '📍 Координаты не записаны';
    retry.classList.remove('hidden');
  }
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
  draft.city = $('#cityInput').value.trim();
  if (!draft.store) {
    toast('Укажите название точки');
    $('#storeInput').focus();
    return;
  }
  if (!draft.city) {
    toast('Укажите город');
    $('#cityInput').focus();
    return;
  }
  const wasSent = draft.status === 'sent';
  if (!draft.finishedAt) draft.finishedAt = new Date().toISOString();
  else draft.updatedAt = new Date().toISOString();
  draft.status = 'queued';

  // запоминаем точку и город в списках подсказок
  if (!settings.stores.includes(draft.store)) {
    settings.stores = [...settings.stores, draft.store];
  }
  if (!settings.cities.includes(draft.city)) {
    settings.cities = [...settings.cities, draft.city];
  }
  settings.lastCity = draft.city;

  await putVisit(draft);
  draft = null;
  nav('home');
  toast(wasSent
    ? 'Визит обновлён — попадёт в следующий отчёт'
    : 'Визит сохранён. В конце дня нажмите «Отправить отчёт»');
}

// ============================================================
// Отчёт: CSV для Excel + фото.
// Отправка: сами файлы через «Поделиться» (Android/iPhone);
// запасной вариант — один ZIP в загрузки (компьютер).
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

// Каждый пункт чек-листа превращается в одну или несколько колонок CSV
function itemColumns(item) {
  switch (item.type) {
    case 'percents': {
      const cols = item.fields.map(f => ({
        label: `${f.label}, %`,
        get: (a) => {
          const o = a[item.id];
          return o && o[f.id] !== '' && o[f.id] != null ? o[f.id] : '';
        },
      }));
      cols.push({
        label: `${item.autoLabel}, %`,
        get: (a) => {
          const o = a[item.id];
          if (!o) return '';
          const nums = item.fields.map(f => parseFloat(o[f.id])).filter(n => !isNaN(n));
          if (!nums.length) return '';
          return String(Math.round((100 - nums.reduce((s, n) => s + n, 0)) * 10) / 10);
        },
      });
      return cols;
    }
    case 'checkgroup':
      return item.items.map(sub => ({
        label: `${item.label}: ${sub}`,
        get: (a) => { const o = a[item.id]; return o && o[sub] ? 'Да' : 'Нет'; },
      }));
    case 'ratinggroup':
      return item.items.map(sub => ({
        label: `${item.label}: ${sub}`,
        get: (a) => { const o = a[item.id]; return o && o[sub] ? o[sub] : ''; },
      }));
    case 'multi':
      return [{
        label: item.label,
        get: (a) => Array.isArray(a[item.id]) ? a[item.id].join(', ') : '',
      }];
    default:
      return [{
        label: item.label,
        get: (a) => a[item.id] != null ? a[item.id] : '',
      }];
  }
}

const ALL_COLUMNS = CHECKLIST.flatMap(itemColumns);

function buildCsv(visits, photoNames) {
  const headers = [
    'Сотрудник', 'Город', 'Точка', 'Начало визита', 'Завершение',
    'Широта', 'Долгота', 'Точность (м)', 'Карта',
    ...ALL_COLUMNS.map(c => c.label),
    'Фото', 'ID',
  ];
  const lines = [headers.map(csvEscape).join(';')];
  for (const v of visits) {
    const a = v.answers || {};
    lines.push([
      v.employee, v.city || '', v.store, fmtExcel(v.startedAt), fmtExcel(v.finishedAt),
      v.geo ? v.geo.lat : '', v.geo ? v.geo.lng : '', v.geo ? v.geo.accuracy : '',
      v.geo ? `https://yandex.ru/maps/?pt=${v.geo.lng},${v.geo.lat}&z=17` : '',
      ...ALL_COLUMNS.map(c => c.get(a)),
      (photoNames.get(v.id) || []).join(', '),
      v.id,
    ].map(csvEscape).join(';'));
  }
  return '\uFEFF' + lines.join('\r\n');
}

// --- Сборка файлов отчёта ---
async function buildReportParts(visits) {
  const now = new Date();
  const photos = []; // [{name, u8, date}]
  const photoNames = new Map();
  const used = new Set();

  for (const v of visits) {
    const d = new Date(v.startedAt);
    const place = [sanitizeName(v.city), sanitizeName(v.store)].filter(Boolean).join('_');
    const prefix = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}_${place}`;
    const names = [];
    for (let i = 0; i < (v.photos || []).length; i++) {
      let name = `${prefix}_${i + 1}.jpg`;
      let k = 2;
      while (used.has(name)) name = `${prefix}_${i + 1}_${k++}.jpg`;
      used.add(name);
      names.push(name);
      photos.push({ name, u8: new Uint8Array(await v.photos[i].blob.arrayBuffer()), date: d });
    }
    photoNames.set(v.id, names);
  }

  const stamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
  const base = `RetailCheck_${sanitizeName(settings.employee) || 'отчёт'}_${stamp}`;
  const csvU8 = new TextEncoder().encode(buildCsv(visits, photoNames));

  return { csvName: `${base}.csv`, csvU8, photos, zipName: `${base}.zip` };
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function tryShare(files) {
  if (!(navigator.canShare && navigator.canShare({ files }))) return 'unsupported';
  try {
    await navigator.share({ files, title: 'Отчёт Retail Check' });
    return 'ok';
  } catch (err) {
    return err && err.name === 'AbortError' ? 'aborted' : 'failed';
  }
}

// Меню выбора способа отправки. Почтовые приложения Android не принимают
// смешанный набор файлов (CSV + JPEG) — поэтому даём отправить по отдельности.
let pendingShare = null; // { parts, unsent, csvDone, photosDone }

async function shareReport() {
  const unsent = (await getAllVisits())
    .filter(v => v.status === 'queued')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  if (!unsent.length) {
    toast('Нет новых визитов для отчёта');
    return;
  }

  toast('Готовим отчёт…');
  const parts = await buildReportParts(unsent);
  pendingShare = { parts, unsent, csvDone: false, photosDone: false };

  $('#shareCsv').textContent = `📄 Таблица CSV (визитов: ${unsent.length})`;
  $('#shareCsv').classList.remove('done');
  $('#sharePhotos').textContent = `🖼 Фото (${parts.photos.length})`;
  $('#sharePhotos').classList.remove('done');
  $('#sharePhotos').classList.toggle('hidden', parts.photos.length === 0);
  $('#shareZip').classList.toggle('hidden', !ZIP_SHARE_SUPPORTED);
  $('#shareSheet').classList.remove('hidden');
}

function closeShareSheet() {
  $('#shareSheet').classList.add('hidden');
}

async function markBatchSent(unsent) {
  const when = new Date().toISOString();
  for (const v of unsent) {
    if (v.status === 'sent') continue;
    v.status = 'sent';
    v.sentAt = when;
    await putVisit(v);
  }
  renderHome();
}

const csvFileOf = (parts) => new File([parts.csvU8], parts.csvName, { type: 'text/csv' });
const photoFilesOf = (parts) => parts.photos.map(p => new File([p.u8], p.name, { type: 'image/jpeg' }));

// iPhone разрешает делиться ZIP-архивами, Android — нет
const ZIP_SHARE_SUPPORTED = (() => {
  try {
    return !!(navigator.canShare &&
      navigator.canShare({ files: [new File([new Blob(['x'])], 'r.zip', { type: 'application/zip' })] }));
  } catch {
    return false;
  }
})();

function zipOf(parts) {
  return buildZip([
    { name: parts.csvName, data: parts.csvU8, date: new Date() },
    ...parts.photos.map(p => ({ name: `фото/${p.name}`, data: p.u8, date: p.date })),
  ]);
}

async function shareAllHandler() {
  const ps = pendingShare;
  if (!ps) return;
  const result = await tryShare([csvFileOf(ps.parts), ...photoFilesOf(ps.parts)]);
  if (result === 'aborted') return;
  if (result === 'ok') {
    toast(`Отчёт отправлен: визитов — ${ps.unsent.length}`);
  } else {
    // компьютер или «Поделиться» недоступно — скачиваем одним ZIP
    downloadBlob(zipOf(ps.parts), ps.parts.zipName);
    toast('Отчёт сохранён в загрузки — отправьте его коллегам вручную', 5000);
  }
  closeShareSheet();
  await markBatchSent(ps.unsent);
  pendingShare = null;
}

async function shareZipHandler() {
  const ps = pendingShare;
  if (!ps) return;
  const zip = zipOf(ps.parts);
  const result = await tryShare([new File([zip], ps.parts.zipName, { type: 'application/zip' })]);
  if (result === 'aborted') return;
  if (result === 'ok') {
    toast(`Отчёт отправлен архивом: визитов — ${ps.unsent.length}`);
  } else {
    downloadBlob(zip, ps.parts.zipName);
    toast('Архив сохранён в загрузки', 4000);
  }
  closeShareSheet();
  await markBatchSent(ps.unsent);
  pendingShare = null;
}

async function shareCsvHandler() {
  const ps = pendingShare;
  if (!ps) return;
  const result = await tryShare([csvFileOf(ps.parts)]);
  if (result === 'aborted') return;
  if (result !== 'ok') {
    downloadBlob(new Blob([ps.parts.csvU8], { type: 'text/csv' }), ps.parts.csvName);
    toast('Таблица сохранена в загрузки', 4000);
  }
  ps.csvDone = true;
  $('#shareCsv').classList.add('done');
  $('#shareCsv').textContent = '✓ Таблица отправлена';
  await markBatchSent(ps.unsent); // данные доставлены — визиты считаем отправленными
  if (ps.parts.photos.length && !ps.photosDone) {
    toast('Таблица отправлена. Теперь отправьте фото 🖼', 4000);
  } else {
    closeShareSheet();
    pendingShare = null;
  }
}

async function sharePhotosHandler() {
  const ps = pendingShare;
  if (!ps) return;
  const result = await tryShare(photoFilesOf(ps.parts));
  if (result === 'aborted') return;
  if (result !== 'ok') {
    const zip = buildZip(ps.parts.photos.map(p => ({ name: p.name, data: p.u8, date: p.date })));
    downloadBlob(zip, ps.parts.zipName.replace('.zip', '_фото.zip'));
    toast('Фото сохранены архивом в загрузки', 4000);
  }
  ps.photosDone = true;
  $('#sharePhotos').classList.add('done');
  $('#sharePhotos').textContent = '✓ Фото отправлены';
  if (!ps.csvDone) {
    toast('Фото отправлены. Теперь отправьте таблицу 📄', 4000);
  } else {
    closeShareSheet();
    pendingShare = null;
  }
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
  $('#shareAll').onclick = shareAllHandler;
  $('#shareZip').onclick = shareZipHandler;
  $('#shareCsv').onclick = shareCsvHandler;
  $('#sharePhotos').onclick = sharePhotosHandler;
  $('#shareCancel').onclick = () => { closeShareSheet(); pendingShare = null; };
  $('#shareSheet').onclick = (e) => {
    if (e.target === $('#shareSheet')) { closeShareSheet(); pendingShare = null; }
  };
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
