import { useEffect, useState } from "react";

/** Событие, которым Chrome предлагает установку. В lib.dom его пока нет. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

function announce(available: boolean) {
  listeners.forEach((fn) => fn(available));
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Гасим системную плашку, чтобы предложить установку своей кнопкой
    // в нужный момент — иначе Chrome покажет её один раз и забудет.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    announce(true);
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    announce(false);
  });
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferred) return "unavailable";
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  if (outcome === "accepted") {
    deferred = null;
    announce(false);
  }
  return outcome;
}

export function useInstallPrompt() {
  const [available, setAvailable] = useState(deferred !== null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    const listener = (next: boolean) => {
      setAvailable(next);
      setInstalled(isStandalone());
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    available,
    installed,
    // На iOS нет beforeinstallprompt — там установка только через «Поделиться».
    manualIos: isIos() && !isStandalone(),
    install: promptInstall,
  };
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Без HTTPS (кроме localhost) регистрация невозможна — приложение
      // продолжает работать как обычный сайт.
    });
  });
}
