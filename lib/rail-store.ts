// Window-local rail state shared by the overlay, the keyboard shortcuts, the
// palette commands, and the sidebar footer button. Layout preferences persist
// in localStorage; every access is guarded because localStorage throws for
// reasons unrelated to us (private mode, quota, disabled origin).
import { useSyncExternalStore } from "react";
import { DEFAULT_FILTERS, parseFilters, parseView, type TaskFilters, type TaskView } from "./tasks-view";

export interface RailState {
  open: boolean;
  /** Rail width in px. */
  width: number;
  /** Fraction of the rail height given to the top (today) pane. */
  split: number;
  /** Bumped whenever the inbox composer should take focus. */
  focusRequest: number;
  /** List or board rendering of the task pane. */
  view: TaskView;
  filters: TaskFilters;
}

const PREFIX = "bb-today-rail:v1";
const OPEN_KEY = `${PREFIX}:open`;
const WIDTH_KEY = `${PREFIX}:width`;
const SPLIT_KEY = `${PREFIX}:split`;
const VIEW_KEY = `${PREFIX}:view`;
// Start the all-issues view without filters saved by the earlier rail.
const FILTERS_KEY = `${PREFIX}:filters:all-issues-v2`;

export const RAIL_MIN_WIDTH = 280;
export const RAIL_MAX_WIDTH = 960;
export const RAIL_DEFAULT_WIDTH = 340;
export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;

function read<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Losing a preference is acceptable; throwing inside the overlay is not.
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const parseNumber = (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

let state: RailState = {
  open: read(OPEN_KEY, true, (raw) => raw === "true"),
  width: clamp(read(WIDTH_KEY, RAIL_DEFAULT_WIDTH, parseNumber), RAIL_MIN_WIDTH, RAIL_MAX_WIDTH),
  split: clamp(read(SPLIT_KEY, 0.55, parseNumber), SPLIT_MIN, SPLIT_MAX),
  focusRequest: 0,
  view: read(VIEW_KEY, "list", (raw) => parseView(raw)),
  filters: read(FILTERS_KEY, { ...DEFAULT_FILTERS }, (raw) => {
    try {
      return parseFilters(JSON.parse(raw));
    } catch {
      return null;
    }
  }),
};
const listeners = new Set<() => void>();

function update(next: Partial<RailState>): void {
  state = { ...state, ...next };
  if (next.open !== undefined) write(OPEN_KEY, String(next.open));
  if (next.width !== undefined) write(WIDTH_KEY, String(next.width));
  if (next.split !== undefined) write(SPLIT_KEY, String(next.split));
  if (next.view !== undefined) write(VIEW_KEY, next.view);
  if (next.filters !== undefined) write(FILTERS_KEY, JSON.stringify(next.filters));
  for (const listener of listeners) listener();
}

export const rail = {
  open(): void {
    update({ open: true });
  },
  close(): void {
    update({ open: false });
  },
  toggle(): void {
    update({ open: !state.open });
  },
  focusInbox(): void {
    update({ open: true, focusRequest: state.focusRequest + 1 });
  },
  setWidth(width: number): void {
    update({ width: clamp(Math.round(width), RAIL_MIN_WIDTH, RAIL_MAX_WIDTH) });
  },
  setSplit(split: number): void {
    update({ split: clamp(split, SPLIT_MIN, SPLIT_MAX) });
  },
  setView(view: TaskView): void {
    update({ view });
  },
  setFilters(patch: Partial<TaskFilters>): void {
    update({ filters: { ...state.filters, ...patch } });
  },
  resetFilters(): void {
    update({ filters: { ...DEFAULT_FILTERS, search: state.filters.search, sort: state.filters.sort } });
  },
  get(): RailState {
    return state;
  },
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRailState(): RailState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

type KeyLike = Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

function hasMod(event: KeyLike, isMac: boolean): boolean {
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** Mod+Shift+T toggles the rail. */
export function isToggleShortcut(event: KeyLike, isMac: boolean): boolean {
  return hasMod(event, isMac) && event.shiftKey && !event.altKey && event.code === "KeyT";
}

/** Mod+Shift+J opens the rail and focuses the inbox composer. */
export function isFocusInboxShortcut(event: KeyLike, isMac: boolean): boolean {
  return hasMod(event, isMac) && event.shiftKey && !event.altKey && event.code === "KeyJ";
}
