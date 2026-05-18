"""Auth API — авторизация, создание студентов, управление профилем"""
import json
import os
import hashlib
import secrets
import string
import psycopg2

SCHEMA = "t_p36815849_drone_scoreboard"

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Token",
}

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=5)

def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()

def gen_password(length=8) -> str:
    chars = string.ascii_letters + string.digits
    return "".join(secrets.choice(chars) for _ in range(length))

def gen_token() -> str:
    return secrets.token_hex(32)

def get_session(cur, token: str):
    if not token:
        return None
    cur.execute(f"SELECT user_id, role, player_id FROM {SCHEMA}.auth_sessions WHERE token = '{token}' AND expires_at > NOW()")
    return cur.fetchone()

def require_teacher(cur, token: str):
    sess = get_session(cur, token)
    return sess if (sess and sess[1] == "teacher") else None

def ok(body):
    return {"statusCode": 200, "headers": CORS, "body": json.dumps(body, ensure_ascii=False)}

def err(status, msg):
    return {"statusCode": status, "headers": CORS, "body": json.dumps({"error": msg}, ensure_ascii=False)}

def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "POST")
    qs = event.get("queryStringParameters") or {}
    action = qs.get("action", "")
    headers = event.get("headers") or {}
    token = headers.get("x-token", "") or headers.get("X-Token", "")

    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        # POST ?action=login
        if method == "POST" and action == "login":
            body = json.loads(event.get("body") or "{}")
            login = body.get("login", "").strip()
            password = body.get("password", "")
            cur.execute(f"""
                SELECT id, role, player_id FROM {SCHEMA}.users
                WHERE login = '{login}' AND password_hash = '{sha256(password)}'
                  AND role != 'deleted'
            """)
            user = cur.fetchone()
            if not user:
                return err(401, "Неверный логин или пароль")
            user_id, role, player_id = user
            token_new = gen_token()
            cur.execute(f"""
                INSERT INTO {SCHEMA}.auth_sessions (token, user_id, role, player_id)
                VALUES ('{token_new}', {user_id}, '{role}', {f"'{player_id}'" if player_id else "NULL"})
            """)
            conn.commit()
            return ok({"token": token_new, "role": role, "player_id": player_id, "login": login})

        # GET ?action=me
        if method == "GET" and action == "me":
            sess = get_session(cur, token)
            if not sess:
                return err(401, "Не авторизован")
            return ok({"user_id": sess[0], "role": sess[1], "player_id": sess[2]})

        # POST ?action=logout
        if method == "POST" and action == "logout":
            if token:
                cur.execute(f"UPDATE {SCHEMA}.auth_sessions SET expires_at = NOW() WHERE token = '{token}'")
                conn.commit()
            return ok({"ok": True})

        # POST ?action=create_student
        if method == "POST" and action == "create_student":
            if not require_teacher(cur, token):
                return err(403, "Только преподаватель")
            body = json.loads(event.get("body") or "{}")
            nickname = body.get("nickname", "").strip()
            if not nickname:
                return err(400, "Укажи имя студента")

            # Генерация уникального логина одним запросом
            cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.users WHERE role = 'student'")
            count = cur.fetchone()[0] + 1
            login = f"student{count:02d}"
            cur.execute(f"SELECT 1 FROM {SCHEMA}.users WHERE login = '{login}'")
            if cur.fetchone():
                login = f"s{secrets.token_hex(3)}"

            password = gen_password(8)
            player_id = f"player_{secrets.token_hex(4)}"
            avatar_id = body.get("avatar_id", "boy_1")
            safe_nick = nickname.replace("'", "''")

            # Два INSERT одной транзакцией
            cur.execute(f"""
                INSERT INTO {SCHEMA}.players (player_id, nickname, avatar_id, xp)
                VALUES ('{player_id}', '{safe_nick}', '{avatar_id}', 0)
            """)
            cur.execute(f"""
                INSERT INTO {SCHEMA}.users (login, password_hash, role, player_id)
                VALUES ('{login}', '{sha256(password)}', 'student', '{player_id}')
            """)
            conn.commit()
            return ok({"login": login, "password": password, "player_id": player_id, "nickname": nickname})

        # GET ?action=students
        if method == "GET" and action == "students":
            if not require_teacher(cur, token):
                return err(403, "Только преподаватель")
            cur.execute(f"""
                SELECT u.login, u.player_id, p.nickname, p.avatar_id, p.xp, u.created_at
                FROM {SCHEMA}.users u
                LEFT JOIN {SCHEMA}.players p ON u.player_id = p.player_id
                WHERE u.role = 'student' AND u.password_hash != 'DELETED'
                ORDER BY p.xp DESC NULLS LAST
            """)
            students = [{"login": r[0], "player_id": r[1], "nickname": r[2],
                         "avatar_id": r[3], "xp": r[4],
                         "created_at": r[5].strftime("%d.%m.%Y") if r[5] else ""} for r in cur.fetchall()]
            return ok({"students": students})

        # PUT ?action=rename
        if method == "PUT" and action == "rename":
            sess = get_session(cur, token)
            if not sess:
                return err(401, "Не авторизован")
            body = json.loads(event.get("body") or "{}")
            new_nickname = body.get("nickname", "").strip()
            if not new_nickname or len(new_nickname) > 30:
                return err(400, "Имя 1–30 символов")
            player_id = sess[2]
            if not player_id:
                return err(400, "Нет привязанного профиля")
            cur.execute(f"UPDATE {SCHEMA}.players SET nickname = '{new_nickname.replace(chr(39), chr(39)*2)}' WHERE player_id = '{player_id}'")
            conn.commit()
            return ok({"ok": True, "nickname": new_nickname})

        # PUT ?action=avatar
        if method == "PUT" and action == "avatar":
            sess = get_session(cur, token)
            if not sess:
                return err(401, "Не авторизован")
            body = json.loads(event.get("body") or "{}")
            avatar_id = body.get("avatar_id", "")
            player_id = sess[2]
            if not player_id or not avatar_id:
                return err(400, "Ошибка данных")
            cur.execute(f"UPDATE {SCHEMA}.players SET avatar_id = '{avatar_id}' WHERE player_id = '{player_id}'")
            conn.commit()
            return ok({"ok": True})

        # POST ?action=reset_password
        if method == "POST" and action == "reset_password":
            if not require_teacher(cur, token):
                return err(403, "Только преподаватель")
            body = json.loads(event.get("body") or "{}")
            login_target = body.get("login", "")
            new_password = gen_password(8)
            cur.execute(f"""
                UPDATE {SCHEMA}.users SET password_hash = '{sha256(new_password)}'
                WHERE login = '{login_target}' AND role = 'student'
            """)
            conn.commit()
            return ok({"new_password": new_password})

        # POST ?action=delete_student
        if method == "POST" and action == "delete_student":
            if not require_teacher(cur, token):
                return err(403, "Только преподаватель")
            body = json.loads(event.get("body") or "{}")
            login_target = body.get("login", "").strip()
            if not login_target:
                return err(400, "Укажи логин студента")
            cur.execute(f"SELECT player_id FROM {SCHEMA}.users WHERE login = '{login_target}' AND role = 'student'")
            row = cur.fetchone()
            if not row:
                return err(404, "Студент не найден")
            player_id = row[0]
            if player_id:
                cur.execute(f"UPDATE {SCHEMA}.auth_sessions SET expires_at = NOW() WHERE player_id = '{player_id}'")
                cur.execute(f"UPDATE {SCHEMA}.achievements_unlocked SET player_id = NULL WHERE player_id = '{player_id}'")
                cur.execute(f"UPDATE {SCHEMA}.penalties SET player_id = NULL WHERE player_id = '{player_id}'")
                cur.execute(f"UPDATE {SCHEMA}.sessions SET player_id = NULL WHERE player_id = '{player_id}'")
            cur.execute(f"UPDATE {SCHEMA}.users SET player_id = NULL WHERE login = '{login_target}'")
            cur.execute(f"""
                UPDATE {SCHEMA}.users
                SET login = 'deleted_' || id || '_' || login,
                    password_hash = 'DELETED',
                    role = 'deleted'
                WHERE login = '{login_target}'
            """)
            conn.commit()
            return ok({"ok": True})

        return err(404, "not found")

    except Exception as e:
        if conn:
            conn.rollback()
        return err(500, str(e))
    finally:
        if conn:
            conn.close()
