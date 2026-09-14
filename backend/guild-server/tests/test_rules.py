"""Механика «Гильдии» — арифметика без БД."""
import math

import pytest

from app import nicknames, rules


class TestSouls:
    def test_all_actions_positive(self):
        for key, (delta, title, _limit) in rules.SOUL_ACTIONS.items():
            assert delta > 0, key
            assert title

    def test_cheat_code_is_weekly_limited(self):
        delta, _title, limit = rules.SOUL_ACTIONS["cheat_code"]
        assert (delta, limit) == (10, 3)

    @pytest.mark.parametrize("souls,level,progress", [
        (0, 1, 0), (45, 1, 45), (99, 1, 99), (100, 2, 0), (250, 3, 50),
    ])
    def test_level(self, souls, level, progress):
        assert rules.level_of(souls) == level
        assert rules.level_progress(souls) == progress

    @pytest.mark.parametrize("raises,mana", [(0, 0), (2, 0), (3, 1), (8, 2), (99, 5)])
    def test_mana(self, raises, mana):
        assert rules.mana_of(raises) == mana


class TestBarColor:
    @pytest.mark.parametrize("value,expected", [
        (100, "green"), (80, "green"), (79, "yellow"), (50, "yellow"),
        (49, "red"), (0, "red"),
    ])
    def test_thresholds(self, value, expected):
        assert rules.bar_color(value, 100) == expected

    def test_zero_max_is_red(self):
        assert rules.bar_color(0, 0) == "red"


class TestShield:
    def test_zero_armor_bleeds(self):
        assert rules.shield_state(0, False) == "bleeding"

    def test_debuff_shows_red_even_with_full_armor(self):
        assert rules.shield_state(10, True) == "red"

    @pytest.mark.parametrize("armor,expected", [(10, "green"), (8, "green"), (6, "yellow"), (2, "red")])
    def test_by_armor(self, armor, expected):
        assert rules.shield_state(armor, False) == expected


class TestArmor:
    @pytest.mark.parametrize("absences,armor_delta,tree_delta,weakness", [
        (0, 1, 0, False),
        (1, 1, 0, False),
        (2, 0, 0, False),
        (3, -2, -5, False),
        (4, -4, -10, True),
        (7, -4, -10, True),
    ])
    def test_outcome_table(self, absences, armor_delta, tree_delta, weakness):
        out = rules.armor_outcome(absences)
        assert (out.armor_delta, out.tree_delta, out.weakness) == (armor_delta, tree_delta, weakness)

    def test_armor_is_clamped_to_scale(self):
        assert rules.apply_armor(10, 1) == 10
        assert rules.apply_armor(1, -4) == 0
        assert rules.apply_armor(5, -2) == 3

    def test_weakness_lasts_three_days(self):
        assert rules.WEAKNESS_DAYS == 3


class TestTree:
    def test_one_soul_is_one_percent_at_default_target(self):
        assert rules.tree_percent(37, 0, 100) == 37

    def test_target_scales_percent(self):
        assert rules.tree_percent(500, 0, 1000) == 50

    def test_debuff_lowers_percent(self):
        assert rules.tree_percent(70, -10, 100) == 60

    def test_percent_never_leaves_0_100(self):
        assert rules.tree_percent(9999, 0, 100) == 100
        assert rules.tree_percent(0, -40, 100) == 0

    @pytest.mark.parametrize("percent,color", [
        (10, "gray"), (49, "gray"), (50, "blue"), (64, "blue"),
        (65, "yellow"), (69, "yellow"), (70, "green"), (100, "green"),
    ])
    def test_colors(self, percent, color):
        assert rules.tree_color(percent) == color

    @pytest.mark.parametrize("percent,blinks", [(64, False), (65, True), (75, True), (76, False)])
    def test_blink_window(self, percent, blinks):
        assert rules.tree_blinks(percent) is blinks

    def test_bonus_unlocks(self):
        assert rules.unlocked_tree_bonuses(49) == []
        ids = [b["id"] for b in rules.unlocked_tree_bonuses(85)]
        assert ids == ["playlist", "festival", "cheat_x3"]
        assert len(rules.unlocked_tree_bonuses(100)) == 4

    def test_festival_gate(self):
        assert rules.festival_ready(69) is False
        assert rules.festival_ready(70) is True


class TestForecast:
    def test_from_scratch(self):
        assert rules.souls_to_festival(0, 0, 100) == 70

    def test_partial(self):
        assert rules.souls_to_festival(50, 0, 100) == 20

    def test_debuff_raises_the_bar(self):
        assert rules.souls_to_festival(50, -10, 100) == 30

    def test_zero_when_ready(self):
        assert rules.souls_to_festival(90, 0, 100) == 0

    def test_rounds_up_so_the_goal_is_actually_reachable(self):
        # 70% от 333 СЗ = 233.1 — 233 СЗ не хватит, нужно 234.
        need = rules.souls_to_festival(0, 0, 333)
        assert need == math.ceil(333 * 0.7)
        assert rules.tree_percent(need, 0, 333) >= rules.FESTIVAL_THRESHOLD


class TestBranches:
    def test_three_branches_with_both_bonuses(self):
        assert set(rules.BRANCHES) == {"tactics", "diplomacy", "keeper"}
        for meta in rules.BRANCHES.values():
            assert meta["bonus_80"] and meta["bonus_100"]

    def test_bonus_unlock_order(self):
        assert rules.branch_bonuses("tactics", 79) == []
        assert len(rules.branch_bonuses("tactics", 80)) == 1
        assert len(rules.branch_bonuses("tactics", 100)) == 2

    def test_unknown_branch_has_no_bonuses(self):
        assert rules.branch_bonuses("wizardry", 100) == []


class TestNicknames:
    @pytest.mark.parametrize("style", nicknames.STYLES)
    def test_allocates_25_unique(self, style):
        pairs = nicknames.allocate(style, 25)
        assert len({n for n, _ in pairs}) == 25

    def test_spreads_across_branches(self):
        pairs = nicknames.allocate("totem", 24)
        counts = {b: sum(1 for _, br in pairs if br == b) for b in nicknames.BRANCH_ORDER}
        assert set(counts.values()) == {8}

    def test_respects_taken_nicknames(self):
        first = nicknames.allocate("craft", 10)
        taken = {n for n, _ in first}
        second = nicknames.allocate("craft", 10, taken)
        assert taken.isdisjoint({n for n, _ in second})

    def test_refuses_to_repeat_when_pool_is_exhausted(self):
        with pytest.raises(ValueError):
            nicknames.allocate("totem", nicknames.capacity("totem") + 1)

    def test_unknown_style(self):
        with pytest.raises(ValueError):
            nicknames.allocate("dragons", 3)
