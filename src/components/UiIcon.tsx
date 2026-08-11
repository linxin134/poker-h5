import type { ReactNode } from "react";

export type UiIconName = "back" | "cards" | "chat" | "chips" | "close" | "history" | "leave" | "menu" | "plus" | "rules" | "send" | "settings" | "shield" | "smile" | "stats" | "user";

export function UiIcon({ name, className = "" }: { name: UiIconName; className?: string }) {
  const paths: Record<UiIconName, ReactNode> = {
    back: <path d="m15 5-7 7 7 7" />,
    cards: <><rect x="5" y="4" width="11" height="15" rx="2" /><path d="m9 8 3-2 3 2-3 2-3-2ZM16 7l3 .8v10.7" /></>,
    chat: <><path d="M5 5.5h14v10H9l-4 3v-13Z" /><path d="M8 9h8M8 12h5" /></>,
    chips: <><ellipse cx="12" cy="6.5" rx="7" ry="3" /><path d="M5 6.5v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4M5 10.5v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    history: <><path d="M4 8V4m0 0h4M4.8 4.8A8 8 0 1 1 4 14" /><path d="M12 8v5l3 2" /></>,
    leave: <><path d="M10 5H5v14h5M13 8l4 4-4 4M8 12h9" /></>,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    plus: <path d="M12 5v14M5 12h14" />,
    rules: <path d="M5 5.5c2.7-.9 5-.4 7 1.2v12c-2-1.6-4.3-2.1-7-1.2v-12ZM19 5.5c-2.7-.9-5-.4-7 1.2v12c2-1.6 4.3-2.1 7-1.2v-12Z" />,
    send: <path d="m4 5 16 7-16 7 3-7-3-7Zm3 7h8" />,
    settings: <><path d="M4 7h10M18 7h2M4 17h2M10 17h10M8 4v6M8 14v6M16 4v6M16 14v6" /></>,
    shield: <path d="M12 3.5 19 6v5.5c0 4.1-2.8 7.1-7 9-4.2-1.9-7-4.9-7-9V6l7-2.5Zm-3 8.5 2 2 4-4" />,
    smile: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 10h.01M15.5 10h.01M8.5 14c1.8 2 5.2 2 7 0" /></>,
    stats: <path d="M5 19V11h3v8H5ZM10.5 19V5h3v14h-3ZM16 19V8h3v11h-3Z" />,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 19c.7-3.4 3-5.2 6.5-5.2s5.8 1.8 6.5 5.2" /></>
  };
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
