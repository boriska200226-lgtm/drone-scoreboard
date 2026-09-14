# drone-scoreboard

Два раздела в одном приложении:

- **`/` — «БАС Арена».** Трекер занятий по беспилотным авиационным системам:
  сессии, опыт, достижения, рейтинг. Бэкенд — serverless-функции
  (`backend/auth-api`, `backend/bas-api`) и PostgreSQL.
- **`/guild` — «Гильдия».** Закрытая RPG-платформа класса: Алтарь без имён,
  Карта героя, Древо гильдии, Броня, Фестиваль. PWA с реальным временем на
  WebSocket. Свой сервер — [`backend/guild-server`](backend/guild-server).
  Описание целиком — в [GUILD.md](GUILD.md).

## Разработка

```sh
bun install
bun run dev          # фронтенд на :5173, /api и /ws проксируются на :8000
```

Для работы с «Гильдией» нужен её сервер — см.
[`backend/guild-server/README.md`](backend/guild-server/README.md). Адрес
сервера переопределяется переменной `GUILD_SERVER_URL`.

Развернуть «Гильдию» целиком (база + сервер + фронтенд):

```sh
cp .env.guild.example .env   # заполнить REGISTRY_KEY, BOOTSTRAP_TOKEN, пароль БД
docker compose up -d --build
```
