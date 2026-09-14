"""Сквозные сценарии: класс → 25 учёток → игра → Фестиваль."""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.asyncio

BOOTSTRAP = {"X-Bootstrap-Token": "test-bootstrap"}
CLASS = {"school_code": "42", "class_name": "7b", "teacher_password": "Hranitel-2026",
         "nickname_style": "totem", "class_target": 100}


class Recorder:
    """Подставной сокет: ловит то, что Hub разослал бы в класс."""

    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_text(self, raw: str) -> None:
        self.messages.append(json.loads(raw))

    def events(self, name: str) -> list[dict]:
        return [m["payload"] for m in self.messages if m["event"] == name]


async def bootstrap_class(api) -> dict:
    created = await api.post("/api/teacher/class", json=CLASS, headers=BOOTSTRAP)
    assert created.status_code == 201, created.text
    login = await api.post("/api/auth/login", json={
        "login": created.json()["teacher_login"], "password": CLASS["teacher_password"]})
    assert login.status_code == 200, login.text
    return {"class": created.json(), "teacher": login.json()}


def auth(token: str) -> dict:
    return {"X-Token": token}


async def make_class_with_students(api, count: int = 25):
    ctx = await bootstrap_class(api)
    token = ctx["teacher"]["token"]
    res = await api.post("/api/teacher/students/generate", json={"count": count},
                         headers=auth(token))
    assert res.status_code == 200, res.text
    ctx["students"] = res.json()
    ctx["token"] = token
    ctx["class_id"] = ctx["teacher"]["class_id"]
    return ctx


async def student_login(api, cred) -> dict:
    res = await api.post("/api/auth/login",
                         json={"login": cred["login"], "password": cred["password"]})
    assert res.status_code == 200, res.text
    return res.json()


async def hero_id_of(api, token: str, nickname: str) -> int:
    students = (await api.get("/api/teacher/students", headers=auth(token))).json()["students"]
    return next(s["hero_id"] for s in students if s["nickname"] == nickname)


# ─── Создание класса и учёток ─────────────────────────────────────────────────
class TestBootstrap:
    async def test_class_needs_bootstrap_token(self, api):
        res = await api.post("/api/teacher/class", json=CLASS)
        assert res.status_code == 403

    async def test_class_and_teacher_login_template(self, api):
        ctx = await bootstrap_class(api)
        assert ctx["class"]["teacher_login"] == "t_42_7b"
        assert ctx["teacher"]["role"] == "teacher"

    async def test_class_is_unique(self, api):
        await bootstrap_class(api)
        again = await api.post("/api/teacher/class", json=CLASS, headers=BOOTSTRAP)
        assert again.status_code == 400

    async def test_wrong_password_rejected(self, api):
        await bootstrap_class(api)
        res = await api.post("/api/auth/login", json={"login": "t_42_7b", "password": "nope"})
        assert res.status_code == 401


class TestGeneration:
    async def test_creates_25_unique_accounts(self, api):
        ctx = await make_class_with_students(api, 25)
        creds = ctx["students"]
        assert len(creds) == 25
        assert len({c["login"] for c in creds}) == 25
        assert len({c["nickname"] for c in creds}) == 25
        assert len({c["password"] for c in creds}) == 25

    async def test_login_and_password_shape(self, api):
        ctx = await make_class_with_students(api, 3)
        for i, cred in enumerate(ctx["students"], start=1):
            assert cred["login"] == f"s_7b_{i:02d}"
            assert len(cred["password"]) == 12

    async def test_second_batch_does_not_reuse_nicknames(self, api):
        ctx = await make_class_with_students(api, 10)
        more = await api.post("/api/teacher/students/generate", json={"count": 10},
                              headers=auth(ctx["token"]))
        assert more.status_code == 200
        first = {c["nickname"] for c in ctx["students"]}
        assert first.isdisjoint({c["nickname"] for c in more.json()})
        assert more.json()[0]["login"] == "s_7b_11"

    async def test_generated_student_can_log_in(self, api):
        ctx = await make_class_with_students(api, 2)
        me = await student_login(api, ctx["students"][0])
        assert me["role"] == "student"
        assert me["nickname"] == ctx["students"][0]["nickname"]

    async def test_reset_password_replaces_the_old_one(self, api):
        ctx = await make_class_with_students(api, 2)
        cred = ctx["students"][0]
        reset = await api.post("/api/teacher/students/reset-password",
                               json={"login": cred["login"]}, headers=auth(ctx["token"]))
        assert reset.status_code == 200
        body = reset.json()
        assert len(body["password"]) == 12
        assert cred["login"] in body["parent_message"]
        # Старый пароль больше не работает, новый — работает.
        old = await api.post("/api/auth/login",
                             json={"login": cred["login"], "password": cred["password"]})
        assert old.status_code == 401
        new = await api.post("/api/auth/login",
                             json={"login": cred["login"], "password": body["password"]})
        assert new.status_code == 200


# ─── Границы ролей ────────────────────────────────────────────────────────────
class TestAccess:
    async def test_student_cannot_reach_teacher_tools(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        headers = auth(student["token"])
        for path, payload in [
            ("/api/teacher/award", {"hero_id": 1, "action": "kind_word"}),
            ("/api/teacher/whistle", {"blasts": 1}),
            ("/api/teacher/mat", {}),
            ("/api/teacher/festival/start", {}),
        ]:
            res = await api.post(path, json=payload, headers=headers)
            assert res.status_code == 403, path
        assert (await api.get("/api/teacher/map", headers=headers)).status_code == 403
        assert (await api.get("/api/teacher/students", headers=headers)).status_code == 403

    async def test_altar_has_no_real_names_only_nicknames(self, api):
        ctx = await make_class_with_students(api, 5)
        student = await student_login(api, ctx["students"][0])
        state = (await api.get("/api/guild/state", headers=auth(student["token"]))).json()
        assert len(state["altar"]) == 5
        allowed = {"hero_id", "nickname", "avatar", "branch", "branch_title", "level",
                   "souls", "branch_points", "branch_percent", "armor", "shield",
                   "debuffed", "weakness"}
        for row in state["altar"]:
            assert set(row) == allowed

    async def test_hero_card_is_private(self, api):
        ctx = await make_class_with_students(api, 2)
        first = await student_login(api, ctx["students"][0])
        card = (await api.get("/api/hero/me", headers=auth(first["token"]))).json()
        assert card["hero_id"] == first["hero_id"]
        assert [b["id"] for b in card["bars"]] == ["level", "tactics", "armor", "mana"]

    async def test_anonymous_is_rejected(self, api):
        await make_class_with_students(api, 2)
        assert (await api.get("/api/guild/state")).status_code == 401
        assert (await api.get("/api/hero/me")).status_code == 401

    async def test_logout_kills_the_token(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        headers = auth(student["token"])
        assert (await api.get("/api/hero/me", headers=headers)).status_code == 200
        await api.post("/api/auth/logout", headers=headers)
        assert (await api.get("/api/hero/me", headers=headers)).status_code == 401


# ─── СЗ и Древо ───────────────────────────────────────────────────────────────
class TestSouls:
    async def test_award_moves_hero_and_tree(self, api):
        ctx = await make_class_with_students(api, 4)
        hero = await hero_id_of(api, ctx["token"], ctx["students"][0]["nickname"])
        res = await api.post("/api/teacher/award",
                             json={"hero_id": hero, "action": "translate_mat"},
                             headers=auth(ctx["token"]))
        assert res.status_code == 200
        assert res.json()["delta"] == 5
        assert res.json()["tree"]["percent"] == 5
        assert res.json()["tree"]["total_souls"] == 5

    async def test_unknown_action_rejected(self, api):
        ctx = await make_class_with_students(api, 2)
        hero = await hero_id_of(api, ctx["token"], ctx["students"][0]["nickname"])
        res = await api.post("/api/teacher/award", json={"hero_id": hero, "action": "fireball"},
                             headers=auth(ctx["token"]))
        assert res.status_code == 400

    async def test_cheat_code_is_capped_at_three_per_week(self, api):
        ctx = await make_class_with_students(api, 2)
        hero = await hero_id_of(api, ctx["token"], ctx["students"][0]["nickname"])
        for _ in range(3):
            ok = await api.post("/api/teacher/award",
                                json={"hero_id": hero, "action": "cheat_code"},
                                headers=auth(ctx["token"]))
            assert ok.status_code == 200
        fourth = await api.post("/api/teacher/award",
                                json={"hero_id": hero, "action": "cheat_code"},
                                headers=auth(ctx["token"]))
        assert fourth.status_code == 400
        assert "неделе" in fourth.json()["detail"]

    async def test_hand_raises_turn_into_mana(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        hero = student["hero_id"]
        for _ in range(3):
            await api.post("/api/teacher/award", json={"hero_id": hero, "action": "hand_raise"},
                           headers=auth(ctx["token"]))
        card = (await api.get("/api/hero/me", headers=auth(student["token"]))).json()
        mana = next(b for b in card["bars"] if b["id"] == "mana")
        assert mana["value"] == 1 and mana["max"] == 5

    async def test_quiet_mail_gives_two_souls(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        res = await api.post("/api/hero/quiet-mail", json={"sticker": "scared"},
                             headers=auth(student["token"]))
        assert res.status_code == 200 and res.json()["delta"] == 2
        card = (await api.get("/api/hero/me", headers=auth(student["token"]))).json()
        assert card["souls"] == 2

    async def test_teacher_sees_quiet_mail_without_authors(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        await api.post("/api/hero/quiet-mail", json={"sticker": "angry"},
                       headers=auth(student["token"]))
        letters = (await api.get("/api/teacher/quiet-mail", headers=auth(ctx["token"]))).json()
        assert letters["letters"] == [{"sticker": "angry", "day": date.today().isoformat(),
                                       "count": 1}]


# ─── Броня ────────────────────────────────────────────────────────────────────
class TestArmor:
    async def _absences(self, api, ctx, hero: int, count: int, day: date):
        items = [{"hero_id": hero, "status": "absent", "lesson": i + 1} for i in range(count)]
        res = await api.post("/api/teacher/attendance",
                             json={"day": day.isoformat(), "items": items},
                             headers=auth(ctx["token"]))
        assert res.status_code == 200

    async def test_three_absences_cost_armor_and_tree(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        day = date.today()
        await self._absences(api, ctx, student["hero_id"], 3, day)
        run = await api.post("/api/teacher/armor/run", json={"day": day.isoformat()},
                             headers=auth(ctx["token"]))
        assert run.status_code == 200
        assert run.json()["tree"]["adjust"] == -5
        card = (await api.get("/api/hero/me", headers=auth(student["token"]))).json()
        armor = next(b for b in card["bars"] if b["id"] == "armor")
        assert armor["value"] == 8

    async def test_four_absences_bring_weakness(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        day = date.today()
        await self._absences(api, ctx, student["hero_id"], 4, day)
        run = await api.post("/api/teacher/armor/run", json={"day": day.isoformat()},
                             headers=auth(ctx["token"]))
        assert run.json()["tree"]["adjust"] == -10
        card = (await api.get("/api/hero/me", headers=auth(student["token"]))).json()
        assert card["weakness"] is True
        assert next(b for b in card["bars"] if b["id"] == "armor")["value"] == 6

    async def test_excused_absence_is_free(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        day = date.today()
        items = [{"hero_id": student["hero_id"], "status": "excused", "lesson": i + 1}
                 for i in range(4)]
        await api.post("/api/teacher/attendance", json={"day": day.isoformat(), "items": items},
                       headers=auth(ctx["token"]))
        run = await api.post("/api/teacher/armor/run", json={"day": day.isoformat()},
                             headers=auth(ctx["token"]))
        assert run.json()["tree"]["adjust"] == 0

    async def test_rerun_does_not_double_count(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        day = date.today()
        await self._absences(api, ctx, student["hero_id"], 3, day)
        first = await api.post("/api/teacher/armor/run", json={"day": day.isoformat()},
                               headers=auth(ctx["token"]))
        second = await api.post("/api/teacher/armor/run", json={"day": day.isoformat()},
                                headers=auth(ctx["token"]))
        assert first.json()["tree"]["adjust"] == -5
        assert second.json()["processed"] == 0
        assert second.json()["tree"]["adjust"] == -5

    async def test_clean_day_restores_one_armor(self, api):
        ctx = await make_class_with_students(api, 2)
        student = await student_login(api, ctx["students"][0])
        yesterday = date.today() - timedelta(days=1)
        await self._absences(api, ctx, student["hero_id"], 3, yesterday)
        await api.post("/api/teacher/armor/run", json={"day": yesterday.isoformat()},
                       headers=auth(ctx["token"]))
        await api.post("/api/teacher/armor/run", json={"day": date.today().isoformat()},
                       headers=auth(ctx["token"]))
        card = (await api.get("/api/hero/me", headers=auth(student["token"]))).json()
        assert next(b for b in card["bars"] if b["id"] == "armor")["value"] == 9


# ─── Анти-мат, Свисток, реальное время ────────────────────────────────────────
class TestRealtime:
    async def test_award_is_broadcast_to_the_class(self, api):
        from app.hub import EVT_SOULS, hub

        ctx = await make_class_with_students(api, 3)
        rec = Recorder()
        await hub.join(ctx["class_id"], rec)
        hero = await hero_id_of(api, ctx["token"], ctx["students"][0]["nickname"])
        await api.post("/api/teacher/award", json={"hero_id": hero, "action": "kind_word"},
                       headers=auth(ctx["token"]))
        await hub.leave(ctx["class_id"], rec)

        events = rec.events(EVT_SOULS)
        assert len(events) == 1
        assert events[0]["delta"] == 2
        assert events[0]["tree"]["percent"] == 2

    async def test_whistle_reaches_every_device(self, api):
        from app.hub import EVT_DEBUFF, hub

        ctx = await make_class_with_students(api, 3)
        listeners = [Recorder() for _ in range(3)]
        for r in listeners:
            await hub.join(ctx["class_id"], r)
        res = await api.post("/api/teacher/whistle", json={"blasts": 1}, headers=auth(ctx["token"]))
        for r in listeners:
            await hub.leave(ctx["class_id"], r)

        assert res.json()["delivered"] == 3
        for r in listeners:
            payload = r.events(EVT_DEBUFF)[0]
            assert payload["kind"] == "whistle"
            assert payload["sound"] == "whistle"
            assert payload["vibrate"] == [100]

    async def test_double_whistle_means_analysis(self, api):
        from app.hub import EVT_DEBUFF, hub

        ctx = await make_class_with_students(api, 2)
        rec = Recorder()
        await hub.join(ctx["class_id"], rec)
        await api.post("/api/teacher/whistle", json={"blasts": 2}, headers=auth(ctx["token"]))
        await hub.leave(ctx["class_id"], rec)
        payload = rec.events(EVT_DEBUFF)[0]
        assert payload["blasts"] == 2 and payload["title"] == "РАЗБОР"

    async def test_mat_costs_ten_percent_and_debuffs_for_a_day(self, api):
        from app.hub import EVT_DEBUFF, hub

        ctx = await make_class_with_students(api, 4)
        hero = await hero_id_of(api, ctx["token"], ctx["students"][0]["nickname"])
        for _ in range(10):
            await api.post("/api/teacher/award", json={"hero_id": hero, "action": "translate_mat"},
                           headers=auth(ctx["token"]))
        rec = Recorder()
        await hub.join(ctx["class_id"], rec)
        res = await api.post("/api/teacher/mat", json={"hero_id": hero}, headers=auth(ctx["token"]))
        await hub.leave(ctx["class_id"], rec)

        assert res.json()["tree"]["percent"] == 40   # 50 СЗ − 10 п.п.
        assert rec.events(EVT_DEBUFF)[0]["tree_delta"] == -10
        altar = (await api.get("/api/guild/altar", headers=auth(ctx["token"]))).json()["altar"]
        target = next(h for h in altar if h["hero_id"] == hero)
        assert target["debuffed"] is True and target["shield"] == "red"

    async def test_rest_fallback_matches_socket_snapshot(self, api):
        from app.hub import EVT_STATE, hub

        ctx = await make_class_with_students(api, 3)
        rest = (await api.get("/api/guild/state", headers=auth(ctx["token"]))).json()
        rec = Recorder()
        await hub.join(ctx["class_id"], rec)
        import app.service as service
        snapshot = await service.guild_state(ctx["class_id"])
        await rec.send_text(json.dumps({"event": EVT_STATE, "payload": snapshot}))
        await hub.leave(ctx["class_id"], rec)
        socket_state = rec.events(EVT_STATE)[0]
        assert socket_state["altar"] == rest["altar"]
        assert socket_state["tree"] == rest["tree"]


# ─── Фестиваль ────────────────────────────────────────────────────────────────
class TestFestival:
    async def test_forecast_counts_souls_not_people(self, api):
        ctx = await make_class_with_students(api, 25)
        forecast = (await api.get("/api/guild/festival/forecast",
                                  headers=auth(ctx["token"]))).json()
        assert forecast["souls_left"] == 70
        assert forecast["ready"] is False
        assert forecast["heroes"] == 25
        assert forecast["souls_left_per_hero"] == 3
        assert forecast["total_minutes"] == 90
        assert "nickname" not in json.dumps(forecast)

    async def test_below_threshold_is_a_raid(self, api):
        ctx = await make_class_with_students(api, 3)
        res = await api.post("/api/teacher/festival/start", headers=auth(ctx["token"]))
        assert res.json()["festival"]["status"] == "raid"

    async def test_seventy_percent_unlocks_the_festival(self, api):
        from app.hub import EVT_FESTIVAL, hub

        ctx = await make_class_with_students(api, 5)
        heroes = [s["hero_id"] for s in
                  (await api.get("/api/teacher/students", headers=auth(ctx["token"]))).json()["students"]]
        rec = Recorder()
        await hub.join(ctx["class_id"], rec)
        # Доброе слово = 2 СЗ: 7 слов × 5 героев = 70 СЗ = 70%.
        for hero in heroes:
            for _ in range(7):
                await api.post("/api/teacher/award",
                               json={"hero_id": hero, "action": "kind_word"},
                               headers=auth(ctx["token"]))
        tree = (await api.get("/api/guild/tree", headers=auth(ctx["token"]))).json()
        assert tree["percent"] == 70 and tree["festival_ready"] is True
        assert tree["color"] == "green"
        assert {b["id"] for b in tree["bonuses"]} == {"playlist", "festival"}
        assert rec.events(EVT_FESTIVAL), "класс не услышал, что Фестиваль открылся"

        started = await api.post("/api/teacher/festival/start", headers=auth(ctx["token"]))
        await hub.leave(ctx["class_id"], rec)
        assert started.json()["festival"]["status"] == "running"
        assert len(started.json()["program"]) == 5


# ─── Реестр и экспорт ─────────────────────────────────────────────────────────
class TestRegistry:
    async def test_lookup_requires_a_confirmed_second_factor(self, api):
        ctx = await bootstrap_class(api)
        token = ctx["teacher"]["token"]
        created = await api.post("/api/teacher/students/generate",
                                 json={"count": 2, "real_names": ["Иванов Пётр", "Сидорова Аня"]},
                                 headers=auth(token))
        hero = await hero_id_of(api, token, created.json()[0]["nickname"])
        res = await api.post("/api/teacher/registry/lookup",
                             json={"hero_id": hero, "totp": "000000"}, headers=auth(token))
        assert res.status_code == 401

    async def test_lookup_returns_the_name_with_a_valid_code(self, api):
        from app import db
        from app.security import gen_totp_secret, totp_at

        ctx = await bootstrap_class(api)
        token = ctx["teacher"]["token"]
        created = await api.post("/api/teacher/students/generate",
                                 json={"count": 2, "real_names": ["Иванов Пётр", "Сидорова Аня"]},
                                 headers=auth(token))
        nickname = created.json()[0]["nickname"]
        hero = await hero_id_of(api, token, nickname)

        secret = gen_totp_secret()
        await db.execute(
            "UPDATE users SET totp_secret = $1, totp_confirmed = TRUE WHERE login = 't_42_7b'",
            secret,
        )
        res = await api.post("/api/teacher/registry/lookup",
                             json={"hero_id": hero, "totp": totp_at(secret)}, headers=auth(token))
        assert res.status_code == 200
        assert res.json() == {"hero_id": hero, "nickname": nickname, "real_name": "Иванов Пётр"}

    async def test_real_names_are_encrypted_at_rest(self, api):
        from app import db

        ctx = await bootstrap_class(api)
        await api.post("/api/teacher/students/generate",
                       json={"count": 1, "real_names": ["Иванов Пётр"]},
                       headers=auth(ctx["teacher"]["token"]))
        blob = await db.fetchval("SELECT real_name_enc FROM registry LIMIT 1")
        assert blob and "Иванов".encode() not in bytes(blob)

    async def test_export_carries_nicknames_only(self, api):
        ctx = await bootstrap_class(api)
        token = ctx["teacher"]["token"]
        await api.post("/api/teacher/students/generate",
                       json={"count": 3, "real_names": ["Иванов Пётр", "Сидорова Аня", "Ким Лев"]},
                       headers=auth(token))
        res = await api.get("/api/teacher/export.csv", headers=auth(token))
        assert res.status_code == 200
        body = res.content.decode("utf-8-sig")
        assert "Кличка" in body
        for name in ("Иванов", "Сидорова", "Ким"):
            assert name not in body


# ─── Служебное ────────────────────────────────────────────────────────────────
class TestService:
    async def test_health(self, api):
        res = await api.get("/health")
        assert res.json() == {"status": "ok", "db": "up"}

    async def test_rules_endpoint_describes_the_game(self, api):
        res = (await api.get("/api/guild/rules")).json()
        assert res["festival_threshold"] == 70
        assert {a["id"] for a in res["soul_actions"]} >= {
            "kind_word", "translate_mat", "help_three", "hand_raise", "cheat_code"}
        assert len(res["festival_program"]) == 5

    async def test_guild_map_is_aggregate_only(self, api):
        ctx = await make_class_with_students(api, 6)
        res = (await api.get("/api/teacher/map", headers=auth(ctx["token"]))).json()
        assert sum(b["heroes"] for b in res["branches"]) == 6
        assert "nickname" not in json.dumps(res)
