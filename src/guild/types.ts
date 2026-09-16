export type Role = "teacher" | "student";
export type BranchId = "tactics" | "diplomacy" | "keeper";
export type Shield = "green" | "yellow" | "red" | "bleeding";
export type BarColor = "green" | "yellow" | "red";
export type Sticker = "angry" | "scared" | "change";
export type AttendanceStatus = "present" | "absent" | "excused";

export interface GuildAuth {
  token: string;
  role: Role;
  login: string;
  class_id: number;
  class_name: string;
  hero_id: number | null;
  nickname: string | null;
}

export interface TreeState {
  percent: number;
  color: "gray" | "blue" | "yellow" | "green";
  blinks: boolean;
  total_souls: number;
  class_target: number;
  adjust: number;
  bonuses: { threshold: number; id: string; title: string }[];
  festival_ready: boolean;
  souls_to_festival: number;
}

export interface AltarRow {
  hero_id: number;
  nickname: string;
  avatar: string;
  branch: BranchId;
  branch_title: string;
  level: number;
  souls: number;
  branch_points: number;
  branch_percent: number;
  armor: number;
  shield: Shield;
  debuffed: boolean;
  weakness: boolean;
}

export interface GuildState {
  class: {
    id: number;
    school_code: string;
    class_name: string;
    nickname_style: string;
    style_title: string;
  };
  tree: TreeState;
  altar: AltarRow[];
  festival: { id: number; status: string; tree_at_start: number; started_at: string } | null;
  server_time: string;
}

export interface HeroBar {
  id: "level" | "tactics" | "armor" | "mana";
  label: string;
  value: number;
  max: number;
  color: BarColor;
  hint: string;
}

export interface HeroCardData {
  hero_id: number;
  nickname: string;
  avatar: string;
  branch: BranchId;
  branch_title: string;
  bars: HeroBar[];
  level: number;
  souls: number;
  shield: Shield;
  debuffed: boolean;
  debuff_until: string | null;
  weakness: boolean;
  bonuses: string[];
  cheat_codes_left: number;
  history: { action: string; delta: number; note: string; at: string }[];
}

export interface FestivalForecast {
  tree_percent: number;
  threshold: number;
  ready: boolean;
  souls_left: number;
  heroes: number;
  souls_left_per_hero: number;
  program: { id: string; title: string; minutes: number }[];
  total_minutes: number;
}

export interface StudentRow {
  login: string;
  hero_id: number;
  nickname: string;
  branch: BranchId;
  souls: number;
  armor: number;
  branch_points: number;
  debuff_until: string | null;
  created_at: string;
}

export interface Credential {
  login: string;
  password: string;
  nickname: string;
  branch: BranchId;
}

export interface GuildMapData {
  branches: { branch: BranchId; title: string; heroes: number; souls: number; avg_armor: number }[];
  quiet_mail_week: Partial<Record<Sticker, number>>;
  heroes_low_armor: number;
  tree: TreeState;
}

export interface SoulAction {
  id: string;
  title: string;
  delta: number;
  weekly_limit: number | null;
}

export interface GameRules {
  soul_actions: SoulAction[];
  branches: Record<BranchId, { title: string; bonus_80: string; bonus_100: string }>;
  tree_bonuses: { threshold: number; id: string; title: string }[];
  festival_threshold: number;
  armor_max: number;
  mana_max: number;
  festival_program: { id: string; title: string; minutes: number }[];
}

// ─── События WebSocket (§7 ТЗ) ───────────────────────────────────────────────
export type GuildEventName =
  | "state"
  | "souls_updated"
  | "armor_changed"
  | "debuff_applied"
  | "festival_ready"
  | "pong";

export interface SoulsUpdatedPayload {
  hero_id: number;
  nickname: string | null;
  delta: number;
  reason: string;
  souls: number | null;
  branch_points: number | null;
  tree: TreeState;
}

export interface ArmorChangedPayload {
  day: string;
  changed: { hero_id: number; armor: number; delta: number; absences: number; weakness: boolean }[];
  tree: TreeState;
}

export interface DebuffPayload {
  kind: "mat" | "whistle" | "absence";
  hero_id?: number | null;
  blasts?: number;
  title?: string;
  tree_delta?: number;
  expires_at?: string;
  sound?: "whistle" | "debuff";
  vibrate?: number[];
  tree?: TreeState;
  at?: string;
}

export interface FestivalPayload {
  percent: number;
  threshold?: number;
  message?: string;
  started?: boolean;
  status?: string;
  program?: { id: string; title: string; minutes: number }[];
}

export type GuildEvent =
  | { event: "state"; payload: GuildState }
  | { event: "souls_updated"; payload: SoulsUpdatedPayload }
  | { event: "armor_changed"; payload: ArmorChangedPayload }
  | { event: "debuff_applied"; payload: DebuffPayload }
  | { event: "festival_ready"; payload: FestivalPayload }
  | { event: "pong"; payload: Record<string, never> };

export type LinkStatus = "connecting" | "live" | "polling" | "offline";
