export type Theme = "light" | "dark";

const KEY = "sift:theme";

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(value: string): void {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Storage may be blocked; the toggle still works for this visit.
  }
}

export function currentTheme(): Theme {
  const forced = document.documentElement.dataset.theme;
  if (forced === "light" || forced === "dark") return forced;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function initTheme(onChange: (theme: Theme) => void): () => void {
  const stored = read();
  if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => onChange(currentTheme()));
  onChange(currentTheme());
  return () => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    write(next);
    onChange(next);
  };
}
