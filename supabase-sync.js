/**
 * ============================================
 *  SUPABASE REALTIME SYNC — ITSSupport Portal
 * ============================================
 *
 *  Подключение:
 *    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
 *    <script src="supabase-sync.js"></script>
 *
 *  Этот модуль:
 *    1. При каждом изменении чеклиста — пишет данные в Supabase
 *    2. Слушает realtime-изменения и применяет их к UI
 *    3. Показывает индикатор синхронизации
 *    4. Работает оффлайн через localStorage (fallback)
 */

(function () {
  'use strict';

  // ===== КОНФИГ SUPABASE =====
  const SUPABASE_URL = 'https://yjlkfylgglurwyhbxudr.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqbGtmeWxnZ2x1cnd5aGJ4dWRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NDMxODEsImV4cCI6MjA4ODUxOTE4MX0.FspLFmsXUCrIfmvOSrJolhhDhbKDxJO8hfJFNl0LrdM';
  const TABLE = 'checklist_state';
  const ROW_ID = 'shared';

  // ===== СОСТОЯНИЕ =====
  let supabase = null;
  let channel = null;
  let isOnline = true;
  let isSyncing = false;
  let lastRemoteUpdate = 0;    // timestamp последнего пришедшего обновления
  let ignoreNextRemote = false; // не применять своё же обновление
  let syncDebounceTimer = null;
  const DEBOUNCE_MS = 800;     // задержка перед отправкой (чтобы не слать на каждый клик)

  // ===== ИНИЦИАЛИЗАЦИЯ =====
  function init() {
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      console.warn('[Sync] Supabase JS SDK не загружен. Синхронизация отключена.');
      showSyncStatus('offline', 'SDK не загружен');
      return;
    }

    try {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } catch (e) {
      console.error('[Sync] Ошибка создания клиента:', e);
      showSyncStatus('error', 'Ошибка подключения');
      return;
    }

    injectSyncIndicator();
    loadRemoteState();
    subscribeRealtime();
    hookIntoSaveState();

    // Отслеживаем онлайн/оффлайн
    window.addEventListener('online', () => {
      isOnline = true;
      showSyncStatus('syncing', 'Подключение…');
      pushToRemote();
    });
    window.addEventListener('offline', () => {
      isOnline = false;
      showSyncStatus('offline', 'Нет сети — работаю локально');
    });

    console.log('[Sync] Supabase Realtime Sync инициализирован');
  }

  // ===== ИНДИКАТОР СИНХРОНИЗАЦИИ =====
  function injectSyncIndicator() {
    // Проверяем, что мы на странице чеклиста
    const reportSection = document.querySelector('#page-checklist .report-section');
    if (!reportSection) return;

    const indicator = document.createElement('div');
    indicator.id = 'syncIndicator';
    indicator.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      padding: 8px 14px; margin-top: 10px;
      background: #F9FAFB; border: 1px solid var(--border, #E8EDF2);
      border-radius: 10px; font-size: 13px;
      font-family: 'Source Sans 3', sans-serif; color: #78909C;
      transition: all 0.3s ease;
    `;
    indicator.innerHTML = `
      <span id="syncDot" style="width:8px;height:8px;border-radius:50%;background:#78909C;flex-shrink:0;transition:background 0.3s;"></span>
      <span id="syncText">Подключение…</span>
    `;
    reportSection.parentNode.insertBefore(indicator, reportSection.nextSibling);
  }

  function showSyncStatus(status, text) {
    const dot = document.getElementById('syncDot');
    const txt = document.getElementById('syncText');
    if (!dot || !txt) return;

    const indicator = document.getElementById('syncIndicator');

    const colors = {
      synced:  '#43A047',
      syncing: '#FFA726',
      error:   '#EF5350',
      offline: '#78909C'
    };

    dot.style.background = colors[status] || colors.offline;

    if (status === 'syncing') {
      dot.style.animation = 'pulse-sync 1s infinite';
    } else {
      dot.style.animation = 'none';
    }

    txt.textContent = text;

    // Подсветка при обновлении от другого пользователя
    if (status === 'synced' && text.includes('обновил')) {
      indicator.style.background = '#E8F5E9';
      indicator.style.borderColor = '#A7F3D0';
      setTimeout(() => {
        indicator.style.background = '#F9FAFB';
        indicator.style.borderColor = '';
      }, 3000);
    }
  }

  // Добавляем CSS анимацию
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse-sync {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
  `;
  document.head.appendChild(style);

  // ===== СБОР СОСТОЯНИЯ ИЗ UI =====
  function collectState() {
    const workerName = document.getElementById('workerName')?.value || '';
    const workDate = document.getElementById('workDate')?.value || '';

    // Задачи (галочки)
    const tasks = {};
    document.querySelectorAll('#page-checklist input[type="checkbox"][data-task-id]').forEach(cb => {
      tasks[cb.dataset.taskId] = cb.checked;
    });

    // Счётчики
    const counts = {};
    document.querySelectorAll('#page-checklist .task-count[data-count-for]').forEach(inp => {
      counts[inp.dataset.countFor] = inp.value;
    });

    // Метки (новые / потерянные)
    const tagEvents = {
      countNew: document.getElementById('countNew')?.textContent || '0',
      countLost: document.getElementById('countLost')?.textContent || '0',
      notesNew: document.getElementById('notesNew')?.value || '',
      notesLost: document.getElementById('notesLost')?.value || ''
    };

    // Расстановка
    const deployment = {};
    ['pool', 'spg1', 'spg2', 'spg3', 'spg4', 'dayoff'].forEach(z => {
      const container = z === 'pool' ? document.getElementById('pool') : document.getElementById('zone-' + z);
      if (container) {
        deployment[z] = Array.from(container.querySelectorAll('.person-chip')).map(c => c.dataset.person);
      }
    });

    // Интернет-таймы
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
        lastUpdatedBy: workerName || 'Аноним',
        lastUpdatedAt: Date.now(),
        workDate,
        inetTimes
      }
    };
  }

  // ===== ПРИМЕНЕНИЕ СОСТОЯНИЯ К UI =====
  function applyState(data) {
    if (!data) return;

    // Задачи
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

    // Счётчики
    if (data.counts) {
      Object.entries(data.counts).forEach(([id, value]) => {
        const inp = document.querySelector(`.task-count[data-count-for="${id}"]`);
        if (inp && inp.value !== String(value)) {
          inp.value = value;
        }
      });
    }

    // Метки
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

    // Расстановка
    if (data.deployment && typeof applyDeploymentState === 'function') {
      try {
        applyDeploymentState(data.deployment);
      } catch (e) {
        console.warn('[Sync] Ошибка применения расстановки:', e);
      }
    }

    // Интернет-таймы
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

    // Обновляем прогресс-бары
    if (typeof updateAllProgress === 'function') {
      updateAllProgress();
    }
  }

  // ===== ЗАГРУЗКА С СЕРВЕРА =====
  async function loadRemoteState() {
    if (!supabase) return;
    showSyncStatus('syncing', 'Загрузка…');

    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('id', ROW_ID)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Записи нет — создаём
          console.log('[Sync] Создаю начальную запись…');
          await supabase.from(TABLE).insert({ id: ROW_ID });
          showSyncStatus('synced', 'Готово — данных пока нет');
        } else {
          throw error;
        }
        return;
      }

      if (data) {
        lastRemoteUpdate = data.meta?.lastUpdatedAt || 0;
        applyState(data);

        const who = data.meta?.lastUpdatedBy || '';
        const when = data.meta?.lastUpdatedAt
          ? new Date(data.meta.lastUpdatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          : '';

        showSyncStatus('synced', who && when ? `Синхронизировано · ${who}, ${when}` : 'Синхронизировано');
      }
    } catch (e) {
      console.error('[Sync] Ошибка загрузки:', e);
      showSyncStatus('error', 'Ошибка загрузки данных');
    }
  }

  // ===== ОТПРАВКА НА СЕРВЕР =====
  async function pushToRemote() {
    if (!supabase || !isOnline) return;

    isSyncing = true;
    showSyncStatus('syncing', 'Сохранение…');
    ignoreNextRemote = true;

    const state = collectState();

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

      lastRemoteUpdate = state.meta.lastUpdatedAt;
      const time = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      showSyncStatus('synced', `Сохранено · ${time}`);
    } catch (e) {
      console.error('[Sync] Ошибка записи:', e);
      showSyncStatus('error', 'Ошибка сохранения');
      ignoreNextRemote = false;
    }

    isSyncing = false;
  }

  function debouncedPush() {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      pushToRemote();
    }, DEBOUNCE_MS);
  }

  // ===== REALTIME ПОДПИСКА =====
  function subscribeRealtime() {
    if (!supabase) return;

    channel = supabase
      .channel('checklist-sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: TABLE,
          filter: `id=eq.${ROW_ID}`
        },
        (payload) => {
          // Пропускаем своё же обновление
          if (ignoreNextRemote) {
            ignoreNextRemote = false;
            return;
          }

          const data = payload.new;
          if (!data) return;

          // Проверяем, что это более новое обновление
          const remoteTs = data.meta?.lastUpdatedAt || 0;
          if (remoteTs <= lastRemoteUpdate) return;

          lastRemoteUpdate = remoteTs;
          applyState(data);

          const who = data.meta?.lastUpdatedBy || 'Кто-то';
          const when = new Date(remoteTs).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          showSyncStatus('synced', `${who} обновил · ${when}`);

          // Также сохраняем в localStorage для оффлайна
          if (typeof clSaveState === 'function') {
            try { clSaveState(); } catch (e) {}
          }

          console.log(`[Sync] Получено обновление от ${who}`);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Sync] Realtime подписка активна');
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          console.warn('[Sync] Realtime отключён, переподключение…');
          showSyncStatus('offline', 'Переподключение…');
          setTimeout(subscribeRealtime, 5000);
        }
      });
  }

  // ===== ПЕРЕХВАТ clSaveState =====
  function hookIntoSaveState() {
    // Ждём пока clInitPage создаст функцию clSaveState
    const checkInterval = setInterval(() => {
      if (typeof window.clSaveState === 'function' && !window._clSaveStateHooked) {
        const originalSave = window.clSaveState;
        window.clSaveState = function () {
          // Вызываем оригинальную функцию (localStorage)
          originalSave.apply(this, arguments);
          // Отправляем в Supabase (с дебаунсом)
          debouncedPush();
        };
        window._clSaveStateHooked = true;
        clearInterval(checkInterval);
        console.log('[Sync] Перехват clSaveState установлен');
      }
    }, 500);

    // Также перехватываем changeCount (для кнопок +/-)
    const checkCount = setInterval(() => {
      if (typeof window.changeCount === 'function' && !window._changeCountHooked) {
        const originalChange = window.changeCount;
        window.changeCount = function () {
          originalChange.apply(this, arguments);
          debouncedPush();
        };
        window._changeCountHooked = true;
        clearInterval(checkCount);
        console.log('[Sync] Перехват changeCount установлен');
      }
    }, 500);

    // Таймаут безопасности
    setTimeout(() => {
      clearInterval(checkInterval);
      clearInterval(checkCount);
    }, 15000);
  }

  // ===== ЗАПУСК =====
  // Ждём загрузки страницы и инициализации чеклиста
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 1000);
  }

})();
