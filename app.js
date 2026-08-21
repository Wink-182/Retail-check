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
  { id: 'segment',  label: 'Сегмент магазина', type: 'select',
    options: ['Бюджет', 'Средний', 'Средний +', 'Премиум'] },
  { id: 'sales', label: 'Продажи', type: 'select',
    options: ['Ниже прошлого года', 'Так же', 'Выше прошлого года'] },
  { id: 'competitors', label: 'Конкуренты', type: 'textarea',
    placeholder: 'Какие бренды представлены рядом' },
  { id: 'collections', label: 'Коллекции Кастамону', type: 'multi',
    options: ['Amber', 'Black', 'Blue', 'Cherry', 'Color block', 'CraftCore',
              'Emerald', 'Green', 'Grey', 'Lagoon', 'LaMoena', 'Malva',
              'Marsala', 'Nanoclick', 'Orange', 'Prime', 'Red', 'River',
              'Royce', 'Ruby', 'Stonex', 'Sunfloor', 'Ultramarine', 'Violet',
              'Wings', 'Yellow'],
    highlight: ['CraftCore', 'LaMoena'] },
  { id: 'stands', label: 'Стенды', type: 'checkgroup',
    items: ['Кастамону', 'LaMoena', 'CraftCore'] },
  { id: 'awareness', label: 'Знание брендов', type: 'ratinggroup',
    items: ['Кастамону', 'LaMoena', 'CraftCore'],
    options: ['Не знают', 'Знают плохо', 'Знают хорошо'] },
  { id: 'priceTags', label: 'Ценники на всех позициях', type: 'yesno' },
  { id: 'pos', label: 'POS-материалы (каталоги, буклеты)', type: 'yesno' },
  { id: 'comment', label: 'Комментарии', type: 'textarea' },
];

const APP_VERSION = '2.4.0';
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
  get legals()      { try { return JSON.parse(localStorage.getItem('rc.legals')) || []; } catch { return []; } },
  set legals(v)     { localStorage.setItem('rc.legals', JSON.stringify(v)); },
  get tgToken()     { return localStorage.getItem('rc.tgToken') || ''; },
  set tgToken(v)    { localStorage.setItem('rc.tgToken', v); },
  get tgChat()      { return localStorage.getItem('rc.tgChat') || ''; },
  set tgChat(v)     { localStorage.setItem('rc.tgChat', v); },
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

  const sent = visits.filter(v => v.status === 'sent').length;
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
        <div class="visit-main">
          <div class="visit-store"></div>
          <div class="visit-meta">${fmtDate(v.startedAt)} · 📷 ${photos}</div>
        </div>
        <div class="visit-actions">
          <span class="status ${v.status}">${STATUS_LABEL[v.status] || v.status}</span>
          <button class="act act-edit" aria-label="Изменить" title="Изменить">✎</button>
          <button class="act act-send" aria-label="Отправить" title="Отправить в Telegram">✈️</button>
          <button class="act act-del" aria-label="Удалить" title="Удалить">🗑</button>
        </div>`;
      li.querySelector('.visit-store').textContent = v.store || '(без названия)';
      li.querySelector('.visit-main').onclick = () => openVisit(v);
      li.querySelector('.act-edit').onclick = () => openVisit(v);
      li.querySelector('.act-send').onclick = (e) => sendVisit(v, e.currentTarget);
      li.querySelector('.act-del').onclick = async () => {
        if (v.status !== 'sent' && !confirm('Визит ещё не отправлен. Удалить безвозвратно?')) return;
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
    legalName: '',
    phone: '',
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

// Вопрос мог раньше быть списком с галочками (например, конкуренты) —
// показываем сохранённые варианты как текст, чтобы старые визиты открывались
function asText(value) {
  if (value == null) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
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
        if (item.placeholder) ta.placeholder = item.placeholder;
        ta.value = asText(a[item.id]);
        ta.oninput = () => { a[item.id] = ta.value; };
        div.appendChild(ta);
        break;
      }

      default: { // number, text
        const inp = document.createElement('input');
        if (item.type === 'number') { inp.type = 'number'; inp.inputMode = 'numeric'; }
        if (item.placeholder) inp.placeholder = item.placeholder;
        inp.value = asText(a[item.id]);
        inp.oninput = () => { a[item.id] = inp.value; };
        div.appendChild(inp);
      }
    }
    wrap.appendChild(div);
  }
}

function fillStoreDatalist() {
  const opts = (list) => list.map(s => `<option value="${s.replace(/"/g, '&quot;')}">`).join('');
  $('#storeList').innerHTML = opts(settings.stores);
  $('#cityList').innerHTML = opts(settings.cities);
  $('#legalList').innerHTML = opts(settings.legals);
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
  $('#legalInput').value = '';
  $('#phoneInput').value = '';
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
  $('#legalInput').value = v.legalName || '';
  $('#phoneInput').value = v.phone || '';
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
// Ничего не требуем заполнять: незаполненные поля просто останутся пустыми
// в отчёте, а визит всегда можно открыть и дополнить позже.
async function saveVisit() {
  draft.store = $('#storeInput').value.trim();
  draft.city = $('#cityInput').value.trim();
  draft.legalName = $('#legalInput').value.trim();
  draft.phone = $('#phoneInput').value.trim();

  const wasSent = draft.status === 'sent';
  if (!draft.finishedAt) draft.finishedAt = new Date().toISOString();
  else draft.updatedAt = new Date().toISOString();
  draft.status = 'queued';

  // запоминаем точку, город и юрлицо в списках подсказок
  if (draft.store && !settings.stores.includes(draft.store)) {
    settings.stores = [...settings.stores, draft.store];
  }
  if (draft.city && !settings.cities.includes(draft.city)) {
    settings.cities = [...settings.cities, draft.city];
  }
  if (draft.legalName && !settings.legals.includes(draft.legalName)) {
    settings.legals = [...settings.legals, draft.legalName];
  }
  if (draft.city) settings.lastCity = draft.city;

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
      return [{ label: item.label, get: (a) => asText(a[item.id]) }];
  }
}

const ALL_COLUMNS = CHECKLIST.flatMap(itemColumns);

function buildCsv(visits, photoNames) {
  const headers = [
    'Сотрудник', 'Город', 'Точка', 'Юрлицо', 'Телефон',
    'Начало визита', 'Завершение',
    'Широта', 'Долгота', 'Точность (м)', 'Карта',
    ...ALL_COLUMNS.map(c => c.label),
    'Фото', 'ID',
  ];
  const lines = [headers.map(csvEscape).join(';')];
  for (const v of visits) {
    const a = v.answers || {};
    lines.push([
      v.employee, v.city || '', v.store, v.legalName || '', v.phone || '',
      fmtExcel(v.startedAt), fmtExcel(v.finishedAt),
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
async function buildReportParts(visits, { withPhotos = true } = {}) {
  const now = new Date();
  const photos = []; // [{name, u8, date}]
  const photoNames = new Map();
  const used = new Set();

  for (const v of visits) {
    const d = new Date(v.startedAt);
    const place = [sanitizeName(v.city), sanitizeName(v.store)].filter(Boolean).join('_') || 'визит';
    const prefix = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}_${place}`;
    const names = [];
    for (let i = 0; i < (v.photos || []).length; i++) {
      let name = `${prefix}_${i + 1}.jpg`;
      let k = 2;
      while (used.has(name)) name = `${prefix}_${i + 1}_${k++}.jpg`;
      used.add(name);
      names.push(name);
      if (withPhotos) {
        photos.push({ name, u8: new Uint8Array(await v.photos[i].blob.arrayBuffer()), date: d });
      }
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

// ============================================================
// Отправка в Telegram через бота: отчёт уходит прямо в чат,
// без системного меню «Поделиться» и без ограничений на ZIP.
// ============================================================
const TG_MAX_BYTES = 45 * 1024 * 1024; // у Bot API лимит 50 МБ на файл

const tgConfigured = () => !!(settings.tgToken && settings.tgChat);

async function tgCall(method, body) {
  const token = settings.tgToken.trim();
  if (!token) throw new Error('Не указан токен бота');
  let resp;
  try {
    resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      body,
    });
  } catch {
    throw new Error('Нет связи с Telegram — проверьте интернет');
  }
  let data = null;
  try { data = await resp.json(); } catch { /* не-JSON ответ */ }

  // на неверный токен Telegram отвечает 400/404, иногда с пустым телом
  if (!data) {
    throw new Error(resp.status === 413
      ? 'Отчёт слишком большой для Telegram'
      : 'Неверный токен бота — скопируйте его из @BotFather целиком');
  }
  if (!data.ok) {
    const desc = data.description || `HTTP ${resp.status}`;
    if (/not found/i.test(desc) && !/chat/i.test(desc)) {
      throw new Error('Неверный токен бота — скопируйте его из @BotFather целиком');
    }
    if (/chat not found/i.test(desc)) throw new Error('Чат не найден — нажмите «Определить ID чата»');
    if (/blocked|kicked/i.test(desc)) throw new Error('Бот заблокирован в этом чате');
    if (/too large|entity too large/i.test(desc)) throw new Error('Отчёт слишком большой для Telegram');
    throw new Error(`Telegram: ${desc}`);
  }
  return data.result;
}

function tgForm(fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

// Находит чат по последнему сообщению, отправленному боту
async function tgDetectChat() {
  const btn = $('#btnTgDetect');
  btn.disabled = true;
  try {
    settings.tgToken = $('#tgTokenInput').value.trim();
    const updates = await tgCall('getUpdates', tgForm({ limit: 20 }));
    const withChat = updates.filter(u => u.message || u.channel_post).pop();
    if (!withChat) {
      toast('Не вижу сообщений. Напишите боту «привет» и нажмите ещё раз', 5000);
      return;
    }
    const chat = (withChat.message || withChat.channel_post).chat;
    $('#tgChatInput').value = chat.id;
    settings.tgChat = String(chat.id);
    const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.id;
    toast(`Чат найден: ${name}`, 4000);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    btn.disabled = false;
  }
}

async function tgTest() {
  const btn = $('#btnTgTest');
  btn.disabled = true;
  try {
    settings.tgToken = $('#tgTokenInput').value.trim();
    settings.tgChat = $('#tgChatInput').value.trim();
    await tgCall('sendMessage', tgForm({
      chat_id: settings.tgChat,
      text: `✅ Retail Check на связи. Сотрудник: ${settings.employee || 'не указан'}`,
    }));
    toast('Готово — проверьте сообщение в чате', 4000);
  } catch (e) {
    toast(e.message, 5000);
  } finally {
    btn.disabled = false;
  }
}

const htmlEscape = (t) => String(t)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const B = (t) => `<b>${htmlEscape(t)}</b>`;

// Ответы чек-листа в виде читаемых строк; пустое пропускаем
function checklistLines(v) {
  const a = v.answers || {};
  const lines = [];

  for (const item of CHECKLIST) {
    switch (item.type) {

      case 'multi': {
        const val = Array.isArray(a[item.id]) ? a[item.id] : [];
        if (val.length) lines.push(`${B(item.label + ':')} ${htmlEscape(val.join(', '))}`);
        break;
      }

      case 'checkgroup': {
        const obj = a[item.id];
        if (obj && Object.keys(obj).length) {
          const marks = item.items.map(sub => `${obj[sub] ? '✅' : '❌'} ${htmlEscape(sub)}`);
          lines.push(`${B(item.label + ':')} ${marks.join(' · ')}`);
        }
        break;
      }

      case 'ratinggroup': {
        const obj = a[item.id];
        const filled = obj ? item.items.filter(sub => obj[sub]) : [];
        if (filled.length) {
          lines.push(B(item.label + ':'));
          filled.forEach(sub => lines.push(`   • ${htmlEscape(sub)} — ${htmlEscape(obj[sub])}`));
        }
        break;
      }

      case 'percents': {
        const obj = a[item.id];
        const nums = obj ? item.fields.map(f => parseFloat(obj[f.id])).filter(n => !isNaN(n)) : [];
        if (nums.length) {
          const parts = item.fields
            .filter(f => obj[f.id] !== '' && obj[f.id] != null)
            .map(f => `${htmlEscape(f.label)} ${obj[f.id]}%`);
          const rest = Math.round((100 - nums.reduce((x, n) => x + n, 0)) * 10) / 10;
          parts.push(`${htmlEscape(item.autoLabel)} ${rest}%`);
          lines.push(`${B(item.label + ':')} ${parts.join(' · ')}`);
        }
        break;
      }

      default: {
        const val = asText(a[item.id]).trim();
        if (!val) break;
        lines.push(val.includes('\n')
          ? `${B(item.label + ':')}\n${htmlEscape(val)}`
          : `${B(item.label + ':')} ${htmlEscape(val)}`);
      }
    }
  }
  return lines;
}

// Готовое сообщение по визиту — то, что придёт в чат
function visitReportText(v) {
  const head = [`🏪 ${B(v.store || 'Точка без названия')}`];
  if (v.city)      head.push(`📍 ${htmlEscape(v.city)}`);
  if (v.legalName) head.push(`🏢 ${htmlEscape(v.legalName)}`);
  if (v.phone)     head.push(`☎️ ${htmlEscape(v.phone)}`);
  head.push(`👤 ${htmlEscape(v.employee || 'без имени')} · ${fmtExcel(v.startedAt)}`);
  if (v.geo) {
    head.push(`🗺 <a href="https://yandex.ru/maps/?pt=${v.geo.lng},${v.geo.lat}&amp;z=17">Точка на карте</a>`);
  }

  const body = checklistLines(v);
  const text = head.join('\n') + (body.length ? '\n\n' + body.join('\n') : '\n\nЧек-лист не заполнен');
  return text.length > 4000 ? text.slice(0, 3990) + '\n…' : text;
}

// Фото уходят следом за отчётом: альбомом либо по одному
async function tgSendPhotos(photos, chatId) {
  for (let start = 0; start < photos.length; start += 10) {
    const chunk = photos.slice(start, start + 10);
    const fd = new FormData();
    fd.append('chat_id', chatId);

    if (chunk.length === 1) {
      fd.append('photo', new File([chunk[0].blob], chunk[0].name || 'photo.jpg', { type: 'image/jpeg' }));
      await tgCall('sendPhoto', fd);
      continue;
    }
    const media = chunk.map((p, i) => {
      fd.append(`file${i}`, new File([p.blob], p.name || `photo${i}.jpg`, { type: 'image/jpeg' }));
      return { type: 'photo', media: `attach://file${i}` };
    });
    fd.append('media', JSON.stringify(media));
    await tgCall('sendMediaGroup', fd);
  }
}

async function sendVisitToTelegram(v) {
  const chatId = settings.tgChat.trim();
  await tgCall('sendMessage', tgForm({
    chat_id: chatId,
    text: visitReportText(v),
    parse_mode: 'HTML',
    disable_web_page_preview: 'true',
  }));
  if (v.photos && v.photos.length) await tgSendPhotos(v.photos, chatId);
}

// Кнопка ✈️ на визите
async function sendVisit(v, btn) {
  if (!tgConfigured()) return shareSingleVisit(v);
  if (!navigator.onLine) {
    toast('Нет сети — отправьте, когда появится связь', 4000);
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    await sendVisitToTelegram(v);
    v.status = 'sent';
    v.sentAt = new Date().toISOString();
    await putVisit(v);
    toast(`Отправлено: ${v.store || 'визит без названия'}`);
    renderHome();
  } catch (e) {
    toast(e.message, 6000);
    if (btn) { btn.disabled = false; btn.textContent = '✈️'; }
  }
}

// Запасной путь, когда Telegram не настроен: отдаём визит через системное
// меню «Поделиться». Почта на Android не принимает таблицу и фото одним
// набором — поэтому их можно отправить по отдельности.
let pendingShare = null; // { parts, visits, csvDone, photosDone }

async function shareSingleVisit(v) {
  toast('Готовим отчёт…');
  const parts = await buildReportParts([v]);
  pendingShare = { parts, visits: [v], csvDone: false, photosDone: false };

  $('#shareCsv').textContent = '📄 Таблица CSV';
  $('#shareCsv').classList.remove('done');
  $('#sharePhotos').textContent = `🖼 Фото (${parts.photos.length})`;
  $('#sharePhotos').classList.remove('done');
  $('#sharePhotos').classList.toggle('hidden', parts.photos.length === 0);
  $('#shareZip').classList.toggle('hidden', !ZIP_SHARE_SUPPORTED);
  $('#shareSheet').classList.remove('hidden');
}

// Выгрузка общей таблицы по всем визитам — из настроек
async function exportAllCsv() {
  const visits = (await getAllVisits()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (!visits.length) {
    toast('Пока нет визитов');
    return;
  }
  const parts = await buildReportParts(visits, { withPhotos: false });
  const result = await tryShare([csvFileOf(parts)]);
  if (result === 'aborted') return;
  if (result !== 'ok') {
    downloadBlob(new Blob([parts.csvU8], { type: 'text/csv' }), parts.csvName);
    toast('Таблица сохранена в загрузки', 4000);
  }
}

function closeShareSheet() {
  $('#shareSheet').classList.add('hidden');
}

async function markBatchSent(visits) {
  const when = new Date().toISOString();
  for (const v of visits) {
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
    toast(`Отчёт отправлен`);
  } else {
    // компьютер или «Поделиться» недоступно — скачиваем одним ZIP
    downloadBlob(zipOf(ps.parts), ps.parts.zipName);
    toast('Отчёт сохранён в загрузки — отправьте его коллегам вручную', 5000);
  }
  closeShareSheet();
  await markBatchSent(ps.visits);
  pendingShare = null;
}

async function shareZipHandler() {
  const ps = pendingShare;
  if (!ps) return;
  const zip = zipOf(ps.parts);
  const result = await tryShare([new File([zip], ps.parts.zipName, { type: 'application/zip' })]);
  if (result === 'aborted') return;
  if (result === 'ok') {
    toast(`Отчёт отправлен архивом`);
  } else {
    downloadBlob(zip, ps.parts.zipName);
    toast('Архив сохранён в загрузки', 4000);
  }
  closeShareSheet();
  await markBatchSent(ps.visits);
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
  await markBatchSent(ps.visits); // данные доставлены — визиты считаем отправленными
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
  $('#tgTokenInput').value = settings.tgToken;
  $('#tgChatInput').value = settings.tgChat;
  $('#versionInfo').textContent = `Retail Check v${APP_VERSION}`;
}

function saveSettings() {
  settings.employee = $('#employeeInput').value.trim();
  settings.stores = $('#storesInput').value.split('\n').map(s => s.trim()).filter(Boolean);
  settings.tgToken = $('#tgTokenInput').value.trim();
  settings.tgChat = $('#tgChatInput').value.trim();
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
  $('#btnExportCsv').onclick = exportAllCsv;
  $('#btnTgDetect').onclick = tgDetectChat;
  $('#btnTgTest').onclick = tgTest;
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
