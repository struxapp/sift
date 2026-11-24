// Stroke icons on a 24px grid; shapes adapted from Lucide (ISC licence).
const svg = (body: string): string =>
  `<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons: Record<string, string> = {
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>'),
  folder: svg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  clipboard: svg('<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
  play: svg('<path d="M6 4v16l14-8Z"/>'),
  stop: svg('<rect width="14" height="14" x="5" y="5" rx="2"/>'),
  download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>'),
  moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  table: svg('<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>'),
  insert: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
};

export const logo = `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="#1b1d22"/><path d="M7 9.5h18M10 15h12M13 20.5h6" stroke="#f5f3ee" stroke-width="2.4" stroke-linecap="round"/><circle cx="16" cy="25.2" r="1.9" fill="#f2b33d"/></svg>`;

export function fillIcons(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const icon = icons[element.dataset.icon ?? ""];
    if (icon && !element.firstChild) element.innerHTML = icon;
  }
}
