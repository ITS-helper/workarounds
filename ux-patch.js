/**
 * ============================================================
 *  AUTH + SUPABASE SYNC — ITSSupport Portal v2
 * ============================================================
 *
 *  Подключение (в index.html перед </body>):
 *    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
 *    <script src="auth-sync.js"></script>
 *
 *  Этот модуль:
 *    1. Переделывает логин: логин + пароль
 *    2. Роли: admin, ilgar, ivan, rustam — полный доступ + синхронизация
 *             guest — только чтение (чеклист не обновляется от синхронизации)
 *    3. Автосохранение в Supabase каждые 10 секунд
 *    4. Realtime-подписка для мгновенных обновлений
 *    5. Индикатор: кто залогинен + статус синхронизации
 */

(function () {
  'use strict';

  // ===== КОНФИГ =====
  const SUPABASE_URL = 'https://yjlkfylgglurwyhbxudr.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqbGtmeWxnZ2x1cnd5aGJ4dWRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NDMxODEsImV4cCI6MjA4ODUxOTE4MX0.FspLFmsXUCrIfmvOSrJolhhDhbKDxJO8hfJFNl0LrdM';
  const TABLE = 'checklist_state';
  const ROW_ID = 'shared';
  const AUTO_SAVE_INTERVAL = 10000; // 10 секунд
  const AUTH_SESSION_KEY = 'portal_auth_v2';

  // ===== ПОЛЬЗОВАТЕЛИ =====
  const USERS = {
    admin:  { password: 'VELES_2024', name: 'Администратор', role: 'admin' },
    ilgar:  { password: 'VELES_2024', name: 'Ильгар Гаджиев', role: 'user' },
    ivan:   { password: 'VELES_2024', name: 'Иван Шуйский', role: 'user' },
    rustam: { password: 'VELES_2024', name: 'Рустам Газизуллин', role: 'user' },
    guest:  { password: 'VELES_2024', name: 'Гость', role: 'guest' },
  };

  // ===== СОСТОЯНИЕ =====
  let supabase = null;
  let channel = null;
  let isOnline = true;
  let lastRemoteUpdate = 0;
  let ignoreNextRemote = false;
  let autoSaveTimer = null;
  let lastPushedHash = '';
  let currentUser = null; // { login, name, role }

  // ===== УТИЛИТЫ =====
  function simpleHash(obj) {
    return JSON.stringify(obj);
  }

  // ===== АВТОРИЗАЦИЯ =====

  function patchAuthOverlay() {
    const overlay = document.getElementById('authOverlay');
    if (!overlay) return;

    // Проверяем сохранённую сессию
    try {
      const saved = JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY));
      if (saved && USERS[saved.login]) {
        currentUser = saved;
        overlay.remove();
        onAuthSuccess();
        return;
      }
    } catch (e) {}

    // Переделываем форму — добавляем поле логина
    const authBox = overlay.querySelector('.auth-box');
    if (!authBox) return;

    // Удаляем старый обработчик кнопки
    const oldBtn = authBox.querySelector('.auth-btn');
    const oldInput = authBox.querySelector('.auth-input');

    // Полностью перестраиваем содержимое
    authBox.innerHTML = `
      <span class="auth-logo">ITSSupport</span>
      <span class="auth-title">Портал инженера</span>
      <input class="auth-input" type="text" id="authLogin" placeholder="Логин"
             autocomplete="username" autocapitalize="none" spellcheck="false"
             style="text-transform:lowercase;">
      <input class="auth-input" type="password" id="authPass" placeholder="Пароль"
             autocomplete="current-password">
      <button class="auth-btn" id="authBtn">Войти</button>
      <span class="auth-error" id="authError"></span>
    `;

    // Обработчики
    const loginInput = document.getElementById('authLogin');
    const passInput = document.getElementById('authPass');
    const btn = document.getElementById('authBtn');
    const err = document.getElementById('authError');

    function doNewAuth() {
      const login = loginInput.value.trim().toLowerCase();
      const pass = passInput.value;

      if (!login) {
        showAuthError('Введите логин');
        loginInput.focus();
        return;
      }

      const user = USERS[login];
      if (!user) {
        showAuthError('Неизвестный логин');
        loginInput.value = '';
        loginInput.focus();
        return;
      }

      if (pass !== user.password) {
        showAuthError('Неверный пароль');
        passInput.value = '';
        passInput.focus();
        return;
      }

      // Успех
      currentUser = { login, name: user.name, role: user.role };
      sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(currentUser));

      overlay.classList.add('hidden');
      setTimeout(() => overlay.remove(), 350);
      onAuthSuccess();
    }

    function showAuthError(text) {
      err.textContent = text;
      setTimeout(() => { err.textContent = ''; }, 2500);
    }

    btn.addEventListener('click', doNewAuth);
    loginInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') passInput.focus();
    });
    passInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doNewAuth();
    });

    // Перехватываем старую функцию doAuth чтобы не мешала
    window.doAuth = doNewAuth;

    // Фокус
    setTimeout(() => loginInput.focus(), 100);
  }

  function onAuthSuccess() {
    if (!currentUser) return;

    // Автозаполняем имя сотрудника
    const workerNameEl = document.getElementById('workerName');
    if (workerNameEl && currentUser.role !== 'guest') {
      if (!workerNameEl.value || workerNameEl.value.trim() === '') {
        workerNameEl.value = currentUser.name;
      }
    }

    // Вызываем оригинальную portalInit если ещё не вызвана
    if (typeof portalInit === 'function') {
      try { portalInit(); } catch (e) {}
    }

    // Инициализируем Supabase синхронизацию
    initSync();
  }

  function isGuest() {
    return currentUser && currentUser.role === 'guest';
  }

  function canWrite() {
    return currentUser && currentUser.role !== 'guest';
  }

  // ===== SUPABASE SYNC =====

  function initSync() {
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      console.warn('[Sync] Supabase SDK не загружен');
      injectSyncIndicator();
      showSyncStatus('offline', 'SDK не загружен');
      return;
    }

    try {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.error('[Sync] Ошибка:', e);
      injectSyncIndicator();
      showSyncStatus('error', 'Ошибка подключения');
      return;
    }

    injectSyncIndicator();
    loadRemoteState();
    subscribeRealtime();

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
    // Ждём пока чеклист-страница станет доступна
    const tryInject = () => {
      const reportSection = document.querySelector('#page-checklist .report-section');
      if (!reportSection) {
        setTimeout(tryInject, 500);
        return;
      }

      if (document.getElementById('syncIndicator')) return;

      const indicator = document.createElement('div');
      indicator.id = 'syncIndicator';
      indicator.style.cssText = `
        display: flex; align-items: center; gap: 8px;
        padding: 10px 14px; margin-top: 10px;
        background: #F9FAFB; border: 1px solid var(--border, #E8EDF2);
        border-radius: 10px; font-size: 13px;
        font-family: 'Source Sans 3', sans-serif; color: #78909C;
        transition: all 0.3s ease; flex-wrap: wrap;
      `;

      const roleLabel = isGuest() ? '👁 Гость (только просмотр)' : `👤 ${currentUser.name}`;
      const roleBadge = isGuest()
        ? `<span style="background:#FFF3E0;color:#E65100;border-radius:999px;padding:1px 8px;font-size:11px;font-family:'Oswald',sans-serif;font-weight:600;letter-spacing:0.04em;">ГОСТЬ</span>`
        : `<span style="background:#E8F5E9;color:#2E7D32;border-radius:999px;padding:1px 8px;font-size:11px;font-family:'Oswald',sans-serif;font-weight:600;letter-spacing:0.04em;">${currentUser.login.toUpperCase()}</span>`;

      indicator.innerHTML = `
        <span id="syncDot" style="width:8px;height:8px;border-radius:50%;background:#78909C;flex-shrink:0;transition:background 0.3s;"></span>
        <span id="syncText" style="flex:1;">Подключение…</span>
        ${roleBadge}
      `;
      reportSection.parentNode.insertBefore(indicator, reportSection.nextSibling);
    };

    tryInject();
  }

  function showSyncStatus(status, text) {
    const dot = document.getElementById('syncDot');
    const txt = document.getElementById('syncText');
    if (!dot || !txt) return;

    const indicator = document.getElementById('syncIndicator');
    const colors = {
      synced: '#43A047',
      syncing: '#FFA726',
      error: '#EF5350',
      offline: '#78909C'
    };

    dot.style.background = colors[status] || colors.offline;
    dot.style.animation = status === 'syncing' ? 'pulse-sync 1s infinite' : 'none';
    txt.textContent = text;

    if (status === 'synced' && text.includes('обновил') && indicator) {
      indicator.style.background = '#E8F5E9';
      indicator.style.borderColor = '#A7F3D0';
      setTimeout(() => {
        indicator.style.background = '#F9FAFB';
        indicator.style.borderColor = '';
      }, 3000);
    }
  }

  // CSS
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse-sync {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  `;
  document.head.appendChild(style);

  // ===== СБОР СОСТОЯНИЯ =====

  function collectState() {
    const workerName = document.getElementById('workerName')?.value || '';
    const workDate = document.getElementById('workDate')?.value || '';

    const tasks = {};
    document.querySelectorAll('#page-checklist input[type="checkbox"][data-task-id]').forEach(cb => {
      tasks[cb.dataset.taskId] = cb.checked;
    });

    const counts = {};
    document.querySelectorAll('#page-checklist .task-count[data-count-for]').forEach(inp => {
      counts[inp.dataset.countFor] = inp.value;
    });

    const tagEvents = {
      countNew: document.getElementById('countNew')?.textContent || '0',
      countLost: document.getElementById('countLost')?.textContent || '0',
      notesNew: document.getElementById('notesNew')?.value || '',
      notesLost: document.getElementById('notesLost')?.value || ''
    };

    const deployment = {};
    ['pool', 'spg1', 'spg2', 'spg3', 'spg4', 'dayoff'].forEach(z => {
      const container = z === 'pool' ? document.getElementById('pool') : document.getElementById('zone-' + z);
      if (container) {
        deployment[z] = Array.from(container.querySelectorAll('.person-chip')).map(c => c.dataset.person);
      }
    });

    const inetTimes = Array.from(document.querySelectorAll('.inet-time-row')).map(row => ({
      from: row.querySelector('.inet-from')?.value || '',
      to: row.querySelector('.inet-to')?.value || ''
    }));

    return {
      tasks,
      counts,
      tag_events: tagEvents,
      deployment,
      meta: {
        lastUpdatedBy: currentUser?.name || workerName || 'Аноним',
        lastUpdatedByLogin: currentUser?.login || '',
        lastUpdatedAt: Date.now(),
        workDate,
        inetTimes
      }
    };
  }

  // ===== ПРИМЕНЕНИЕ СОСТОЯНИЯ =====

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
      const elNew = document.getElementById('countNew');
      const elLost = document.getElementById('countLost');
      const elNotesNew = document.getElementById('notesNew');
      const elNotesLost = document.getElementById('notesLost');
      if (elNew && elNew.textContent !== te.countNew) elNew.textContent = te.countNew;
      if (elLost && elLost.textContent !== te.countLost) elLost.textContent = te.countLost;
      if (elNotesNew && elNotesNew.value !== te.notesNew) elNotesNew.value = te.notesNew;
      if (elNotesLost && elNotesLost.value !== te.notesLost) elNotesLost.value = te.notesLost;
    }

    if (data.deployment && typeof applyDeploymentState === 'function') {
      try { applyDeploymentState(data.deployment); } catch (e) {}
    }

    if (data.meta?.inetTimes) {
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
            const toEl = rows[i].querySelector('.inet-to');
            if (fromEl && fromEl.value !== t.from) fromEl.value = t.from;
            if (toEl && toEl.value !== t.to) toEl.value = t.to;
          }
        });
      }
    }

    if (typeof updateAllProgress === 'function') updateAllProgress();
  }

  // ===== ЗАГРУЗКА =====

  async function loadRemoteState() {
    if (!supabase) return;
    showSyncStatus('syncing', 'Загрузка…');

    try {
      const { data, error } = await supabase
        .from(TABLE).select('*').eq('id', ROW_ID).single();

      if (error) {
        if (error.code === 'PGRST116') {
          await supabase.from(TABLE).insert({ id: ROW_ID });
          showSyncStatus('synced', 'Готово — данных пока нет');
        } else {
          throw error;
        }
        return;
      }

      if (data) {
        lastRemoteUpdate = data.meta?.lastUpdatedAt || 0;

        // Гость: применяем состояние (только чтение)
        // Остальные: тоже применяем (синхронизация)
        applyState(data);

        const who = data.meta?.lastUpdatedBy || '';
        const when = data.meta?.lastUpdatedAt
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

  // ===== ОТПРАВКА =====

  async function pushToRemote() {
    if (!supabase || !isOnline || !canWrite()) return;

    const state = collectState();
    const hash = simpleHash(state);

    // Не отправляем если ничего не изменилось
    if (hash === lastPushedHash) return;

    showSyncStatus('syncing', 'Сохранение…');
    ignoreNextRemote = true;

    try {
      const { error } = await supabase
        .from(TABLE)
        .upsert({
          id: ROW_ID,
          tasks: state.tasks,
          counts: state.counts,
          tag_events: state.tag_events,
          deployment: state.deployment,
          meta: state.meta,
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      lastPushedHash = hash;
      lastRemoteUpdate = state.meta.lastUpdatedAt;
      const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      showSyncStatus('synced', `Сохранено · ${time}`);
    } catch (e) {
      console.error('[Sync] Ошибка записи:', e);
      showSyncStatus('error', 'Ошибка сохранения');
      ignoreNextRemote = false;
    }
  }

  // ===== АВТОСОХРАНЕНИЕ КАЖДЫЕ 10 СЕКУНД =====

  function startAutoSave() {
    if (!canWrite()) return;

    autoSaveTimer = setInterval(() => {
      if (isOnline && supabase) {
        pushToRemote();
      }
    }, AUTO_SAVE_INTERVAL);

    // Сохраняем при уходе со страницы
    window.addEventListener('beforeunload', () => {
      if (canWrite()) pushToRemote();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && canWrite()) pushToRemote();
    });

    console.log(`[Sync] Автосохранение каждые ${AUTO_SAVE_INTERVAL / 1000} сек.`);
  }

  // ===== REALTIME =====

  function subscribeRealtime() {
    if (!supabase) return;

    channel = supabase
      .channel('checklist-sync-v2')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: TABLE,
        filter: `id=eq.${ROW_ID}`
      }, (payload) => {
        if (ignoreNextRemote) {
          ignoreNextRemote = false;
          return;
        }

        const data = payload.new;
        if (!data) return;

        const remoteTs = data.meta?.lastUpdatedAt || 0;
        if (remoteTs <= lastRemoteUpdate) return;

        lastRemoteUpdate = remoteTs;

        // Гость: НЕ применяем изменения к UI (только просмотр того что было при входе)
        if (isGuest()) {
          const who = data.meta?.lastUpdatedBy || 'Кто-то';
          const when = new Date(remoteTs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          showSyncStatus('synced', `👁 ${who} обновил · ${when} (вы в режиме просмотра)`);
          return;
        }

        applyState(data);

        const who = data.meta?.lastUpdatedBy || 'Кто-то';
        const when = new Date(remoteTs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        showSyncStatus('synced', `${who} обновил · ${when}`);

        // Сохраняем в localStorage
        if (typeof clSaveState === 'function') {
          try { clSaveState(); } catch (e) {}
        }

        console.log(`[Sync] Обновление от ${who}`);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Sync] Realtime подписка активна');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
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
        window.clSaveState = function () {
          originalSave.apply(this, arguments);
          // Не делаем мгновенную отправку — автосохранение сделает это через ≤10 сек
          // Но при важных действиях (закрытие страницы) pushToRemote вызовется напрямую
        };
        window._clSaveStateHooked = true;
        clearInterval(checkInterval);
        console.log('[Sync] Перехват clSaveState установлен');
      }
    }, 500);

    setTimeout(() => clearInterval(checkInterval), 15000);
  }

  // ===== ПЕРЕХВАТ ОРИГИНАЛЬНОЙ АВТОРИЗАЦИИ =====

  function interceptOriginalAuth() {
    // Убираем оригинальную проверку из sessionStorage
    // чтобы наша новая форма работала вместо старой
    sessionStorage.removeItem('portal_auth');

    // Ждём DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        patchAuthOverlay();
      });
    } else {
      patchAuthOverlay();
    }
  }

  // ===== ЗАПУСК =====

  // Проверяем сессию сразу
  try {
    const saved = JSON.parse(sessionStorage.getItem(AUTH_SESSION_KEY));
    if (saved && USERS[saved.login]) {
      currentUser = saved;
      // Сессия есть — пропускаем auth, помечаем старую сессию
      sessionStorage.setItem('portal_auth', '1');
    }
  } catch (e) {}

  interceptOriginalAuth();

})();
