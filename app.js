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
              'Emerald', 'Grey', 'Ideal', 'Lagoon', 'LaMoena', 'Malva',
              'Marsala', 'Nanoclick', 'Prime', 'Red', 'River', 'Royce',
              'Ruby', 'Stonex', 'Sunfloor', 'Ultramarine', 'Violet', 'Wings'],
    highlight: ['CraftCore', 'LaMoena'] },
  { id: 'awareness', label: 'Знание брендов', type: 'ratinggroup',
    items: ['Кастамону', 'LaMoena', 'CraftCore'],
    options: ['Не знают', 'Знают плохо', 'Знают хорошо'] },
  { id: 'priceTags', label: 'Ценники на всех позициях', type: 'yesno' },
  { id: 'pos', label: 'Наклейки', type: 'yesno' },
  { id: 'comment', label: 'Комментарии', type: 'textarea' },
];

const APP_VERSION = '3.2.0';
const MAX_PHOTOS = 50;
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
// Логотип Telegram для кнопки отправки
const TG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.223-.548.223l.19-2.72 5.56-5.022c.24-.213-.054-.334-.373-.121L8.48 13.037l-2.95-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z"/></svg>';

// «Леруа Мерлен, ООО «Ромашка»» — пустое просто не пишем
function visitTitle(v) {
  return [v.store, v.legalName].filter(Boolean).join(', ') || '(без названия)';
}

async function renderHome() {
  const visits = (await getAllVisits()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const list = $('#visitList');
  list.innerHTML = '';
  $('#emptyHint').classList.toggle('hidden', visits.length > 0);
  $('#setupHint').classList.toggle('hidden', !!settings.employee);
  $('#offlineBanner').classList.toggle('hidden', navigator.onLine);

  for (const v of visits) {
    const li = document.createElement('li');
    const photos = v.photos ? v.photos.length : 0;
    const status = v.status === 'sent'
      ? `<span class="status sent">Отправлен</span>` +
        (v.edited ? '<span class="status edited">отредактирован</span>' : '')
      : '<span class="status queued">Не отправлен</span>';

    li.innerHTML = `
      <div class="visit-main">
        <div class="visit-store"></div>
        <div class="visit-meta">${fmtDate(v.startedAt)} · 📷 ${photos}</div>
        <div class="visit-badges">${status}</div>
      </div>
      <div class="visit-actions">
        <button class="act act-edit" aria-label="Изменить" title="Изменить">✎</button>
        <button class="act act-tg" aria-label="Отправить в Telegram" title="Отправить в Telegram">${TG_ICON}</button>
        <button class="act act-mail" aria-label="Отправить письмом" title="Отправить письмом (PDF)">✉️</button>
        <button class="act act-del" aria-label="Удалить" title="Удалить">🗑</button>
      </div>`;
    li.querySelector('.visit-store').textContent = visitTitle(v);
    li.querySelector('.visit-main').onclick = () => openVisit(v);
    li.querySelector('.act-edit').onclick = () => openVisit(v);
    li.querySelector('.act-tg').onclick = (e) => sendVisit(v, e.currentTarget);
    li.querySelector('.act-mail').onclick = (e) => shareVisitPdf(v, e.currentTarget);
    li.querySelector('.act-del').onclick = async () => {
      if (v.status !== 'sent' && !confirm('Визит ещё не отправлен. Удалить безвозвратно?')) return;
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
  if (draft.geo) {
    chip.className = 'geo-chip ok';
    const how = draft.geo.source === 'manual'
      ? 'указано вручную'
      : `±${draft.geo.accuracy} м`;
    chip.textContent = `📍 Координаты записаны (${how})`;
  } else {
    chip.className = 'geo-chip fail';
    chip.textContent = '📍 Координаты не записаны';
  }
}

// Автоопределение — только при создании визита. При правке визита позже
// координаты не трогаем: иначе отчёт из дома увёз бы домашний адрес.
function captureGeo() {
  const chip = $('#geoStatus');
  chip.className = 'geo-chip';
  chip.textContent = '📍 Определяем местоположение…';

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
        source: 'gps',
        capturedAt: new Date().toISOString(),
      };
      renderGeoChip();
    },
    () => {
      chip.textContent = '📍 Не удалось определить место — нажмите «Изменить»';
      chip.classList.add('fail');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

// ---------- Правка координат ----------
// Понимает «55.75, 37.61», ссылки Яндекс.Карт и Google Карт
function parseCoords(text) {
  const t = String(text || '').trim();
  if (!t) return null;

  const nums = (re, s) => (s.match(re) || []).map(Number);

  // Яндекс: ll=/pt= идут в порядке «долгота,широта»
  const ya = t.match(/[?&](?:ll|pt|whatshere\[point\])=(-?\d+\.?\d*)[,%]+(?:2C)?(-?\d+\.?\d*)/i);
  if (ya) return norm(+ya[2], +ya[1]);

  // Google: /@широта,долгота или q=широта,долгота
  const gg = t.match(/[@=](-?\d+\.\d+),(-?\d+\.\d+)/);
  if (gg) return norm(+gg[1], +gg[2]);

  // «55,751244 37,618423» — запятая как десятичный разделитель
  const ru = t.match(/^\s*(-?\d+),(\d+)\s*[,;\s]\s*(-?\d+),(\d+)\s*$/);
  if (ru) return norm(+`${ru[1]}.${ru[2]}`, +`${ru[3]}.${ru[4]}`);

  const plain = nums(/-?\d+\.?\d*/g, t);
  if (plain.length >= 2) return norm(plain[0], plain[1]);
  return null;
}

function norm(lat, lng) {
  // если перепутан порядок — широта не бывает больше 90
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) [lat, lng] = [lng, lat];
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
}

// Что предложила кнопка «взять текущее» — применяем только по «Сохранить»,
// чтобы «Отмена» действительно отменяла
let geoPending = null;

function openGeoSheet() {
  geoPending = null;
  $('#geoInput').value = draft.geo ? `${draft.geo.lat}, ${draft.geo.lng}` : '';
  $('#geoSheet').classList.remove('hidden');
}

function closeGeoSheet() {
  geoPending = null;
  $('#geoSheet').classList.add('hidden');
}

function geoOpenMap() {
  const base = 'https://yandex.ru/maps/';
  const url = draft.geo
    ? `${base}?ll=${draft.geo.lng},${draft.geo.lat}&z=17&pt=${draft.geo.lng},${draft.geo.lat}`
    : `${base}?text=${encodeURIComponent([$('#cityInput').value, $('#storeInput').value].filter(Boolean).join(' '))}`;
  window.open(url, '_blank', 'noopener');
  toast('Найдите точку, нажмите на неё и скопируйте координаты сюда', 6000);
}

function geoUseCurrent() {
  if (!confirm('Записать координаты того места, где вы находитесь сейчас?\n\n' +
               'Делайте это только в самом магазине — иначе в отчёт попадёт ваше текущее место.')) return;
  const btn = $('#geoUseCurrent');
  const reset = () => { btn.disabled = false; btn.textContent = '📍 Взять моё текущее местоположение'; };
  btn.disabled = true;
  btn.textContent = '📍 Определяем…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      geoPending = {
        lat: +pos.coords.latitude.toFixed(6),
        lng: +pos.coords.longitude.toFixed(6),
        accuracy: Math.round(pos.coords.accuracy),
        source: 'gps',
      };
      $('#geoInput').value = `${geoPending.lat}, ${geoPending.lng}`;
      reset();
      toast('Координаты подставлены — нажмите «Сохранить»', 4000);
    },
    () => {
      reset();
      toast('Не удалось определить местоположение', 4000);
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

function geoSave() {
  const raw = $('#geoInput').value.trim();
  if (!raw) {
    draft.geo = null;
    renderGeoChip();
    closeGeoSheet();
    toast('Координаты убраны');
    return;
  }
  const parsed = parseCoords(raw);
  if (!parsed) {
    toast('Не понял координаты. Нужно «55.751244, 37.618423» или ссылка с карты', 5000);
    return;
  }
  // если поле не правили после «взять текущее» — сохраняем точность от GPS
  const fromGps = geoPending && geoPending.lat === parsed.lat && geoPending.lng === parsed.lng;
  draft.geo = fromGps
    ? { ...geoPending, capturedAt: new Date().toISOString() }
    : { ...parsed, source: 'manual', capturedAt: new Date().toISOString() };
  renderGeoChip();
  closeGeoSheet();
  toast('Координаты сохранены');
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
  // уже отправленный визит остаётся отправленным, но помечается изменённым
  if (wasSent) draft.edited = true;
  else draft.status = 'queued';

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
    ? 'Визит обновлён — отправьте заново, если нужно'
    : 'Визит сохранён');
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
        if (val.length) {
          lines.push(B(item.label + ':'));
          // порядок как в списке — так проще пробегать глазами
          item.options.filter(o => val.includes(o))
            .forEach(o => lines.push(`• ${htmlEscape(o)}`));
        }
        break;
      }

      case 'checkgroup': {
        const obj = a[item.id];
        if (obj && Object.keys(obj).length) {
          lines.push(B(item.label + ':'));
          item.items.forEach(sub => lines.push(`${obj[sub] ? '✅' : '❌'} ${htmlEscape(sub)}`));
        }
        break;
      }

      case 'ratinggroup': {
        const obj = a[item.id];
        const filled = obj ? item.items.filter(sub => obj[sub]) : [];
        if (filled.length) {
          lines.push(B(item.label + ':'));
          filled.forEach(sub => lines.push(`• ${htmlEscape(sub)} — ${htmlEscape(obj[sub])}`));
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
  const head = [];
  if (v.city) head.push(`📍 ${htmlEscape(v.city)}`);

  // магазин, юрлицо и телефон — один блок под одной пиктограммой
  head.push(`🏪 ${B(v.store || 'Точка без названия')}`);
  if (v.legalName) head.push(htmlEscape(v.legalName));
  if (v.phone)     head.push(htmlEscape(v.phone));

  head.push(`👤 ${htmlEscape(v.employee || 'без имени')} · ${fmtExcel(v.startedAt)}`);
  if (v.geo) {
    head.push(`🗺 <a href="https://yandex.ru/maps/?pt=${v.geo.lng},${v.geo.lat}&amp;z=17">Точка на карте</a>`);
  }

  const body = checklistLines(v);
  const text = head.join('\n') + (body.length ? '\n\n' + body.join('\n') : '\n\nЧек-лист не заполнен');
  return text.length > 4000 ? text.slice(0, 3990) + '\n…' : text;
}

// Снимаем разметку Telegram — для PDF нужен чистый текст
function stripTags(t) {
  return String(t)
    .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '$2')
    .replace(/<\/?b>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
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
  if (!tgConfigured()) {
    toast('Сначала настройте Telegram', 4000);
    nav('settings');
    return;
  }
  const what = visitTitle(v);
  const again = v.status === 'sent' ? '\nЭтот визит уже отправляли — придёт ещё раз.' : '';
  if (!confirm(`Отправить отчёт в Telegram?\n\n${what}${again}`)) return;
  if (!navigator.onLine) {
    toast('Нет сети — отправьте, когда появится связь', 4000);
    return;
  }
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    await sendVisitToTelegram(v);
    v.status = 'sent';
    v.edited = false;
    v.sentAt = new Date().toISOString();
    await putVisit(v);
    toast(`Отправлено: ${visitTitle(v)}`);
    renderHome();
  } catch (e) {
    toast(e.message, 6000);
    if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
  }
}

// ---------- Отправка архивом (почта, Teams и всё остальное) ----------
// ============================================================
// Отчёт письмом — один PDF: страница с отчётом и по странице
// на каждое фото. PDF, в отличие от архива, Android пропускает
// в меню «Поделиться», поэтому почта в нём появляется.
// ============================================================
const A4 = { w: 595.28, h: 841.89 };   // размер страницы в пунктах
const PDF_SCALE = 2;                   // текст рисуем в двойном разрешении

const pdfEnc = new TextEncoder();

function deflate(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Response(stream).arrayBuffer().then(b => new Uint8Array(b));
}

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error('Не удалось загрузить ' + src));
  img.src = src;
});

// Страница отчёта: рисуем на холсте, чтобы кириллица выглядела как в приложении
async function renderReportPage(v) {
  const W = Math.round(A4.w * PDF_SCALE);
  const H = Math.round(A4.h * PDF_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, W, H);

  const M = 56 * PDF_SCALE;             // поля страницы
  let y = M;

  try {
    const logo = await loadImage('icons/logo-kastamonu-color.png');
    const lw = 150 * PDF_SCALE;
    const lh = lw * logo.height / logo.width;
    c.drawImage(logo, M, y, lw, lh);
    y += lh + 30 * PDF_SCALE;
  } catch {
    y += 12 * PDF_SCALE;
  }

  c.fillStyle = '#06038D';
  c.font = `700 ${10 * PDF_SCALE}px Arial, sans-serif`;
  c.fillText('ОТЧЁТ О ВИЗИТЕ В ТОЧКУ ПРОДАЖ', M, y);
  y += 10 * PDF_SCALE;
  c.fillStyle = '#00B140';
  c.fillRect(M, y, W - M * 2, 2 * PDF_SCALE);
  y += 30 * PDF_SCALE;

  const maxW = W - M * 2;
  const line = (text, opts = {}) => {
    const { size = 11, bold = false, color = '#1d2b28', indent = 0, gap = 7 } = opts;
    c.fillStyle = color;
    c.font = `${bold ? '700 ' : ''}${size * PDF_SCALE}px Arial, sans-serif`;
    const words = String(text).split(' ');
    let cur = '';
    const flush = () => {
      c.fillText(cur, M + indent * PDF_SCALE, y);
      y += (size + gap) * PDF_SCALE;
    };
    for (const word of words) {
      const test = cur ? cur + ' ' + word : word;
      if (c.measureText(test).width > maxW - indent * PDF_SCALE && cur) {
        flush();
        cur = word;
      } else {
        cur = test;
      }
    }
    if (cur) flush();
  };

  line(v.store || 'Точка без названия', { size: 18, bold: true, color: '#06038D', gap: 9 });
  if (v.legalName) line(v.legalName, { size: 11, color: '#64766f', gap: 4 });
  if (v.phone) line(v.phone, { size: 11, color: '#64766f', gap: 4 });
  if (v.city) line('Город: ' + v.city, { size: 11, color: '#64766f', gap: 4 });
  line(`${v.employee || 'Сотрудник не указан'} · ${fmtExcel(v.startedAt)}`,
       { size: 11, color: '#64766f', gap: 4 });
  if (v.geo) line(`Координаты: ${v.geo.lat}, ${v.geo.lng}`, { size: 10, color: '#64766f', gap: 4 });
  y += 20 * PDF_SCALE;

  // эмодзи в PDF выглядят чужеродно — ставим обычные знаки
  const body = checklistLines(v)
    .map(stripTags)
    .map(t => t.replace(/^✅\s*/, '✓ ').replace(/^❌\s*/, '✕ '));

  if (!body.length) {
    line('Чек-лист не заполнен', { size: 11, color: '#64766f' });
  } else {
    for (const t of body) {
      const isBullet = /^[•✓✕]/.test(t);
      const isHeading = !isBullet && t.endsWith(':');
      line(t, {
        size: 11,
        bold: isHeading,
        color: isHeading ? '#06038D' : '#1d2b28',
        indent: isBullet ? 14 : 0,
        gap: isBullet ? 5 : 7,
      });
    }
  }

  const photos = (v.photos || []).length;
  if (photos) {
    y += 14 * PDF_SCALE;
    line(`Фотографий: ${photos} — на следующих страницах`, { size: 10, color: '#64766f' });
  }

  // на старых iPhone нет CompressionStream — там кладём страницу как JPEG
  if (typeof CompressionStream === 'undefined') {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
    return { w: W, h: H, jpeg: new Uint8Array(await blob.arrayBuffer()) };
  }

  // отдаём страницу в цвете: на белом фоне она сжимается почти без потерь
  const px = c.getImageData(0, 0, W, H).data;
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    rgb[j] = px[i];
    rgb[j + 1] = px[i + 1];
    rgb[j + 2] = px[i + 2];
  }
  return { w: W, h: H, rgb: await deflate(rgb) };
}

// ---------- Сборка PDF ----------
const pdfNum = (n) => (Math.round(n * 100) / 100).toString();

async function buildVisitPdf(v) {
  const pages = [await renderReportPage(v)];

  for (const p of (v.photos || [])) {
    const u8 = new Uint8Array(await p.blob.arrayBuffer());
    const bmp = await createImageBitmap(p.blob);
    pages.push({ w: bmp.width, h: bmp.height, jpeg: u8 });
    bmp.close();
  }

  // объект 1 — каталог, дальше нумеруем по порядку добавления
  const objects = [];
  const add = (obj) => { objects.push(obj); return objects.length + 1; };

  const pageRefs = [];
  for (const pg of pages) {
    const isJpeg = !!pg.jpeg;
    const data = isJpeg ? pg.jpeg : pg.rgb;
    const imgNum = add({
      head: pdfEnc.encode(
        `<</Type/XObject/Subtype/Image/Width ${pg.w}/Height ${pg.h}` +
        `/ColorSpace/DeviceRGB/BitsPerComponent 8` +
        `/Filter/${isJpeg ? 'DCTDecode' : 'FlateDecode'}/Length ${data.length}>>\nstream\n`),
      data,
      tail: pdfEnc.encode('\nendstream'),
    });

    // вписываем изображение в страницу
    const margin = pg.rgb ? 0 : (pages.indexOf(pg) === 0 ? 0 : 36);
    const scale = Math.min((A4.w - margin * 2) / pg.w, (A4.h - margin * 2) / pg.h);
    const dw = pg.w * scale;
    const dh = pg.h * scale;
    const content = pdfEnc.encode(
      `q ${pdfNum(dw)} 0 0 ${pdfNum(dh)} ${pdfNum((A4.w - dw) / 2)} ${pdfNum((A4.h - dh) / 2)} cm /Im Do Q`);
    const contentNum = add({
      head: pdfEnc.encode(`<</Length ${content.length}>>\nstream\n`),
      data: content,
      tail: pdfEnc.encode('\nendstream'),
    });
    pageRefs.push({ imgNum, contentNum });
  }

  // номер объекта со списком страниц известен заранее — он последний
  const pagesNum = objects.length + pageRefs.length + 2;
  const kids = pageRefs.map(po => add({
    head: pdfEnc.encode(
      `<</Type/Page/Parent ${pagesNum} 0 R/MediaBox[0 0 ${pdfNum(A4.w)} ${pdfNum(A4.h)}]` +
      `/Resources<</XObject<</Im ${po.imgNum} 0 R>>>>/Contents ${po.contentNum} 0 R>>`),
  }));
  add({
    head: pdfEnc.encode(
      `<</Type/Pages/Kids[${kids.map(k => k + ' 0 R').join(' ')}]/Count ${kids.length}>>`),
  });

  // склеиваем файл, попутно запоминая смещения объектов
  const parts = [];
  let offset = 0;
  const push = (u8) => { parts.push(u8); offset += u8.length; };

  push(pdfEnc.encode('%PDF-1.4\n'));
  push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));

  const offsets = [0];
  offsets.push(offset);
  push(pdfEnc.encode(`1 0 obj\n<</Type/Catalog/Pages ${pagesNum} 0 R>>\nendobj\n`));

  objects.forEach((o, i) => {
    offsets.push(offset);
    push(pdfEnc.encode(`${i + 2} 0 obj\n`));
    push(o.head);
    if (o.data) push(o.data);
    if (o.tail) push(o.tail);
    push(pdfEnc.encode('\nendobj\n'));
  });

  const xrefPos = offset;
  const total = objects.length + 2;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  xref += `trailer\n<</Size ${total}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`;
  push(pdfEnc.encode(xref));

  return new Blob(parts, { type: 'application/pdf' });
}

async function shareVisitPdf(v, btn) {
  const label = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  try {
    const pdf = await buildVisitPdf(v);
    const stamp = fmtExcel(v.startedAt).slice(0, 10).split('.').reverse().join('-');
    const place = sanitizeName([v.city, v.store].filter(Boolean).join(' ')) || 'визит';
    const name = `RetailCheck_${place}_${stamp}.pdf`;
    const result = await tryShare([new File([pdf], name, { type: 'application/pdf' })]);

    if (result === 'aborted') return;
    if (result === 'ok') {
      toast('Отчёт отправлен');
    } else {
      downloadBlob(pdf, name);
      toast('PDF сохранён в загрузки', 5000);
    }
    v.status = 'sent';
    v.edited = false;
    v.sentAt = new Date().toISOString();
    await putVisit(v);
    renderHome();
  } catch (e) {
    toast(String(e.message || e), 5000);
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; }
  }
}

function renderSettings() {
  $('#employeeInput').value = settings.employee;
  $('#tgTokenInput').value = settings.tgToken;
  $('#tgChatInput').value = settings.tgChat;
  $('#versionInfo').textContent = `Retail Check v${APP_VERSION}`;
}

function saveSettings() {
  settings.employee = $('#employeeInput').value.trim();
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
  $('#btnTgDetect').onclick = tgDetectChat;
  $('#btnTgTest').onclick = tgTest;
  $('#btnGeoEdit').onclick = openGeoSheet;
  $('#geoOpenMap').onclick = geoOpenMap;
  $('#geoUseCurrent').onclick = geoUseCurrent;
  $('#geoSave').onclick = geoSave;
  $('#geoCancel').onclick = closeGeoSheet;
  $('#geoSheet').onclick = (e) => { if (e.target === $('#geoSheet')) closeGeoSheet(); };
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
