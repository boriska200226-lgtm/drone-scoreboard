# Сервер «Гильдии»

FastAPI + PostgreSQL + WebSocket. Отвечает за всю игровую механику класса:
СЗ, ветки, Броню, Древо, Фестиваль, Тихую почту и Реестр.

Живёт отдельно от serverless-функций «БАС Арены» (`backend/auth-api`,
`backend/bas-api`): рассылка событий в реальном времени требует долгоживущих
соединений, которых в облачных функциях нет.

## Быстрый старт (Docker)

Из корня репозитория:

```sh
cp .env.guild.example .env
# заполни REGISTRY_KEY, BOOTSTRAP_TOKEN и POSTGRES_PASSWORD
docker compose up -d --build
```

Поднимутся три контейнера: `guild-db` (PostgreSQL), `guild-api` (этот сервер)
и `guild-web` (nginx со собранным фронтендом). Сайт — на `http://localhost:8080`,
раздел «Гильдия» — `http://localhost:8080/guild`.

Миграции накатываются автоматически при старте `guild-api`.

## Первый класс

Создание класса намеренно вынесено за пределы интерфейса: это разовая
операция, и делать её должен тот, у кого есть доступ к серверу.

```sh
curl -X POST http://localhost:8080/api/teacher/class \
  -H "Content-Type: application/json" \
  -H "X-Bootstrap-Token: <BOOTSTRAP_TOKEN из .env>" \
  -d '{"school_code":"42","class_name":"7b","teacher_password":"<пароль учителя>",
       "nickname_style":"totem","class_target":100}'
```

Логин учителя получится по шаблону `t_<school_code>_<class_name>` — в примере
`t_42_7b`. Дальше:

1. Подключи второй фактор (при `REQUIRE_TEACHER_2FA=true` без него не войти):
   ```sh
   curl -X POST http://localhost:8080/api/auth/2fa/setup \
     -H "Content-Type: application/json" \
     -d '{"login":"t_42_7b","password":"<пароль>"}'
   # secret заводится в любое приложение-аутентификатор, затем:
   curl -X POST http://localhost:8080/api/auth/2fa/confirm \
     -H "Content-Type: application/json" \
     -d '{"login":"t_42_7b","password":"<пароль>","code":"123456"}'
   ```
2. Войди на `/guild`, открой вкладку **КАРТОЧКИ** и нажми «Создать 25».
3. Распечатай карточки (кличка, логин, пароль, QR) — пароли показываются
   **один раз**, дальше в базе только bcrypt-хэш.
4. Убери `BOOTSTRAP_TOKEN` из `.env` и перезапусти `guild-api`.

## Разработка без Docker

```sh
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt

export DATABASE_URL="postgresql://guild:guild@localhost:5432/guild"
export REGISTRY_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
export BOOTSTRAP_TOKEN="dev"
export REQUIRE_TEACHER_2FA=false

python -m app.migrate
uvicorn app.main:app --reload --port 8000
```

Фронтенд в dev-режиме (`bun run dev`) проксирует `/api` и `/ws` на
`http://127.0.0.1:8000` — переопределяется переменной `GUILD_SERVER_URL`.

## Переменные окружения

| Переменная | По умолчанию | Зачем |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://guild:guild@localhost:5432/guild` | подключение к PostgreSQL |
| `DB_SCHEMA` | `guild` | схема, в которой живут таблицы |
| `REGISTRY_KEY` | — | ключ Fernet для Реестра «кличка → имя». **Без него Реестр не работает** |
| `BOOTSTRAP_TOKEN` | — | разовый секрет для создания класса |
| `REQUIRE_TEACHER_2FA` | `true` | требовать TOTP при входе учителя |
| `SESSION_DAYS` | `30` | срок жизни токена сессии |
| `ARMOR_JOB_HOUR` | `22` | час ночного пересчёта Брони |
| `TZ_NAME` | `Europe/Moscow` | часовой пояс школы |
| `CORS_ORIGINS` | `*` | список источников через запятую |
| `BCRYPT_ROUNDS` | `12` | стоимость хэширования паролей |
| `RUN_SCHEDULER` | `true` | запускать ли ночную задачу в этом процессе |

## Протокол WebSocket

Подключение: `wss://<домен>/ws?token=<токен сессии>`. Токен берётся из ответа
`/api/auth/login`. Неверный токен закрывает сокет с кодом `4401`.

Сервер шлёт сообщения вида `{"event": "<имя>", "payload": {…}}`:

| Событие | Когда | Что внутри |
| --- | --- | --- |
| `state` | сразу после подключения и по запросу | полный снимок: класс, Древо, Алтарь, Фестиваль |
| `souls_updated` | начислены СЗ | герой, дельта, причина, новое состояние Древа |
| `armor_changed` | прошёл ночной пересчёт | список изменений Брони за день |
| `debuff_applied` | свисток или дебафф «мат» | `kind`, `sound`, `vibrate`, урон Древу |
| `festival_ready` | Древо достигло 70% | процент и порог |
| `pong` | ответ на `ping` | пусто |

Клиент шлёт только два сообщения: `{"event":"ping"}` (раз в 25 с, чтобы прокси
не рвал соединение) и `{"event":"state"}` (запросить свежий снимок). Ничего
изменяющего по сокету не принимается — все такие действия идут обычным REST
с проверкой роли.

Если сокет упал, клиент раз в 3 секунды пробует подключиться заново и
параллельно опрашивает `GET /api/guild/state` раз в 5 секунд.

## Масштабирование

Комнаты WebSocket и планировщик Брони живут **в памяти процесса**. Поэтому
воркер должен быть один (`WEB_CONCURRENCY=1`): при нескольких свисток дойдёт
только до части класса, а Броня пересчитается по разу на воркер. Для одного
класса этого с запасом достаточно — один процесс держит 25 сокетов без
нагрузки. Если понадобится несколько воркеров или несколько серверов, нужен
общий брокер: `Hub.broadcast` заменяется на публикацию в Redis pub/sub, а
`RUN_SCHEDULER=true` оставляется ровно одному процессу.

## Тесты

```sh
pytest                                  # 80 тестов механики и безопасности
GUILD_TEST_DATABASE_URL=postgresql://guild@localhost:5432/guild_test pytest
                                        # + 40 сквозных тестов API
```

Без `GUILD_TEST_DATABASE_URL` интеграционные тесты пропускаются. Тестовая
схема (`guild_test`) пересоздаётся перед каждым тестом, поэтому указывать
рабочую базу не стоит.
