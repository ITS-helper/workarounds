/**
 * ================================================
 *  ПАТЧ: Нижняя навигация + Tap-to-assign
 * ================================================
 *
 *  Подключение: <script src="ux-patch.js"></script>
 *  Перед </body>, после основных скриптов портала.
 *
 *  1. Переносит навигацию вниз (fixed bottom bar)
 *  2. Добавляет tap-to-assign: тап на чип → bottom sheet с выбором зоны
 */

(function () {
  'use strict';

  // =============================================
  //  ЧАСТЬ 1: НИЖНЯЯ НАВИГАЦИЯ
  // =============================================

  function patchNavbar() {
    const topnav = document.querySelector('.topnav');
    if (!topnav) return;

    // --- CSS ---
    const css = document.createElement('style');
    css.id = 'ux-patch-css';
    css.textContent = `

      /* ==================================================
         DESKTOP (> 768px): верхние табы по центру, лого без текста ITS
         ================================================== */
      @media (min-width: 769px) {
        .topnav {
          display: grid !important;
          grid-template-columns: auto 1fr auto !important;
          align-items: center !important;
          padding: 0 24px !important;
          border-bottom: 2.5px solid var(--accent, #2196F3) !important;
          box-shadow: 0 2px 12px rgba(21,101,192,0.08) !important;
          min-height: 56px !important;
          flex-direction: unset !important;
        }

        .topnav-logo {
          grid-column: 1 !important;
          border-right: none !important;
          border-bottom: none !important;
          padding: 0 !important;
          gap: 10px !important;
          flex-shrink: 0 !important;
        }
        .topnav-logo img {
          height: 34px !important;
          max-width: 160px !important;
        }
        /* Прячем текст ITS */
        .topnav-logo-text {
          display: none !important;
        }

        .topnav-tabs {
          grid-column: 2 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 6px !important;
          padding: 8px 0 !important;
          margin: 0 !important;
        }

        .nav-tab {
          padding: 9px 24px !important;
          font-size: 0.92em !important;
          border-radius: 8px !important;
        }
        .nav-tab svg {
          display: inline-block !important;
          width: 15px !important;
          height: 15px !important;
        }
        .nav-tab.active {
          background: #EEF6FF !important;
          color: var(--primary, #1565C0) !important;
          border-color: rgba(33,150,243,0.35) !important;
          box-shadow: 0 1px 4px rgba(33,150,243,0.12) !important;
        }

        .bottom-nav { display: none !important; }
        body { padding-bottom: 0 !important; }
        .page .container { margin-bottom: 40px !important; }
      }

      /* ==================================================
         ЕДИНЫЙ СТИЛЬ БЛОКОВ — все вкладки как в Обходах
         ================================================== */

      /* Чек-лист: group-header — заголовок слева, шеврон справа */
      #page-checklist .group-header,
      #page-checklist .deployment-header,
      #page-checklist .table-group-header,
      #page-checklist .map-section-header {
        flex-direction: row !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 16px 20px 14px !important;
      }
      #page-checklist .group-title-row,
      #page-checklist .deployment-header-row {
        width: 100% !important;
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
      }
      #page-checklist .task-group h2,
      #page-checklist .deployment-header h2 {
        text-align: left !important;
        justify-content: flex-start !important;
      }

      /* Шпаргалка: group-header — заголовок слева, шеврон справа */
      #page-spravka .group-header {
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 16px 20px 14px !important;
      }
      #page-spravka .guide-group h2 {
        text-align: left !important;
        justify-content: flex-start !important;
      }
      /* Шеврон не должен переноситься на новую строку */
      #page-spravka .group-chevron,
      #page-checklist .group-chevron,
      #page-checklist .deployment-chevron {
        margin-left: auto !important;
        flex-shrink: 0 !important;
      }

      /* ==================================================
         MOBILE (≤ 768px): нижний навбар, верхние табы скрыты
         ================================================== */
      @media (max-width: 768px) {
        .topnav-tabs { display: none !important; }
        .topnav {
          border-bottom: 1px solid var(--border, #E8EDF2) !important;
          box-shadow: none !important;
          display: flex !important;
          grid-template-columns: unset !important;
        }
        .topnav-logo {
          border-right: none !important;
          border-bottom: none !important;
          justify-content: flex-start !important;
          padding: 8px 14px !important;
        }

        .bottom-nav {
          position: fixed;
          bottom: 0; left: 0; right: 0;
          z-index: 9999;
          background: #fff;
          border-top: 1px solid var(--border, #E8EDF2);
          box-shadow: 0 -2px 12px rgba(0,0,0,0.06);
          display: flex;
          align-items: stretch;
          justify-content: center;
          padding: 0;
          padding-bottom: env(safe-area-inset-bottom, 0px);
          transform: translateZ(0);
          -webkit-transform: translateZ(0);
        }

        .bottom-nav-item {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 8px 4px 6px;
          cursor: pointer;
          border: none;
          background: transparent;
          color: #90A4AE;
          transition: color 0.15s;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          position: relative;
          max-width: 120px;
        }
        .bottom-nav-item:hover { color: var(--primary, #1565C0); }
        .bottom-nav-item.active { color: var(--accent, #2196F3); }
        .bottom-nav-item.active::before {
          content: '';
          position: absolute;
          top: 0; left: 20%; right: 20%;
          height: 2.5px;
          background: var(--accent, #2196F3);
          border-radius: 0 0 2px 2px;
        }
        .bottom-nav-item svg { width: 20px; height: 20px; flex-shrink: 0; }
        .bottom-nav-label {
          font-family: 'Oswald', sans-serif;
          font-size: 0.6em;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          line-height: 1;
          white-space: nowrap;
        }

        body { padding-bottom: 0 !important; }
        .page .container { margin-bottom: 0 !important; padding-bottom: 80px !important; }
      }

      /* ==================================================
         СКРОЛЛИРУЕМЫЙ БЛОК РАССТАНОВКИ (все размеры)
         ================================================== */
      .deployment-block.open .deployment-body {
        max-height: 55vh !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch;
      }
      .deployment-inner {
        padding-bottom: 16px !important;
      }
      .deployment-footer {
        position: sticky !important;
        bottom: 0 !important;
        background: #fff !important;
        padding: 12px 16px 14px !important;
        margin: 0 -16px !important;
        border-top: 1px solid var(--border, #E8EDF2) !important;
        z-index: 5 !important;
        box-shadow: 0 -4px 12px rgba(0,0,0,0.04) !important;
      }

      /* Прячем навбар при fullscreen карте */
      body.map-fullscreen .bottom-nav { display: none !important; }
      body.map-fullscreen .topnav { display: none !important; }
      body.map-fullscreen .page .container { margin-bottom: 0 !important; }

      /* === BOTTOM SHEET ДЛЯ TAP-TO-ASSIGN === */
      .zone-sheet-overlay {
        position: fixed; inset: 0;
        z-index: 10000;
        background: rgba(15, 23, 42, 0.4);
        backdrop-filter: blur(2px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
      }
      .zone-sheet-overlay.open {
        opacity: 1;
        pointer-events: all;
      }

      .zone-sheet {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        z-index: 10001;
        background: #fff;
        border-radius: 16px 16px 0 0;
        box-shadow: 0 -8px 40px rgba(0,0,0,0.15);
        padding: 0;
        padding-bottom: env(safe-area-inset-bottom, 0px);
        transform: translateY(100%);
        transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
        max-height: 70vh;
        overflow-y: auto;
      }
      .zone-sheet-overlay.open .zone-sheet {
        transform: translateY(0);
      }

      .zone-sheet-handle {
        display: flex;
        justify-content: center;
        padding: 10px 0 4px;
      }
      .zone-sheet-handle::after {
        content: '';
        width: 36px; height: 4px;
        border-radius: 2px;
        background: #D1D5DB;
      }

      .zone-sheet-title {
        padding: 4px 20px 12px;
        font-family: 'Oswald', sans-serif;
        font-size: 0.88em;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--primary, #1565C0);
        text-align: center;
      }
      .zone-sheet-person {
        color: var(--accent, #2196F3);
      }

      .zone-sheet-options {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 0 12px 12px;
      }

      .zone-sheet-btn {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border: none;
        background: transparent;
        cursor: pointer;
        transition: background 0.12s;
        border-radius: 10px;
        -webkit-tap-highlight-color: transparent;
      }
      .zone-sheet-btn:hover { background: #F1F5F9; }
      .zone-sheet-btn:active { background: #E2E8F0; }

      .zone-sheet-btn.current {
        background: #E3F2FD;
      }
      .zone-sheet-btn.current .zsb-label {
        color: var(--accent, #2196F3);
      }

      .zsb-dot {
        width: 32px; height: 32px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        color: #fff;
        font-family: 'Oswald', sans-serif;
        font-size: 0.7em;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .zsb-dot-spg1 { background: linear-gradient(135deg, #1565C0, #2196F3); }
      .zsb-dot-spg2 { background: linear-gradient(135deg, #00897B, #009688); }
      .zsb-dot-spg3 { background: linear-gradient(135deg, #E53935, #EF5350); }
      .zsb-dot-spg4 { background: linear-gradient(135deg, #5E35B1, #7E57C2); }
      .zsb-dot-dayoff { background: linear-gradient(135deg, #546E7A, #78909C); }
      .zsb-dot-pool { background: linear-gradient(135deg, #90A4AE, #B0BEC5); }

      .zsb-info { display: flex; flex-direction: column; gap: 1px; text-align: left; }
      .zsb-label {
        font-family: 'Oswald', sans-serif;
        font-size: 0.9em;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #37474F;
      }
      .zsb-count {
        font-size: 12px;
        color: #90A4AE;
        font-family: 'Source Sans 3', sans-serif;
      }

      .zone-sheet-cancel {
        display: block;
        width: calc(100% - 24px);
        margin: 4px 12px 12px;
        padding: 12px;
        border: 1px solid var(--border, #E8EDF2);
        border-radius: 10px;
        background: #F9FAFB;
        color: #78909C;
        font-family: 'Oswald', sans-serif;
        font-size: 0.85em;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        transition: all 0.15s;
        text-align: center;
        -webkit-tap-highlight-color: transparent;
      }
      .zone-sheet-cancel:hover { background: #F1F5F9; color: #546E7A; }
    `;
    document.head.appendChild(css);

    // --- Создаём нижний навбар ---
    const navbar = document.createElement('nav');
    navbar.className = 'bottom-nav';
    navbar.id = 'bottomNav';
    navbar.innerHTML = `
      <button class="bottom-nav-item" data-nav="checklist">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
        <span class="bottom-nav-label">Чек-лист</span>
      </button>
      <button class="bottom-nav-item" data-nav="obhody">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <span class="bottom-nav-label">Обходы</span>
      </button>
      <button class="bottom-nav-item" data-nav="spravka">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
        <span class="bottom-nav-label">Шпаргалка</span>
      </button>
    `;
    document.body.appendChild(navbar);

    // Обработчики
    navbar.querySelectorAll('.bottom-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.nav;
        if (typeof showPage === 'function') showPage(page);
        syncActiveNav(page);
      });
    });

    // Синхронизируем с существующим showPage
    const origShowPage = window.showPage;
    window.showPage = function (pageId) {
      origShowPage.apply(this, arguments);
      syncActiveNav(pageId);
    };

    function syncActiveNav(pageId) {
      // Синхронизируем нижний навбар
      navbar.querySelectorAll('.bottom-nav-item').forEach(b => {
        b.classList.toggle('active', b.dataset.nav === pageId);
      });
      // Синхронизируем верхние табы (для десктопа)
      document.querySelectorAll('.topnav .nav-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.page === pageId);
      });
    }

    // Определяем текущую активную страницу
    const activePage = document.querySelector('.page.active');
    if (activePage) {
      const id = activePage.id.replace('page-', '');
      syncActiveNav(id);
    }
  }

  // =============================================
  //  ЧАСТЬ 2: TAP-TO-ASSIGN (BOTTOM SHEET)
  // =============================================

  const ZONES = [
    { key: 'spg1', label: 'СПГ 1', dot: 'zsb-dot-spg1', abbr: 'СПГ1' },
    { key: 'spg2', label: 'СПГ 2', dot: 'zsb-dot-spg2', abbr: 'СПГ2' },
    { key: 'spg3', label: 'СПГ 3', dot: 'zsb-dot-spg3', abbr: 'СПГ3' },
    { key: 'spg4', label: 'Усиление утро', dot: 'zsb-dot-spg4', abbr: 'УС' },
    { key: 'dayoff', label: 'Выходной', dot: 'zsb-dot-dayoff', abbr: 'ВЫХ' },
    { key: 'pool', label: 'Нераспределённые', dot: 'zsb-dot-pool', abbr: '—' },
  ];

  let sheetOverlay = null;
  let sheetPerson = null;
  let sheetSourceZone = null;

  function createSheet() {
    sheetOverlay = document.createElement('div');
    sheetOverlay.className = 'zone-sheet-overlay';
    sheetOverlay.id = 'zoneSheetOverlay';
    sheetOverlay.innerHTML = `
      <div class="zone-sheet" id="zoneSheet">
        <div class="zone-sheet-handle"></div>
        <div class="zone-sheet-title">
          Переместить <span class="zone-sheet-person" id="zoneSheetPerson"></span>
        </div>
        <div class="zone-sheet-options" id="zoneSheetOptions"></div>
        <button class="zone-sheet-cancel" id="zoneSheetCancel">Отмена</button>
      </div>
    `;
    document.body.appendChild(sheetOverlay);

    // Закрытие
    sheetOverlay.addEventListener('click', (e) => {
      if (e.target === sheetOverlay) closeSheet();
    });
    document.getElementById('zoneSheetCancel').addEventListener('click', closeSheet);

    // Swipe down to close
    let touchStartY = 0;
    const sheet = document.getElementById('zoneSheet');
    sheet.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      const dy = e.touches[0].clientY - touchStartY;
      if (dy > 60) closeSheet();
    }, { passive: true });
  }

  function openSheet(personName, fromZone) {
    sheetPerson = personName;
    sheetSourceZone = fromZone;

    document.getElementById('zoneSheetPerson').textContent = personName;

    const optionsEl = document.getElementById('zoneSheetOptions');
    optionsEl.innerHTML = '';

    ZONES.forEach(zone => {
      const container = zone.key === 'pool'
        ? document.getElementById('pool')
        : document.getElementById('zone-' + zone.key);
      const count = container
        ? container.querySelectorAll('.person-chip').length
        : 0;
      const isCurrent = zone.key === fromZone;

      const btn = document.createElement('button');
      btn.className = 'zone-sheet-btn' + (isCurrent ? ' current' : '');
      btn.innerHTML = `
        <div class="zsb-dot ${zone.dot}">${zone.abbr}</div>
        <div class="zsb-info">
          <span class="zsb-label">${zone.label}${isCurrent ? ' ← сейчас' : ''}</span>
          <span class="zsb-count">${count} чел.</span>
        </div>
      `;

      btn.addEventListener('click', () => {
        if (!isCurrent && typeof movePerson === 'function') {
          movePerson(sheetPerson, sheetSourceZone, zone.key);
        }
        closeSheet();
      });

      optionsEl.appendChild(btn);
    });

    sheetOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    if (!sheetOverlay) return;
    sheetOverlay.classList.remove('open');
    document.body.style.overflow = '';
    sheetPerson = null;
    sheetSourceZone = null;
  }

  // Перехватываем создание чипов
  function patchTapToAssign() {
    createSheet();

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSheet();
    });

    const isMobile = () => window.innerWidth <= 768;

    // Добавляет tap-обработчик к чипу, НЕ убивая drag
    function addTapToChip(chip) {
      if (chip._tapPatched) return;
      chip._tapPatched = true;

      let tapStartTime = 0;
      let tapStartX = 0;
      let tapStartY = 0;
      let wasDragged = false;

      // На мобилке: перехватываем touch чтобы отключить drag
      chip.addEventListener('touchstart', (e) => {
        if (!isMobile()) return;
        tapStartTime = Date.now();
        tapStartX = e.touches[0].clientX;
        tapStartY = e.touches[0].clientY;
        wasDragged = false;
        // Блокируем drag на мобилке
        e.stopPropagation();
      }, { capture: true });

      chip.addEventListener('touchmove', (e) => {
        if (!isMobile()) return;
        const dx = Math.abs(e.touches[0].clientX - tapStartX);
        const dy = Math.abs(e.touches[0].clientY - tapStartY);
        if (dx > 10 || dy > 10) wasDragged = true;
      }, { passive: true });

      chip.addEventListener('touchend', (e) => {
        if (!isMobile()) return;
        e.stopPropagation();
        if (wasDragged) return;
        const dt = Date.now() - tapStartTime;
        if (dt < 400) {
          e.preventDefault();
          const name = chip.dataset.person;
          const zone = chip.dataset.zone;
          if (name) openSheet(name, zone);
        }
      }, { capture: true });

      // На десктопе: dblclick открывает sheet (одиночный click = drag)
      chip.addEventListener('dblclick', (e) => {
        if (isMobile()) return;
        e.preventDefault();
        e.stopPropagation();
        const name = chip.dataset.person;
        const zone = chip.dataset.zone;
        if (name) openSheet(name, zone);
      });
    }

    function patchAllChips() {
      document.querySelectorAll('.person-chip').forEach(addTapToChip);
    }

    // Перехватываем createChip — новые чипы сразу с обработчиком
    const origCreateChip = window.createChip;
    if (typeof origCreateChip === 'function') {
      window.createChip = function (name, zone) {
        const chip = origCreateChip.apply(this, arguments);
        addTapToChip(chip);
        return chip;
      };
    }

    patchAllChips();

    // Наблюдаем за новыми чипами
    const observer = new MutationObserver(() => {
      setTimeout(patchAllChips, 50);
    });

    const poolEl = document.getElementById('pool');
    if (poolEl) observer.observe(poolEl, { childList: true, subtree: true });

    ['spg1', 'spg2', 'spg3', 'spg4', 'dayoff'].forEach(z => {
      const el = document.getElementById('zone-' + z);
      if (el) observer.observe(el, { childList: true, subtree: true });
    });

    setTimeout(patchAllChips, 3000);
    setTimeout(patchAllChips, 6000);
  }

  // =============================================
  //  ЧАСТЬ 3: ПЕРЕСТАНОВКА И НОВЫЕ БЛОКИ В ШПАРГАЛКЕ
  // =============================================

  function patchSpravka() {
    const container = document.querySelector('#page-spravka .container');
    if (!container) return;

    // Находим существующие блоки по data-group
    const blocks = {};
    container.querySelectorAll('.guide-group').forEach(g => {
      blocks[g.dataset.group] = g;
    });

    // Сохраняем поиск (первый элемент)
    const searchBar = container.querySelector('.search-bar');
    const searchNoResults = container.querySelector('.search-no-results');

    // --- Создаём новые блоки ---

    // Блок «Фронт (табель и Telegram-бот)»
    const frontBlock = document.createElement('div');
    frontBlock.className = 'guide-group';
    frontBlock.dataset.group = 'front-guide';
    frontBlock.innerHTML = `
      <div class="group-header" onclick="toggleGroup(this)">
        <h2>
          <span class="icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2196F3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-top:-2px">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </span>
          Фронт (табель и Telegram-бот)
        </h2>
        <span class="group-chevron">▼</span>
      </div>
      <div class="guide-body">
        <div class="guide-inner">

          <div class="guide-section">
            <div class="subsection-wrap" onclick="this.classList.toggle('open')">
              <div class="subsection-toggle">
                <span class="subsection-toggle-title"><span class="dot"></span>Табель: основные принципы</span>
                <span class="subsection-chevron">▼</span>
              </div>
              <div class="subsection-body">
                <div style="padding-top: 10px;">
                  <div class="steps">
                    <div class="step">
                      <div class="step-num">1</div>
                      <div class="step-content"><div class="step-text">Табель ведётся ежедневно. Все изменения (выход, больничный, отпуск, выходной) фиксируются в день события.</div></div>
                    </div>
                    <div class="step">
                      <div class="step-num">2</div>
                      <div class="step-content"><div class="step-text">При обращении сотрудника по табелю — уточнить ФИО, дату и суть проблемы. Проверить данные в системе.</div></div>
                    </div>
                    <div class="step">
                      <div class="step-num">3</div>
                      <div class="step-content"><div class="step-text">Если ошибка подтверждена — внести корректировку и уведомить сотрудника о решении.</div></div>
                    </div>
                  </div>
                  <div class="note note-warn"><span class="note-icon">⚠️</span><span>Корректировки табеля за прошлые периоды (более 3 дней) — только через старшего инженера.</span></div>
                </div>
              </div>
            </div>
          </div>

          <div class="guide-section" style="margin-bottom:0;">
            <div class="subsection-wrap" onclick="this.classList.toggle('open')">
              <div class="subsection-toggle">
                <span class="subsection-toggle-title"><span class="dot"></span>Telegram-бот: регистрация и работа</span>
                <span class="subsection-chevron">▼</span>
              </div>
              <div class="subsection-body">
                <div style="padding-top: 10px;">
                  <div class="steps">
                    <div class="step">
                      <div class="step-num">1</div>
                      <div class="step-content"><div class="step-text">Новый сотрудник должен найти бота в Telegram и нажать <kbd>/start</kbd>.</div></div>
                    </div>
                    <div class="step">
                      <div class="step-num">2</div>
                      <div class="step-content"><div class="step-text">Бот запросит <strong>ФИО</strong> и <strong>табельный номер</strong>. Данные должны совпадать с данными в системе.</div></div>
                    </div>
                    <div class="step">
                      <div class="step-num">3</div>
                      <div class="step-content"><div class="step-text">После успешной регистрации сотрудник получает доступ к функциям бота: просмотр смен, подача заявлений, уведомления.</div></div>
                    </div>
                  </div>
                  <div class="note note-info"><span class="note-icon">ℹ️</span><span>Если бот не находит сотрудника — проверить корректность ФИО и табельного номера в базе. При необходимости добавить вручную.</span></div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;

    // Блок «Журнал BLE»
    const bleJournalBlock = document.createElement('div');
    bleJournalBlock.className = 'guide-group';
    bleJournalBlock.dataset.group = 'ble-journal';
    bleJournalBlock.innerHTML = `
      <div class="group-header" onclick="toggleGroup(this)">
        <h2>
          <span class="icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2196F3" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-top:-2px">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </span>
          Журнал BLE
        </h2>
        <span class="group-chevron">▼</span>
      </div>
      <div class="guide-body">
        <div class="guide-inner">

          <div class="guide-section">
            <div class="subsection-wrap" onclick="this.classList.toggle('open')">
              <div class="subsection-toggle">
                <span class="subsection-toggle-title"><span class="dot"></span>Структура журнала</span>
                <span class="subsection-chevron">▼</span>
              </div>
              <div class="subsection-body">
                <div style="padding-top: 10px;">
                  <div class="steps">
                    <div class="step">
                      <div class="step-num">1</div>
                      <div class="step-content"><div class="step-text">Журнал BLE — основная таблица учёта всех BLE-меток. Расположен в Google Sheets: <a class="guide-link" href="https://docs.google.com/spreadsheets/d/1CU56AZdWC9dCvkf_z6CWMtrgfuWRCG3HYx7hp79vI_c/edit?gid=1105933443#gid=1105933443" target="_blank" rel="noopener" onclick="event.stopPropagation()">открыть журнал</a>.</div></div>
                    </div>
                    <div class="step">
                      <div class="step-num">2</div>
                      <div class="step-content"><div class="step-text">В журнале ведётся учёт: <strong>номера меток</strong>, <strong>MAC-адреса</strong>, <strong>статуса</strong> (установлена / на складе / утеряна), <strong>маршрута</strong> и <strong>зоны установки</strong>.</div></div>
                    </div>
                    <div class="step">
                      <div class="step-num">3</div>
                      <div class="step-content"><div class="step-text">При установке, замене или потере метки — <strong>обязательно</strong> обновить журнал в тот же день.</div></div>
                    </div>
                  </div>
                  <div class="note note-danger"><span class="note-icon">⛔</span><span>Журнал BLE — единственный источник правды по номерам меток. Не допускать рассинхронизации с BackEnd и web-картой.</span></div>
                </div>
              </div>
            </div>
          </div>

          <div class="guide-section" style="margin-bottom:0;">
            <div class="subsection-wrap" onclick="this.classList.toggle('open')">
              <div class="subsection-toggle">
                <span class="subsection-toggle-title"><span class="dot"></span>Свободные номера меток</span>
                <span class="subsection-chevron">▼</span>
              </div>
              <div class="subsection-body">
                <div style="padding-top: 10px;">
                  <div class="steps">
                    <div class="step">
                      <div class="step-num">1</div>
                      <div class="step-content"><div class="step-text">Перед регистрацией новой метки — найти свободный номер в журнале BLE на листе свободных номеров.</div></div>
                    </div>
                    <div class="step">
                      <div class="step-num">2</div>
                      <div class="step-content"><div class="step-text">После присвоения номера — сразу отметить его как «занят» в журнале, указав MAC-адрес метки.</div></div>
                    </div>
                  </div>
                  <div class="note note-warn"><span class="note-icon">⚠️</span><span>Не использовать номера, которые уже помечены как занятые — даже если метка с этим номером утеряна. Для утерянных меток используются новые свободные номера.</span></div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    `;

    // --- Собираем новый порядок ---
    const newOrder = [
      blocks['glossary'],       // 1. Глоссарий
      blocks['workwatch'],      // 2. Часы
      blocks['ble'],            // 3. BLE-метки
      blocks['users'],          // 4. Регистрация новых
      frontBlock,               // 5. Фронт (новый)
      bleJournalBlock,          // 6. Журнал BLE (новый)
      blocks['vacation'],       // 7. Заявление на отпуск
      blocks['ozon-cdek'],      // 8. Заявки OZON/CDEK
    ].filter(Boolean);

    // Удаляем все guide-group из контейнера
    container.querySelectorAll('.guide-group').forEach(g => g.remove());

    // Вставляем в новом порядке (после search)
    const insertAfter = searchNoResults || searchBar;
    let lastInserted = insertAfter;

    newOrder.forEach(block => {
      if (lastInserted && lastInserted.nextSibling) {
        container.insertBefore(block, lastInserted.nextSibling);
      } else {
        container.appendChild(block);
      }
      lastInserted = block;
    });

    console.log('[UX Patch] Шпаргалка: блоки переставлены, новые добавлены');
  }

  // =============================================
  //  ЗАПУСК
  // =============================================

  function initPatches() {
    patchNavbar();
    setTimeout(patchTapToAssign, 2000);
    setTimeout(patchSpravka, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initPatches, 300));
  } else {
    setTimeout(initPatches, 300);
  }

})();
