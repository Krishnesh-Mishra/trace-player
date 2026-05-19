import { useEffect, useState, useCallback } from "react";
import { Store } from "@tauri-apps/plugin-store";

export type ThemeChoice =
  | "dark-translucent"
  | "dark-solid"
  | "light-translucent"
  | "light-solid"
  | "system-translucent"
  | "system-default";

export const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system-translucent", label: "System Translucent" },
  { value: "system-default", label: "System Default" },
  { value: "light-translucent", label: "Light Translucent" },
  { value: "light-solid", label: "Light" },
  { value: "dark-translucent", label: "Dark Translucent" },
  { value: "dark-solid", label: "Dark" },
];

type ConcreteTheme = "dark-translucent" | "dark-solid" | "light-translucent" | "light-solid";

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(choice: ThemeChoice): ConcreteTheme {
  switch (choice) {
    case "system-translucent":
      return prefersDark() ? "dark-translucent" : "light-translucent";
    case "system-default":
      return prefersDark() ? "dark-solid" : "light-solid";
    default:
      return choice;
  }
}

function applyToDOM(concrete: ConcreteTheme) {
  const html = document.documentElement;
  const isDark = concrete.startsWith("dark");
  html.className = isDark ? "dark" : "light";
  html.dataset.theme = concrete;
}

export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>("dark-translucent");
  const [resolved, setResolved] = useState<ConcreteTheme>("dark-translucent");

  useEffect(() => {
    Store.load("trace-player-settings.json")
      .then((s) => s.get<ThemeChoice>("theme"))
      .then((v) => {
        if (v && typeof v === "string") {
          setChoiceState(v);
          const c = resolve(v);
          setResolved(c);
          applyToDOM(c);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const concrete = resolve(choice);
    setResolved(concrete);
    applyToDOM(concrete);

    if (!choice.startsWith("system")) return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const c = resolve(choice);
      setResolved(c);
      applyToDOM(c);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [choice]);

  const setTheme = useCallback((t: ThemeChoice) => {
    setChoiceState(t);
    Store.load("trace-player-settings.json")
      .then((s) => s.set("theme", t).then(() => s.save()))
      .catch(() => {});
  }, []);

  return { theme: choice, setTheme, resolvedTheme: resolved };
}
