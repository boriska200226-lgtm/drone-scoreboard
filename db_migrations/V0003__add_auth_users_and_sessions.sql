
-- Таблица пользователей с ролями
CREATE TABLE t_p36815849_drone_scoreboard.users (
  id SERIAL PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('teacher', 'student')),
  player_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Таблица токенов авторизации
CREATE TABLE t_p36815849_drone_scoreboard.auth_sessions (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  player_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Преподаватель (логин: teacher, пароль: teacher2024)
INSERT INTO t_p36815849_drone_scoreboard.users (login, password_hash, role, player_id)
VALUES ('teacher', encode(sha256('teacher2024'::bytea), 'hex'), 'teacher', NULL);

-- Студенты (привязаны к существующим players)
INSERT INTO t_p36815849_drone_scoreboard.users (login, password_hash, role, player_id) VALUES
('student01', encode(sha256('pass_s01'::bytea), 'hex'), 'student', 'ИГРОК_001'),
('student02', encode(sha256('pass_s02'::bytea), 'hex'), 'student', 'student_02'),
('student03', encode(sha256('pass_s03'::bytea), 'hex'), 'student', 'student_03'),
('student04', encode(sha256('pass_s04'::bytea), 'hex'), 'student', 'student_04'),
('student05', encode(sha256('pass_s05'::bytea), 'hex'), 'student', 'student_05'),
('student06', encode(sha256('pass_s06'::bytea), 'hex'), 'student', 'student_06'),
('student07', encode(sha256('pass_s07'::bytea), 'hex'), 'student', 'student_07'),
('student08', encode(sha256('pass_s08'::bytea), 'hex'), 'student', 'student_08'),
('student09', encode(sha256('pass_s09'::bytea), 'hex'), 'student', 'student_09'),
('student10', encode(sha256('pass_s10'::bytea), 'hex'), 'student', 'student_10'),
('student11', encode(sha256('pass_s11'::bytea), 'hex'), 'student', 'student_11'),
('student12', encode(sha256('pass_s12'::bytea), 'hex'), 'student', 'student_12'),
('student13', encode(sha256('pass_s13'::bytea), 'hex'), 'student', 'student_13'),
('student14', encode(sha256('pass_s14'::bytea), 'hex'), 'student', 'student_14'),
('student15', encode(sha256('pass_s15'::bytea), 'hex'), 'student', 'student_15');
