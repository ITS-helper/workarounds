-- ================================================================
--  ITSSupport Portal — SQL для Supabase
--  Выполнить в: Supabase Dashboard → SQL Editor
-- ================================================================

-- ----------------------------------------------------------------
-- 1. ЗАДАЧНИК (tasks_state)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks_state (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT now(),
  updated_by  TEXT
);

-- Начальная строка
INSERT INTO tasks_state (id, data)
VALUES ('shared', '{"user":"","tasks":[]}')
ON CONFLICT (id) DO NOTHING;

-- RLS — разрешаем анонимным читать и писать
ALTER TABLE tasks_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_public_rw" ON tasks_state
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Realtime — включаем
ALTER PUBLICATION supabase_realtime ADD TABLE tasks_state;


-- ----------------------------------------------------------------
-- 2. ПОЛЬЗОВАТЕЛИ (portal_users) — опционально
--    Если таблица не создана, используются встроенные пользователи.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_users (
  login        TEXT PRIMARY KEY,
  password     TEXT NOT NULL,
  display_name TEXT,
  role         TEXT DEFAULT 'user'
);

-- Начальные пользователи (пароли те же что в коде)
INSERT INTO portal_users (login, password, display_name, role) VALUES
  ('admin',  'kejexu8hem',  'Администратор',       'admin'),
  ('ilgar',  'VELES_2024',  'Ильгар Гаджиев',      'user'),
  ('ivan',   'VELES_2024',  'Иван Шуйский',         'user'),
  ('rustam', 'VELES_2024',  'Рустам Газизуллин',    'user'),
  ('guest',  'VELES_2024',  'Гость',               'guest')
ON CONFLICT (login) DO NOTHING;

-- RLS — анонимные только читают
ALTER TABLE portal_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_public_r" ON portal_users
  FOR SELECT TO anon USING (true);


-- ----------------------------------------------------------------
-- 3. ЧЕКЛИСТ (checklist_state) — уже должна существовать
--    Если ещё нет — создать:
-- ----------------------------------------------------------------
-- CREATE TABLE IF NOT EXISTS checklist_state (
--   id          TEXT PRIMARY KEY,
--   tasks       JSONB,
--   counts      JSONB,
--   tag_events  JSONB,
--   deployment  JSONB,
--   meta        JSONB,
--   updated_at  TIMESTAMPTZ DEFAULT now()
-- );
-- INSERT INTO checklist_state (id) VALUES ('shared') ON CONFLICT DO NOTHING;
-- ALTER TABLE checklist_state ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "cl_public_rw" ON checklist_state FOR ALL TO anon USING (true) WITH CHECK (true);
-- ALTER PUBLICATION supabase_realtime ADD TABLE checklist_state;
