"""Чистые правила «Гильдии»: СЗ, Броня, Древо, ветки, Фестиваль.

Модуль намеренно не знает ни про БД, ни про HTTP — только арифметика игры,
чтобы механику можно было покрыть тестами без окружения.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

Branch = Literal["tactics", "diplomacy", "keeper"]

# ─── СЗ (опыт) ────────────────────────────────────────────────────────────────
# Ключ -> (сколько СЗ, человекочитаемое название, лимит в неделю или None)
SOUL_ACTIONS: dict[str, tuple[int, str, int | None]] = {
    "kind_word":     (2,  "Доброе слово",                 None),
    "translate_mat": (5,  "Перевод мата",                 None),
    "help_three":    (3,  "Помощь троим",                 None),
    "hand_raise":    (1,  "Поднятая рука",                None),
    "cheat_code":    (10, "Чит-код «было трудно»",        3),
    "quiet_mail":    (2,  "Тихая почта",                  None),
}

# 3 поднятия руки = 1 мана, шкала маны — 5 клеток
RAISES_PER_MANA = 3
MANA_MAX = 5

# ─── Броня ────────────────────────────────────────────────────────────────────
ARMOR_MAX = 10
WEAKNESS_DAYS = 3

# ─── Древо ────────────────────────────────────────────────────────────────────
# «1 СЗ = 1%» из ТЗ — это class_target = 100. Для класса из 25 человек
# осмысленнее поднять цель, поэтому значение хранится в классе.
DEFAULT_CLASS_TARGET = 100

TREE_PENALTY_MAT = -10          # §5 «Анти-мат»: –10% Древа за мат
TREE_PENALTY_ABSENT_3 = -5      # 3 прогула за день
TREE_PENALTY_ABSENT_4 = -10     # 4+ прогула за день

MAT_DEBUFF_HOURS = 24

TREE_BONUSES = [
    (50,  "playlist",  "Плейлист класса"),
    (70,  "festival",  "Фестиваль разблокирован"),
    (85,  "cheat_x3",  "Чит-код ×3"),
    (100, "no_test",   "Отмена проверочной"),
]

FESTIVAL_THRESHOLD = 70

# ─── Ветки ────────────────────────────────────────────────────────────────────
BRANCHES: dict[str, dict[str, str]] = {
    "tactics": {
        "title": "Тактика",
        "bonus_80": "Отмена 1 проверочной (формат меняет ученик)",
        "bonus_100": "Выбор 2 игр на Фестивале",
    },
    "diplomacy": {
        "title": "Дипломатия",
        "bonus_80": "+15 мин к чаепитию",
        "bonus_100": "Приглашение гостя (15 мин)",
    },
    "keeper": {
        "title": "Хранитель",
        "bonus_80": "Свисток (стоп-игра)",
        "bonus_100": "Право вето на 1 формат",
    },
}

BRANCH_MAX = 100
LEVEL_SCALE = 100  # одна «полоса» уровня = 100 СЗ


def clamp(value: int, low: int = 0, high: int = 100) -> int:
    return max(low, min(high, value))


# ─── Уровень ──────────────────────────────────────────────────────────────────
def level_of(souls: int) -> int:
    """Уровень героя: каждые 100 СЗ — новый уровень, счёт с первого."""
    return max(0, souls) // LEVEL_SCALE + 1


def level_progress(souls: int) -> int:
    """Сколько СЗ набрано внутри текущего уровня (0..99)."""
    return max(0, souls) % LEVEL_SCALE


# ─── Цвет шкалы ───────────────────────────────────────────────────────────────
def bar_color(current: int, maximum: int) -> str:
    """Цвет шкалы по ТЗ: ≥80% 🟢, 50–79% 🟡, <50% 🔴."""
    if maximum <= 0:
        return "red"
    pct = current * 100 / maximum
    if pct >= 80:
        return "green"
    if pct >= 50:
        return "yellow"
    return "red"


def shield_state(armor: int, debuff_active: bool) -> str:
    """Щит на публичном Алтаре: 🟢 / 🟡 / 🔴 / 🩸."""
    if armor <= 0:
        return "bleeding"          # 🩸 красная рамка
    if debuff_active:
        return "red"               # 🔴 активный дебафф
    return bar_color(armor, ARMOR_MAX) if armor < ARMOR_MAX else "green"


# ─── Броня: ночной пересчёт ───────────────────────────────────────────────────
@dataclass(frozen=True)
class ArmorOutcome:
    armor_delta: int
    tree_delta: int
    weakness: bool

    @property
    def has_penalty(self) -> bool:
        return self.armor_delta < 0


def armor_outcome(absences: int) -> ArmorOutcome:
    """Итог дня по прогулам (excused в absences не попадает).

    0–1 → +1 Броня; 2 → без изменений; 3 → −2 Броня и −5% Древа;
    4+ → −4 Броня, −10% Древа и «Слабость» на 3 дня.
    """
    if absences <= 1:
        return ArmorOutcome(armor_delta=1, tree_delta=0, weakness=False)
    if absences == 2:
        return ArmorOutcome(armor_delta=0, tree_delta=0, weakness=False)
    if absences == 3:
        return ArmorOutcome(armor_delta=-2, tree_delta=TREE_PENALTY_ABSENT_3, weakness=False)
    return ArmorOutcome(armor_delta=-4, tree_delta=TREE_PENALTY_ABSENT_4, weakness=True)


def apply_armor(armor: int, delta: int) -> int:
    return clamp(armor + delta, 0, ARMOR_MAX)


# ─── Древо ────────────────────────────────────────────────────────────────────
def tree_percent(total_souls: int, adjust_percent: int, class_target: int) -> int:
    """Общий процент Древа.

    total_souls   — сумма СЗ класса,
    adjust_percent— накопленные дебаффы/бонусы в процентных пунктах (обычно ≤ 0),
    class_target  — сколько СЗ соответствует 100%.
    """
    target = max(1, class_target)
    return clamp(round(total_souls * 100 / target) + adjust_percent)


def tree_color(percent: int) -> str:
    """Цвет Древа: серая (Рейд <50), синяя, жёлтая (мигает 65–75), зелёная."""
    if percent < 50:
        return "gray"
    if percent < 65:
        return "blue"
    if percent < 70:
        return "yellow"
    return "green"


def tree_blinks(percent: int) -> bool:
    """Мигание в зоне 65–75%."""
    return 65 <= percent <= 75


def unlocked_tree_bonuses(percent: int) -> list[dict[str, str | int]]:
    return [
        {"threshold": t, "id": key, "title": title}
        for t, key, title in TREE_BONUSES
        if percent >= t
    ]


def festival_ready(percent: int) -> bool:
    return percent >= FESTIVAL_THRESHOLD


def souls_to_festival(total_souls: int, adjust_percent: int, class_target: int) -> int:
    """Сколько СЗ не хватает классу до Фестиваля. Без имён — только число."""
    target = max(1, class_target)
    needed_percent = FESTIVAL_THRESHOLD - adjust_percent
    needed_souls = needed_percent * target / 100
    return max(0, math.ceil(needed_souls - total_souls))


# ─── Ветки ────────────────────────────────────────────────────────────────────
def branch_bonuses(branch: str, points: int) -> list[str]:
    meta = BRANCHES.get(branch)
    if not meta:
        return []
    out: list[str] = []
    if points >= 80:
        out.append(meta["bonus_80"])
    if points >= BRANCH_MAX:
        out.append(meta["bonus_100"])
    return out


# ─── Мана ─────────────────────────────────────────────────────────────────────
def mana_of(hand_raises: int) -> int:
    return min(MANA_MAX, max(0, hand_raises) // RAISES_PER_MANA)
