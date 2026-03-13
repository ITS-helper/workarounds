/**
 * ============================================================
 *  AUTH + SUPABASE SYNC — ITSSupport Portal v3
 * ============================================================
 *
 *  Подключение (в index.html перед </body>):
 *    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
 *    <script src="auth-sync.js"></script>
 *
 *  Supabase таблицы (SQL — см. sql-setup.sql):
 *    checklist_state  — состояние чек-листа
 *    tasks_state      — задачник (передача смены)
 *    portal_users     — пользователи (опционально)
 *
 *  Этот модуль:
 *    1. Логин+пароль, сессия в localStorage (постоянная)
 *    2. Пользователи: из Supabase portal_users или запасные USERS
 *    3. Чек-лист: автосинхронизация + realtime
 *    4. Задачник: автосинхронизация + realtime
 *    5. Кнопка «Выйти»
 */

(function () {
  'use strict';

  // ===== КОНФИГ =====
  const SUPABASE_URL     = 'https://yjlkfylgglurwyhbxudr.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqbGtmeWxnZ2x1cnd5aGJ4dWRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NDMxODEsImV4cCI6MjA4ODUxOTE4MX0.FspLFmsXUCrIfmvOSrJolhhDhbKDxJO8hfJFNl0LrdM';

  const TABLE          = 'checklist_state';
  const ROW_ID         = 'shared';
  const TASKS_TABLE    = 'tasks_state';
  const TASKS_ROW_ID   = 'shared';
  const USERS_TABLE    = 'portal_users';
  const TASKS_LS_KEY   = 'taskbook_state_v1';

  const AUTO_SAVE_INTERVAL = 30000;
  const AUTH_SESSION_KEY   = 'portal_auth_v3'; // v3 = localStorage
  const SYNC_PAUSED_KEY    = 'portal_sync_paused';

  // ===== ЗАПАСНЫЕ ПОЛЬЗОВАТЕЛИ =====
  const USERS_FALLBACK = {
    admin:  { password: 'kejexu8hem', name: 'Администратор', role: 'admin' },
    ilgar:  { password: 'VELES_2024', name: 'Ильгар Гаджиев', role: 'user' },
    ivan:   { password: 'VELES_2024', name: 'Иван Шуйский',   role: 'user' },
    rustam: { password: 'VELES_2024', name: 'Рустам Газизуллин', role: 'user' },
    guest:  { password: 'VELES_2024', name: 'Гость',          role: 'guest' },
  };

  // ===== СОСТОЯНИЕ =====
  let supabase           = null;
  let channel            = null;
  let tasksChannel       = null;
  let isOnline           = true;
  let lastRemoteUpdate   = 0;
  let ignoreNextRemote   = false;
  let autoSaveTimer      = null;
  let lastPushedHash     = '';
  let lastTasksHash      = '';
  let tasksRemoteLoaded  = false;
  let currentUser        = null;
  let remoteStateLoaded  = false;
  let syncPausedByUser   = false;
  let usersFromSupabase  = null;

  // ===== УТИЛИТЫ =====
  function simpleHash(obj) { return JSON.stringify(obj); }
  function getUsers() { return usersFromSupabase || USERS_FALLBACK; }

  // ===== РАННЯЯ ИНИЦИАЛИЗАЦИЯ SUPABASE =====
  function initSupabaseClient() {
    if (supabase) return supabase;
    if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
      try {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      } catch (e) {
        console.error('[Sync] Ошибка создания клиента:', e);
      }
    }
    return supabase;
  }

  // ===== ЗАГРУЗКА ПОЛЬЗОВАТЕЛЕЙ ИЗ SUPABASE =====
  async function fetchPortalUsers() {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from(USERS_TABLE)
        .select('login, password, display_name, role');
      if (error || !data || !data.length) return;
      usersFromSupabase = {};
      data.forEach(u => {
        usersFromSupabase[u.login] = {
          password: u.password,
          name: u.display_name || u.login,
          role: u.role || 'user'
        };
      });
      console.log('[Auth] Пользователи из Supabase:', Object.keys(usersFromSupabase).join(', '));
    } catch (e) {
      // Таблица не создана — используем запасных пользователей
    }
  }

  // ===== АВТОРИЗАЦИЯ =====

  function patchAuthOverlay() {
    const overlay = document.getElementById('authOverlay');
    if (!overlay) return;

    // Проверяем сохранённую сессию (localStorage — постоянная)
    try {
      const saved = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY));
      const users = getUsers();
      if (saved && (users[saved.login] || USERS_FALLBACK[saved.login])) {
        currentUser = saved;
        overlay.remove();
        onAuthSuccess();
        return;
      }
    } catch (e) {}

    // Строим форму входа
    const authBox = overlay.querySelector('.auth-box');
    if (!authBox) return;

    authBox.innerHTML = `
      <div class="auth-brand">
        <img class="auth-logo-img" src="./images/ITS_logo_horizont.png" alt="ITS"
             onerror="this.style.display='none'">
      </div>
      <input class="auth-input" type="text" id="authLogin" placeholder="Логин"
             autocomplete="username" autocapitalize="none" spellcheck="false"
             style="text-transform:lowercase;">
      <input class="auth-input" type="password" id="authPass" placeholder="Пароль"
             autocomplete="current-password">
      <button class="auth-btn" id="authBtn">Войти</button>
      <span class="auth-error" id="authError"></span>
    `;

    const loginInput = document.getElementById('authLogin');
    const passInput  = document.getElementById('authPass');
    const btn        = document.getElementById('authBtn');
    const err        = document.getElementById('authError');

    function doNewAuth() {
      const login = loginInput.value.trim().toLowerCase();
      const pass  = passInput.value;

      if (!login) { showAuthError('Введите логин'); loginInput.focus(); return; }

      const user = getUsers()[login];
      if (!user) { showAuthError('Неизвестный логин'); loginInput.value = ''; loginInput.focus(); return; }

      if (pass !== user.password) { showAuthError('Неверный пароль'); passInput.value = ''; passInput.focus(); return; }

      currentUser = { login, name: user.name, role: user.role };
      localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(currentUser));

      overlay.classList.add('hidden');
      setTimeout(() => overlay.remove(), 350);
      onAuthSuccess();
    }

    function showAuthError(text) {
      err.textContent = text;
      setTimeout(() => { err.textContent = ''; }, 2500);
    }

    btn.addEventListener('click', doNewAuth);
    loginInput.addEventListener('keydown', e => { if (e.key === 'Enter') passInput.focus(); });
    passInput.addEventListener('keydown',  e => { if (e.key === 'Enter') doNewAuth(); });

    window.doAuth = doNewAuth;
    setTimeout(() => loginInput.focus(), 100);
  }

  function onAuthSuccess() {
    if (!currentUser) return;

    syncPausedByUser = sessionStorage.getItem(SYNC_PAUSED_KEY) === '1';

    const workerNameEl = document.getElementById('workerName');
    if (workerNameEl && currentUser.role !== 'guest') {
      if (!workerNameEl.value || workerNameEl.value.trim() === '') {
        workerNameEl.value = currentUser.name;
      }
    }

    if (typeof portalInit === 'function') { try { portalInit(); } catch (e) {} }

    initSync();
  }

  function isGuest()   { return currentUser && currentUser.role === 'guest'; }
  function canWrite()  { return currentUser && currentUser.role !== 'guest'; }

  // ===== КНОПКА ВЫЙТИ =====
  window.portalLogout = function () {
    if (!confirm('Выйти из портала?')) return;
    localStorage.removeItem(AUTH_SESSION_KEY);
    // Совместимость со старыми ключами
    localStorage.removeItem('portal_auth_v2');
    sessionStorage.removeItem('portal_auth');
    window.location.reload();
  };

  // ===== SUPABASE SYNC — ИНИЦИАЛИЗАЦИЯ =====

  function initSync() {
    if (!supabase) {
      initSupabaseClient();
      if (!supabase) {
        console.warn('[Sync] Supabase SDK не загружен');
        injectSyncIndicator();
        showSyncStatus('offline', 'SDK не загружен');
        return;
      }
    }

    injectSyncIndicator();
    loadRemoteState();
    subscribeRealtime();
    loadTasksFromRemote();
    subscribeTasksRealtime();

    if (canWrite()) {
      hookIntoSaveState();
      startAutoSave();
    }

    window.addEventListener('online', () => {
      isOnline = true;
      showSyncStatus('syncing', 'Подключение…');
      if (canWrite()) pushToRemote();
    });
    window.addEventListener('offline', () => {
      isOnline = false;
      showSyncStatus('offline', 'Нет сети — работаю локально');
    });

    console.log(`[Sync] Инициализирован. Пользователь: ${currentUser.name} (${currentUser.role})`);
  }

  // ===== ИНДИКАТОР =====

  function injectSyncIndicator() {
    const tryInject = () => {
      const reportSection = document.querySelector('#page-checklist .report-section');
      if (!reportSection) { setTimeout(tryInject, 500); return; }
      if (document.getElementById('syncIndicator')) return;

      const indicator = document.createElement('div');
      indicator.id = 'syncIndicator';
      indicator.style.cssText = `
        display:flex;align-items:center;gap:8px;
        padding:10px 14px;margin-top:10px;
        background:#F9FAFB;border:1px solid var(--border,#E8EDF2);
        border-radius:10px;font-size:13px;
        font-family:'Source Sans 3',sans-serif;color:#78909C;
        transition:all 0.3s ease;flex-wrap:wrap;
      `;

      const roleBadge = isGuest()
        ? `<span style="background:#FFF3E0;color:#E65100;border-radius:999px;padding:1px 8px;font-size:11px;font-family:'Oswald',sans-serif;font-weight:600;letter-spacing:0.04em;">ГОСТЬ</span>`
        : `<span style="background:#E8F5E9;color:#2E7D32;border-radius:999px;padding:1px 8px;font-size:11px;font-family:'Oswald',sans-serif;font-weight:600;letter-spacing:0.04em;">${currentUser.login.toUpperCase()}</span>`;

      const saveBtnHtml = canWrite()
        ? `<button type="button" id="syncSaveBtn" style="padding:4px 12px;border-radius:8px;border:1px solid var(--accent,#2196F3);background:#2196F3;color:#fff;font-size:12px;font-family:'Oswald',sans-serif;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;cursor:pointer;">Сохранить</button>`
        : '';

      indicator.innerHTML = `
        <span id="syncDot" style="width:8px;height:8px;border-radius:50%;background:#78909C;flex-shrink:0;transition:background 0.3s;"></span>
        <span id="syncText" style="flex:1;">Подключение…</span>
        ${saveBtnHtml}
        ${roleBadge}
        <button type="button" onclick="portalLogout()" style="padding:3px 10px;border-radius:8px;border:1px solid #E0E0E0;background:#F9FAFB;color:#78909C;font-size:11px;font-family:'Oswald',sans-serif;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;cursor:pointer;white-space:nowrap;">Выйти</button>
      `;
      reportSection.parentNode.insertBefore(indicator, reportSection.nextSibling);

      const saveBtn = document.getElementById('syncSaveBtn');
      if (saveBtn) {
        if (syncPausedByUser) saveBtn.textContent = 'Включить автообновление';
        saveBtn.addEventListener('click', function () {
          if (syncPausedByUser) {
            syncPausedByUser = false;
            sessionStorage.removeItem(SYNC_PAUSED_KEY);
            saveBtn.textContent = 'Сохранить';
            showSyncStatus('synced', 'Автообновление включено');
            loadRemoteState();
          } else {
            syncPausedByUser = true;
            sessionStorage.setItem(SYNC_PAUSED_KEY, '1');
            saveBtn.textContent = 'Включить автообновление';
            pushToRemote();
            const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
            showSyncStatus('synced', 'Сохранено · ' + time + ' · Обновления приостановлены');
          }
        });
      }
    };
    tryInject();
  }

  function showSyncStatus(status, text) {
    const dot = document.getElementById('syncDot');
    const txt = document.getElementById('syncText');
    if (!dot || !txt) return;

    const indicator = document.getElementById('syncIndicator');
    const colors = { synced:'#43A047', syncing:'#FFA726', error:'#EF5350', offline:'#78909C' };

    dot.style.background  = colors[status] || colors.offline;
    dot.style.animation   = status === 'syncing' ? 'pulse-sync 1s infinite' : 'none';
    txt.textContent = text;

    if (status === 'synced' && text.includes('обновил') && indicator) {
      indicator.style.background   = '#E8F5E9';
      indicator.style.borderColor  = '#A7F3D0';
      setTimeout(() => { indicator.style.background = '#F9FAFB'; indicator.style.borderColor = ''; }, 3000);
    }
  }

  const style = document.createElement('style');
  style.textContent = `@keyframes pulse-sync { 0%,100%{opacity:1} 50%{opacity:0.3} }`;
  document.head.appendChild(style);

  // ===== ЗАДАЧНИК SYNC =====

  async function loadTasksFromRemote() {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from(TASKS_TABLE).select('data, updated_at, updated_by')
        .eq('id', TASKS_ROW_ID).single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Строки ещё нет — создаём
          await supabase.from(TASKS_TABLE).insert({ id: TASKS_ROW_ID, data: { user: '', tasks: [] } });
        }
        tasksRemoteLoaded = true;
        return;
      }

      if (data && data.data) {
        const remoteData = data.data;
        const remoteHash = JSON.stringify(remoteData);
        const localHash  = JSON.stringify(typeof window.hnData !== 'undefined' ? window.hnData : null);

        if (remoteHash !== localHash) {
          window.hnData = remoteData;
          localStorage.setItem(TASKS_LS_KEY, JSON.stringify(remoteData));
          if (typeof hnInit === 'function') { try { hnInit(); } catch (e) {} }
        }

        lastTasksHash = remoteHash;
      }
      tasksRemoteLoaded = true;
    } catch (e) {
      console.error('[Tasks] Ошибка загрузки:', e);
      tasksRemoteLoaded = true;
    }
  }

  window.pushTasksToRemote = async function () {
    if (!supabase || !isOnline || !tasksRemoteLoaded) return;
    const data = typeof window.hnData !== 'undefined' ? window.hnData : null;
    if (!data) return;
    const hash = JSON.stringify(data);
    if (hash === lastTasksHash) return;

    try {
      const { error } = await supabase.from(TASKS_TABLE).upsert({
        id: TASKS_ROW_ID,
        data: data,
        updated_at: new Date().toISOString(),
        updated_by: currentUser ? currentUser.name : 'Аноним'
      });
      if (error) throw error;
      lastTasksHash = hash;
    } catch (e) {
      console.error('[Tasks] Ошибка записи:', e);
    }
  };

  function subscribeTasksRealtime() {
    if (!supabase) return;
    tasksChannel = supabase
      .channel('tasks-sync-v1')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: TASKS_TABLE,
        filter: `id=eq.${TASKS_ROW_ID}`
      }, (payload) => {
        const newData = payload.new && payload.new.data;
        if (!newData) return;
        const hash = JSON.stringify(newData);
        if (hash === lastTasksHash) return; // наше собственное изменение
        lastTasksHash = hash;
        window.hnData = newData;
        localStorage.setItem(TASKS_LS_KEY, JSON.stringify(newData));
        if (typeof hnInit === 'function') { try { hnInit(); } catch (e) {} }
        console.log('[Tasks] Realtime обновление от', payload.new.updated_by || '?');
      })
      .subscribe();
  }

  // ===== СБОР СОСТОЯНИЯ ЧЕКЛИСТА =====

  function collectState() {
    const workerName = document.getElementById('workerName')  ? document.getElementById('workerName').value  : '';
    const workDate   = document.getElementById('workDate')    ? document.getElementById('workDate').value   : '';

    const tasks = {};
    document.querySelectorAll('#page-checklist input[type="checkbox"][data-task-id]').forEach(cb => {
      tasks[cb.dataset.taskId] = cb.checked;
    });

    const counts = {};
    document.querySelectorAll('#page-checklist .task-count[data-count-for]').forEach(inp => {
      counts[inp.dataset.countFor] = inp.value;
    });

    const tagEvents = {
      countNew:  document.getElementById('countNew')  ? document.getElementById('countNew').textContent  : '0',
      countLost: document.getElementById('countLost') ? document.getElementById('countLost').textContent : '0',
      notesNew:  document.getElementById('notesNew')  ? document.getElementById('notesNew').value        : '',
      notesLost: document.getElementById('notesLost') ? document.getElementById('notesLost').value       : ''
    };

    const deployment = {};
    ['pool', 'spg1', 'spg2', 'spg3', 'spg4', 'dayoff'].forEach(z => {
      const container = z === 'pool' ? document.getElementById('pool') : document.getElementById('zone-' + z);
      if (container) deployment[z] = Array.from(container.querySelectorAll('.person-chip')).map(c => c.dataset.person);
    });

    const inetTimes = Array.from(document.querySelectorAll('.inet-time-row')).map(row => ({
      from: row.querySelector('.inet-from') ? row.querySelector('.inet-from').value : '',
      to:   row.querySelector('.inet-to')   ? row.querySelector('.inet-to').value   : ''
    }));

    return {
      tasks, counts, tag_events: tagEvents, deployment,
      meta: {
        lastUpdatedBy:    currentUser ? currentUser.name  : (workerName || 'Аноним'),
        lastUpdatedByLogin: currentUser ? currentUser.login : '',
        lastUpdatedAt:    Date.now(),
        workDate, inetTimes
      }
    };
  }

  // ===== ПРИМЕНЕНИЕ СОСТОЯНИЯ ЧЕКЛИСТА =====

  function applyState(data) {
    if (!data) return;

    if (data.tasks) {
      Object.entries(data.tasks).forEach(([id, checked]) => {
        const cb = document.querySelector(`[data-task-id="${id}"]`);
        if (cb && cb.checked !== checked) {
          cb.checked = checked;
          const subtask = cb.closest('.subtask');
          if (subtask) subtask.classList.toggle('completed', checked);
        }
      });
    }

    if (data.counts) {
      Object.entries(data.counts).forEach(([id, value]) => {
        const inp = document.querySelector(`.task-count[data-count-for="${id}"]`);
        if (inp && inp.value !== String(value)) inp.value = value;
      });
    }

    if (data.tag_events) {
      const te = data.tag_events;
      const elNew   = document.getElementById('countNew');
      const elLost  = document.getElementById('countLost');
      const elNNew  = document.getElementById('notesNew');
      const elNLost = document.getElementById('notesLost');
      if (elNew   && elNew.textContent  !== te.countNew)  elNew.textContent  = te.countNew;
      if (elLost  && elLost.textContent !== te.countLost) elLost.textContent = te.countLost;
      if (elNNew  && elNNew.value       !== te.notesNew)  elNNew.value       = te.notesNew;
      if (elNLost && elNLost.value      !== te.notesLost) elNLost.value      = te.notesLost;
    }

    if (data.deployment && typeof applyDeploymentState === 'function') {
      try { applyDeploymentState(data.deployment); } catch (e) {}
    }

    if (data.meta && data.meta.inetTimes) {
      const times = data.meta.inetTimes;
      if (typeof renderInetTimes === 'function' && times.length > 0) {
        const inetCountEl = document.getElementById('inetCount');
        if (inetCountEl && parseInt(inetCountEl.value) !== times.length) {
          inetCountEl.value = times.length;
          renderInetTimes(times.length);
        }
        times.forEach((t, i) => {
          const rows = document.querySelectorAll('.inet-time-row');
          if (rows[i]) {
            const fromEl = rows[i].querySelector('.inet-from');
            const toEl   = rows[i].querySelector('.inet-to');
            if (fromEl && fromEl.value !== t.from) fromEl.value = t.from;
            if (toEl   && toEl.value   !== t.to)   toEl.value   = t.to;
          }
        });
      }
    }

    if (typeof updateAllProgress === 'function') updateAllProgress();
  }

  // ===== ЗАГРУЗКА ЧЕКЛИСТА =====

  async function loadRemoteState() {
    if (!supabase) return;
    showSyncStatus('syncing', 'Загрузка…');

    try {
      const { data, error } = await supabase.from(TABLE).select('*').eq('id', ROW_ID).single();

      if (error) {
        if (error.code === 'PGRST116') {
          await supabase.from(TABLE).insert({ id: ROW_ID });
          remoteStateLoaded = true;
          showSyncStatus('synced', 'Готово — данных пока нет');
        } else { throw error; }
        return;
      }

      if (data) {
        lastRemoteUpdate = (data.meta && data.meta.lastUpdatedAt) ? data.meta.lastUpdatedAt : 0;

        if (syncPausedByUser) {
          remoteStateLoaded = true;
          showSyncStatus('synced', 'Обновления приостановлены (нажмите «Включить автообновление»)');
          return;
        }

        applyState(data);
        remoteStateLoaded = true;
        if (typeof clSaveState === 'function') { try { clSaveState(); } catch (e) {} }

        const who  = (data.meta && data.meta.lastUpdatedBy) ? data.meta.lastUpdatedBy : '';
        const when = (data.meta && data.meta.lastUpdatedAt)
          ? new Date(data.meta.lastUpdatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : '';
        const prefix = isGuest() ? '👁 Просмотр' : 'Синхронизировано';
        showSyncStatus('synced', who && when ? `${prefix} · ${who}, ${when}` : prefix);
      }
    } catch (e) {
      console.error('[Sync] Ошибка загрузки:', e);
      showSyncStatus('error', 'Ошибка загрузки');
    }
  }

  // ===== ОТПРАВКА ЧЕКЛИСТА =====

  async function pushToRemote() {
    if (!supabase || !isOnline || !canWrite() || !remoteStateLoaded) return;

    const state = collectState();
    const hash  = simpleHash(state);
    if (hash === lastPushedHash) return;

    showSyncStatus('syncing', 'Сохранение…');
    ignoreNextRemote = true;

    try {
      const { error } = await supabase.from(TABLE).upsert({
        id: ROW_ID,
        tasks:      state.tasks,
        counts:     state.counts,
        tag_events: state.tag_events,
        deployment: state.deployment,
        meta:       state.meta,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;

      lastPushedHash   = hash;
      lastRemoteUpdate = state.meta.lastUpdatedAt;
      const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      showSyncStatus('synced', syncPausedByUser ? `Сохранено · ${time} · Обновления приостановлены` : `Сохранено · ${time}`);
    } catch (e) {
      console.error('[Sync] Ошибка записи:', e);
      showSyncStatus('error', 'Ошибка сохранения');
      ignoreNextRemote = false;
    }
  }

  // ===== АВТОСОХРАНЕНИЕ =====

  function startAutoSave() {
    if (!canWrite()) return;
    autoSaveTimer = setInterval(() => { if (isOnline && supabase) pushToRemote(); }, AUTO_SAVE_INTERVAL);
    window.addEventListener('beforeunload', () => { if (canWrite()) { pushToRemote(); pushTasksToRemote(); } });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && canWrite()) { pushToRemote(); window.pushTasksToRemote && window.pushTasksToRemote(); }
    });
    console.log(`[Sync] Автосохранение каждые ${AUTO_SAVE_INTERVAL / 1000} сек.`);
  }

  // ===== REALTIME ЧЕКЛИСТ =====

  function subscribeRealtime() {
    if (!supabase) return;
    channel = supabase
      .channel('checklist-sync-v2')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: TABLE, filter: `id=eq.${ROW_ID}`
      }, (payload) => {
        if (ignoreNextRemote) { ignoreNextRemote = false; return; }
        const data = payload.new;
        if (!data || syncPausedByUser) return;

        const remoteTs = (data.meta && data.meta.lastUpdatedAt) ? data.meta.lastUpdatedAt : 0;
        if (remoteTs <= lastRemoteUpdate) return;
        lastRemoteUpdate = remoteTs;

        if (isGuest()) {
          const who  = (data.meta && data.meta.lastUpdatedBy) || 'Кто-то';
          const when = new Date(remoteTs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          showSyncStatus('synced', `👁 ${who} обновил · ${when} (вы в режиме просмотра)`);
          return;
        }

        applyState(data);
        const who  = (data.meta && data.meta.lastUpdatedBy) || 'Кто-то';
        const when = new Date(remoteTs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        showSyncStatus('synced', `${who} обновил · ${when}`);
        if (typeof clSaveState === 'function') { try { clSaveState(); } catch (e) {} }
      })
      .subscribe((status) => {
        if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          showSyncStatus('offline', 'Переподключение…');
          setTimeout(subscribeRealtime, 5000);
        }
      });
  }

  // ===== ПЕРЕХВАТ clSaveState =====

  function hookIntoSaveState() {
    if (!canWrite()) return;
    const checkInterval = setInterval(() => {
      if (typeof window.clSaveState === 'function' && !window._clSaveStateHooked) {
        const originalSave = window.clSaveState;
        window.clSaveState = function () { originalSave.apply(this, arguments); };
        window._clSaveStateHooked = true;
        clearInterval(checkInterval);
      }
    }, 500);
    setTimeout(() => clearInterval(checkInterval), 15000);
  }

  // ===== ПЕРЕХВАТ ОРИГИНАЛЬНОЙ АВТОРИЗАЦИИ =====

  function interceptOriginalAuth() {
    // Блокируем старый механизм авторизации
    sessionStorage.removeItem('portal_auth');
    localStorage.removeItem('portal_auth_v2'); // старый ключ

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', patchAuthOverlay);
    } else {
      patchAuthOverlay();
    }
  }

  // ===== ЗАПУСК =====

  // Инициализируем Supabase сразу (до авторизации — для загрузки пользователей)
  initSupabaseClient();
  fetchPortalUsers(); // async, не блокирует

  // Проверяем сохранённую сессию
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY));
    if (saved && (USERS_FALLBACK[saved.login])) {
      currentUser = saved;
      // Устанавливаем совместимость со старым механизмом
      sessionStorage.setItem('portal_auth', '1');
    }
  } catch (e) {}

  interceptOriginalAuth();

})();
