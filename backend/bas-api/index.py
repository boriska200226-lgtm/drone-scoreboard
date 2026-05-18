"""API для БАС Арена — сессии, XP, штрафы, лидерборд, достижения (с ролевой защитой)"""
import json
import os
import psycopg2

SCHEMA = "t_p36815849_drone_scoreboard"

ACHIEVEMENTS_CONFIG = [
    {"id": "first_blood",   "xp": 50,  "check": lambda s, st: st["total_sessions"] >= 1},
    {"id": "sharp_shooter", "xp": 150, "check": lambda s, st: s.get("accuracy", 0) >= 90},
    {"id": "speed_demon",   "xp": 200, "check": lambda s, st: s.get("score", 0) >= 500},
    {"id": "consistency",   "xp": 300, "check": lambda s, st: st["streak_days"] >= 7},
    {"id": "highscore",     "xp": 500, "check": lambda s, st: s.get("score", 0) >= 1000},
    {"id": "grind",         "xp": 400, "check": lambda s, st: st["total_sessions"] >= 50},
    {"id": "perfect",       "xp": 750, "check": lambda s, st: s.get("accuracy", 0) >= 100},
    {"id": "marathon",      "xp": 250, "check": lambda s, st: st["today_minutes"] >= 30},
    {"id": "dark_king",     "xp": 600, "check": lambda s, st: st["total_sessions"] >= 10 and st.get("total_penalties", 0) == 0},
    {"id": "night_hunter",  "xp": 450, "check": lambda s, st: s.get("accuracy", 0) >= 85 and s.get("score", 0) >= 700},
]

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Token",
}

def get_conn():
    return psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=5)

def get_session(cur, token: str):
    if not token:
        return None
    cur.execute(f"SELECT user_id, role, player_id FROM {SCHEMA}.auth_sessions WHERE token = '{token}' AND expires_at > NOW()")
    return cur.fetchone()

def is_teacher(cur, token: str) -> bool:
    sess = get_session(cur, token)
    return sess is not None and sess[1] == "teacher"

def calc_xp(score: int, accuracy: int, duration: int) -> int:
    base = score // 5
    accuracy_bonus = int(base * (accuracy / 100) * 0.5)
    duration_bonus = duration * 2
    return base + accuracy_bonus + duration_bonus

def get_player_stats(cur, player_id: str) -> dict:
    # Один запрос вместо трёх
    cur.execute(f"""
        SELECT
            COUNT(*) FILTER (WHERE played_at IS NOT NULL) AS total_sessions,
            COALESCE(SUM(duration) FILTER (WHERE played_at::date = CURRENT_DATE), 0) AS today_minutes
        FROM {SCHEMA}.sessions WHERE player_id = '{player_id}'
    """)
    row = cur.fetchone()
    cur.execute(f"SELECT COUNT(*) FROM {SCHEMA}.penalties WHERE player_id = '{player_id}'")
    penalties = cur.fetchone()[0]
    return {
        "total_sessions": row[0] if row else 0,
        "today_minutes": row[1] if row else 0,
        "streak_days": 1,
        "total_penalties": penalties,
    }

def check_achievements(cur, player_id: str, session: dict, stats: dict):
    cur.execute(f"SELECT achievement_id FROM {SCHEMA}.achievements_unlocked WHERE player_id = '{player_id}'")
    already = {row[0] for row in cur.fetchall()}
    new_achievements, bonus_xp = [], 0
    to_insert = []
    for ach in ACHIEVEMENTS_CONFIG:
        if ach["id"] not in already:
            try:
                if ach["check"](session, stats):
                    to_insert.append(ach["id"])
                    new_achievements.append(ach["id"])
                    bonus_xp += ach["xp"]
            except Exception:
                pass
    # Один INSERT вместо N
    if to_insert:
        values = ", ".join(f"('{player_id}', '{aid}')" for aid in to_insert)
        cur.execute(f"""
            INSERT INTO {SCHEMA}.achievements_unlocked (player_id, achievement_id)
            VALUES {values} ON CONFLICT DO NOTHING
        """)
    return new_achievements, bonus_xp

def ok(body, cors=CORS):
    return {"statusCode": 200, "headers": cors, "body": json.dumps(body, ensure_ascii=False)}

def err(status, msg, cors=CORS):
    return {"statusCode": status, "headers": cors, "body": json.dumps({"error": msg}, ensure_ascii=False)}

def handler(event: dict, context) -> dict:
    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": CORS, "body": ""}

    method = event.get("httpMethod", "GET")
    qs = event.get("queryStringParameters") or {}
    action = qs.get("action", "")
    headers = event.get("headers") or {}
    token = headers.get("x-token", "") or headers.get("X-Token", "")

    conn = None
    try:
        conn = get_conn()
        cur = conn.cursor()

        # GET ?action=profile — один JOIN вместо двух запросов
        if method == "GET" and action == "profile":
            player_id = qs.get("player_id", "ИГРОК_001")
            cur.execute(f"""
                SELECT p.nickname, p.avatar_id, p.xp,
                       a.achievement_id, a.unlocked_at
                FROM {SCHEMA}.players p
                LEFT JOIN {SCHEMA}.achievements_unlocked a ON a.player_id = p.player_id
                WHERE p.player_id = '{player_id}'
            """)
            rows = cur.fetchall()
            if not rows:
                return err(404, "not found")
            nickname, avatar_id, xp = rows[0][0], rows[0][1], rows[0][2]
            achs = [{"id": r[3], "unlocked_at": r[4].strftime("%d %b") if r[4] else ""}
                    for r in rows if r[3]]
            return ok({"nickname": nickname, "avatar_id": avatar_id, "xp": xp, "achievements": achs})

        # GET ?action=sessions
        if method == "GET" and action == "sessions":
            player_id = qs.get("player_id", "ИГРОК_001")
            cur.execute(f"""
                SELECT id, score, duration, accuracy, level, xp_earned, penalty_xp, played_at
                FROM {SCHEMA}.sessions
                WHERE player_id = '{player_id}'
                ORDER BY played_at DESC LIMIT 50
            """)
            sessions = [{"id": r[0], "score": r[1], "duration": r[2], "accuracy": r[3],
                         "level": r[4], "xp_earned": r[5], "penalty_xp": r[6],
                         "date": r[7].strftime("%d %b") if r[7] else ""} for r in cur.fetchall()]
            return ok({"sessions": sessions})

        # GET ?action=leaderboard
        if method == "GET" and action == "leaderboard":
            player_id = qs.get("player_id", "")
            cur.execute(f"""
                SELECT player_id, nickname, avatar_id, xp,
                       RANK() OVER (ORDER BY xp DESC) as rank
                FROM {SCHEMA}.players
                ORDER BY xp DESC
            """)
            board = [{"player_id": r[0], "nickname": r[1], "avatar_id": r[2],
                      "xp": r[3], "rank": r[4], "is_me": r[0] == player_id} for r in cur.fetchall()]
            return ok({"leaderboard": board})

        # GET ?action=penalties
        if method == "GET" and action == "penalties":
            player_id = qs.get("player_id", "ИГРОК_001")
            cur.execute(f"""
                SELECT id, penalty_xp, reason, issued_at
                FROM {SCHEMA}.penalties
                WHERE player_id = '{player_id}'
                ORDER BY issued_at DESC LIMIT 20
            """)
            penalties = [{"id": r[0], "penalty_xp": r[1], "reason": r[2],
                          "date": r[3].strftime("%d %b") if r[3] else ""} for r in cur.fetchall()]
            return ok({"penalties": penalties})

        # POST — добавить сессию (только преподаватель)
        if method == "POST" and action == "":
            if not is_teacher(cur, token):
                return err(403, "Только преподаватель может добавлять сессии")

            body = json.loads(event.get("body") or "{}")
            player_id = body.get("player_id", "")
            if not player_id:
                return err(400, "player_id required")

            score = int(body.get("score", 0))
            duration = int(body.get("duration", 0))
            accuracy = int(body.get("accuracy", 0))
            level = body.get("level", "Средний")
            penalty_xp = max(0, int(body.get("penalty_xp", 0)))

            xp_earned = calc_xp(score, accuracy, duration)
            net_xp = max(0, xp_earned - penalty_xp)

            # Вставка сессии + штраф одним блоком до stats (меньше round-trips)
            cur.execute(f"""
                INSERT INTO {SCHEMA}.sessions (player_id, score, duration, accuracy, level, xp_earned, penalty_xp)
                VALUES ('{player_id}', {score}, {duration}, {accuracy}, '{level}', {xp_earned}, {penalty_xp})
            """)
            if penalty_xp > 0:
                reason = body.get("penalty_reason", "Штраф за нарушение").replace("'", "''")
                cur.execute(f"""
                    INSERT INTO {SCHEMA}.penalties (player_id, penalty_xp, reason)
                    VALUES ('{player_id}', {penalty_xp}, '{reason}')
                """)

            stats = get_player_stats(cur, player_id)
            new_achs, bonus_xp = check_achievements(cur, player_id, body, stats)
            total_delta = net_xp + bonus_xp

            cur.execute(f"""
                UPDATE {SCHEMA}.players SET xp = GREATEST(0, xp + {total_delta}) WHERE player_id = '{player_id}'
                RETURNING xp
            """)
            new_total_xp = cur.fetchone()[0]
            conn.commit()
            return ok({"xp_earned": xp_earned, "penalty_xp": penalty_xp,
                       "net_xp": net_xp, "bonus_xp": bonus_xp,
                       "total_xp": new_total_xp, "new_achievements": new_achs})

        # POST ?action=penalty — отдельный штраф (только преподаватель)
        if method == "POST" and action == "penalty":
            if not is_teacher(cur, token):
                return err(403, "Только преподаватель может выдавать штрафы")

            body = json.loads(event.get("body") or "{}")
            player_id = body.get("player_id", "")
            penalty_xp = max(0, int(body.get("penalty_xp", 0)))
            reason = body.get("reason", "Штраф").replace("'", "''")

            cur.execute(f"""
                INSERT INTO {SCHEMA}.penalties (player_id, penalty_xp, reason)
                VALUES ('{player_id}', {penalty_xp}, '{reason}')
            """)
            cur.execute(f"""
                UPDATE {SCHEMA}.players SET xp = GREATEST(0, xp - {penalty_xp}) WHERE player_id = '{player_id}'
                RETURNING xp
            """)
            new_xp = cur.fetchone()[0]
            conn.commit()
            return ok({"ok": True, "penalty_xp": penalty_xp, "total_xp": new_xp})

        # PUT ?action=profile — только преподаватель (legacy)
        if method == "PUT" and action == "profile":
            if not is_teacher(cur, token):
                return err(403, "Нет доступа")
            body = json.loads(event.get("body") or "{}")
            player_id = body.get("player_id", "")
            avatar_id = body.get("avatar_id", "")
            nickname = body.get("nickname", "")
            sets = []
            if avatar_id:
                sets.append(f"avatar_id = '{avatar_id}'")
            if nickname:
                sets.append(f"nickname = '{nickname.replace(chr(39), chr(39)*2)}'")
            if sets:
                cur.execute(f"UPDATE {SCHEMA}.players SET {', '.join(sets)} WHERE player_id = '{player_id}'")
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
