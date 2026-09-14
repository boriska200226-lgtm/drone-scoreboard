import type {
  AttendanceStatus, Credential, FestivalForecast, GameRules, GuildAuth,
  GuildMapData, GuildState, HeroCardData, Sticker, StudentRow, TreeState,
} from "./types";

// Пути относительные: фронт, REST и WebSocket живут на одном домене
// (см. deploy/nginx.conf), поэтому wss:// поднимается без CORS.
export const GUILD_API = import.meta.env.VITE_GUILD_API ?? "/api";
const WS_PATH = import.meta.env.VITE_GUILD_WS ?? "/ws";

const STORAGE_KEY = "guild_auth";

export function wsUrl(token: string): string {
  if (/^wss?:\/\//.test(WS_PATH)) return `${WS_PATH}?token=${encodeURIComponent(token)}`;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${WS_PATH}?token=${encodeURIComponent(token)}`;
}

export function saveAuth(auth: GuildAuth) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

export function loadAuth(): GuildAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GuildAuth) : null;
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (token) headers.set("X-Token", token);

  let res: Response;
  try {
    res = await fetch(`${GUILD_API}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, "Нет связи с сервером гильдии");
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data?.detail ?? data?.error;
    throw new ApiError(res.status, typeof detail === "string" ? detail : `Ошибка ${res.status}`);
  }
  return data as T;
}

const post = <T>(path: string, body?: unknown, token?: string) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }, token);

const get = <T>(path: string, token?: string) => request<T>(path, {}, token);

// ─── Общее ────────────────────────────────────────────────────────────────────
export const api = {
  login: (login: string, password: string, totp?: string) =>
    post<GuildAuth>("/auth/login", { login, password, totp: totp || null }),

  logout: (token: string) => post<{ ok: boolean }>("/auth/logout", undefined, token),

  authConfig: () => get<{ require_teacher_2fa: boolean }>("/auth/config"),

  twoFaSetup: (login: string, password: string) =>
    post<{ secret: string; otpauth_url: string }>("/auth/2fa/setup", { login, password }),

  twoFaConfirm: (login: string, password: string, code: string) =>
    post<{ ok: boolean }>("/auth/2fa/confirm", { login, password, code }),

  // REST-fallback: клиент зовёт это раз в 5 секунд, пока сокет лежит.
  state: (token: string) => get<GuildState>("/guild/state", token),
  tree: (token: string) => get<TreeState>("/guild/tree", token),
  rules: () => get<GameRules>("/guild/rules"),
  forecast: (token: string) => get<FestivalForecast>("/guild/festival/forecast", token),

  // ─── Ученик ────────────────────────────────────────────────────────────────
  heroCard: (token: string) => get<HeroCardData>("/hero/me", token),
  quietMail: (token: string, sticker: Sticker) =>
    post<{ ok: boolean; delta: number }>("/hero/quiet-mail", { sticker }, token),
  setAvatar: (token: string, avatar: string) =>
    post<{ ok: boolean; avatar: string }>("/hero/avatar", { avatar }, token),
  vote: (token: string, topic: "nickname_style" | "tea_menu", option: string) =>
    post<{ ok: boolean; results: { option: string; votes: number }[] }>(
      "/hero/vote", { topic, option }, token),
  voteResults: (token: string, topic: "nickname_style" | "tea_menu") =>
    get<{ topic: string; my_option: string | null; results: { option: string; votes: number }[] }>(
      `/hero/vote/${topic}`, token),

  // ─── Учитель ───────────────────────────────────────────────────────────────
  students: (token: string) => get<{ students: StudentRow[] }>("/teacher/students", token),
  generate: (token: string, count: number, realNames: string[] = []) =>
    post<Credential[]>("/teacher/students/generate", { count, real_names: realNames }, token),
  resetPassword: (token: string, login: string) =>
    post<{ login: string; password: string; parent_message: string }>(
      "/teacher/students/reset-password", { login }, token),
  award: (token: string, heroId: number, action: string, note = "") =>
    post<{ ok: boolean; delta: number; tree: TreeState }>(
      "/teacher/award", { hero_id: heroId, action, note }, token),
  attendance: (token: string, day: string,
               items: { hero_id: number; status: AttendanceStatus; lesson: number }[]) =>
    post<{ ok: boolean; saved: number }>("/teacher/attendance", { day, items }, token),
  runArmor: (token: string, day?: string) =>
    post<{ ok: boolean; processed: number; tree: TreeState }>(
      "/teacher/armor/run", { day: day ?? null }, token),
  mat: (token: string, heroId: number | null, note = "") =>
    post<{ ok: boolean; tree: TreeState }>("/teacher/mat", { hero_id: heroId, note }, token),
  whistle: (token: string, blasts: 1 | 2) =>
    post<{ ok: boolean; delivered: number; blasts: number }>(
      "/teacher/whistle", { blasts }, token),
  startFestival: (token: string) =>
    post<{ ok: boolean; festival: { status: string }; tree: TreeState }>(
      "/teacher/festival/start", undefined, token),
  guildMap: (token: string) => get<GuildMapData>("/teacher/map", token),
  quietMailFeed: (token: string) =>
    get<{ letters: { sticker: Sticker; day: string; count: number }[] }>(
      "/teacher/quiet-mail", token),
  registryLookup: (token: string, heroId: number, totp: string) =>
    post<{ hero_id: number; nickname: string; real_name: string }>(
      "/teacher/registry/lookup", { hero_id: heroId, totp }, token),
  exportUrl: () => `${GUILD_API}/teacher/export.csv`,
};
