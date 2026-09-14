import { useCallback, useEffect, useRef, useState } from "react";

import { api, wsUrl } from "./api";
import type { GuildEvent, GuildState, LinkStatus, TreeState } from "./types";

const RECONNECT_MS = 3000;   // §7 ТЗ: переподключение за 3 секунды
const POLL_MS = 5000;        // §7 ТЗ: REST-fallback раз в 5 секунд
const PING_MS = 25000;       // держим сокет живым сквозь прокси
const REFRESH_DEBOUNCE_MS = 250;

interface Options {
  token: string | null;
  onEvent?: (event: GuildEvent) => void;
}

interface Link {
  state: GuildState | null;
  tree: TreeState | null;
  status: LinkStatus;
  lastUpdate: number | null;
  refresh: () => void;
}

/**
 * Живая связь с гильдией.
 *
 * Пока WebSocket жив — данные приходят сами. Как только он падает, хук
 * переходит на опрос REST каждые 5 секунд и параллельно раз в 3 секунды
 * пробует поднять сокет обратно. Для экрана разница видна только по
 * значку связи: сами данные не пропадают.
 */
export function useGuildLink({ token, onEvent }: Options): Link {
  const [state, setState] = useState<GuildState | null>(null);
  const [tree, setTree] = useState<TreeState | null>(null);
  const [status, setStatus] = useState<LinkStatus>("connecting");
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const timers = useRef<{ reconnect?: number; poll?: number; ping?: number; refresh?: number }>({});
  const handler = useRef(onEvent);
  const closedByUs = useRef(false);

  handler.current = onEvent;

  const clearTimer = (key: keyof typeof timers.current) => {
    const id = timers.current[key];
    if (id !== undefined) {
      window.clearTimeout(id);
      window.clearInterval(id);
      timers.current[key] = undefined;
    }
  };

  const applyState = useCallback((next: GuildState) => {
    setState(next);
    setTree(next.tree);
    setLastUpdate(Date.now());
  }, []);

  const pollOnce = useCallback(async () => {
    if (!token) return;
    try {
      applyState(await api.state(token));
      setStatus((current) => (current === "live" ? current : "polling"));
    } catch {
      setStatus((current) => (current === "live" ? current : "offline"));
    }
  }, [token, applyState]);

  // Сокет не рассылает полный снимок после каждого события — просим его сами,
  // но не чаще одного раза за четверть секунды, чтобы серия начислений
  // не превратилась в серию запросов.
  const requestRefresh = useCallback(() => {
    clearTimer("refresh");
    timers.current.refresh = window.setTimeout(() => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ event: "state" }));
      } else {
        void pollOnce();
      }
    }, REFRESH_DEBOUNCE_MS);
  }, [pollOnce]);

  const startPolling = useCallback(() => {
    if (timers.current.poll !== undefined) return;
    void pollOnce();
    timers.current.poll = window.setInterval(() => void pollOnce(), POLL_MS);
  }, [pollOnce]);

  const stopPolling = useCallback(() => clearTimer("poll"), []);

  const connect = useCallback(() => {
    if (!token) return;
    clearTimer("reconnect");

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl(token));
    } catch {
      startPolling();
      timers.current.reconnect = window.setTimeout(connect, RECONNECT_MS);
      return;
    }
    socketRef.current = socket;
    setStatus((current) => (current === "live" ? current : "connecting"));

    socket.onopen = () => {
      setStatus("live");
      stopPolling();
      clearTimer("ping");
      timers.current.ping = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ event: "ping" }));
        }
      }, PING_MS);
    };

    socket.onmessage = (raw) => {
      let message: GuildEvent;
      try {
        message = JSON.parse(raw.data as string) as GuildEvent;
      } catch {
        return;
      }
      setLastUpdate(Date.now());

      switch (message.event) {
        case "state":
          applyState(message.payload);
          break;
        case "souls_updated":
        case "armor_changed":
          setTree(message.payload.tree);
          requestRefresh();
          break;
        case "debuff_applied":
          if (message.payload.tree) setTree(message.payload.tree);
          requestRefresh();
          break;
        case "festival_ready":
          requestRefresh();
          break;
        default:
          break;
      }
      handler.current?.(message);
    };

    const drop = () => {
      clearTimer("ping");
      if (socketRef.current === socket) socketRef.current = null;
      if (closedByUs.current) return;
      startPolling();
      clearTimer("reconnect");
      timers.current.reconnect = window.setTimeout(connect, RECONNECT_MS);
    };

    socket.onclose = drop;
    socket.onerror = () => socket.close();
  }, [token, applyState, requestRefresh, startPolling, stopPolling]);

  useEffect(() => {
    if (!token) {
      setState(null);
      setTree(null);
      setStatus("offline");
      return undefined;
    }
    closedByUs.current = false;
    connect();
    // Первый снимок берём сразу через REST: экран не должен ждать рукопожатия.
    void pollOnce();

    const wake = () => {
      if (document.visibilityState === "visible" && socketRef.current === null) connect();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      closedByUs.current = true;
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      (["reconnect", "poll", "ping", "refresh"] as const).forEach(clearTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [token, connect, pollOnce]);

  return { state, tree, status, lastUpdate, refresh: requestRefresh };
}
