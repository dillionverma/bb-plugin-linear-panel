// Pure view logic for the task panel: filter state, persistence shape, and
// grouping helpers. No bb imports so it unit-tests in plain node and both
// server.ts and the app can share the types.
import type { TaskPriority, TaskStatus } from "./today";

export const ALL_STATUSES: readonly TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
];
export const OPEN_STATUSES_LIST: readonly TaskStatus[] = ["backlog", "todo", "in_progress", "in_review"];
export const ALL_PRIORITIES: readonly TaskPriority[] = ["urgent", "high", "medium", "low", "none"];
export const SORTS = ["manual", "priority", "due"] as const;
export type TaskSort = (typeof SORTS)[number];
export const VIEWS = ["list", "board"] as const;
export type TaskView = (typeof VIEWS)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  canceled: "Canceled",
};
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  none: "No priority",
};

export interface TaskFilters {
  /** Tasks project id, or null for every project. */
  projectId: string | null;
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  /** Label names (labels are per project, so names are the portable key). */
  labels: string[];
  search: string;
  sort: TaskSort;
}

export const DEFAULT_FILTERS: TaskFilters = {
  projectId: null,
  statuses: [],
  priorities: [],
  labels: [],
  search: "",
  sort: "manual",
};

function stringArray<T extends string>(value: unknown, allowed?: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of value) {
    if (typeof item !== "string" || seen.has(item)) continue;
    if (allowed !== undefined && !allowed.includes(item as T)) continue;
    seen.add(item);
    out.push(item as T);
  }
  return out;
}

/** Coerce anything read from storage into a valid filter set. */
export function parseFilters(raw: unknown): TaskFilters {
  if (raw === null || typeof raw !== "object") return { ...DEFAULT_FILTERS };
  const value = raw as Record<string, unknown>;
  return {
    projectId: typeof value.projectId === "string" && value.projectId !== "" ? value.projectId : null,
    statuses: Array.isArray(value.statuses) ? stringArray(value.statuses, ALL_STATUSES) : [...DEFAULT_FILTERS.statuses],
    priorities: stringArray(value.priorities, ALL_PRIORITIES),
    labels: stringArray(value.labels),
    search: typeof value.search === "string" ? value.search : "",
    sort: SORTS.includes(value.sort as TaskSort) ? (value.sort as TaskSort) : "manual",
  };
}

export function parseView(raw: unknown): TaskView {
  return VIEWS.includes(raw as TaskView) ? (raw as TaskView) : "list";
}

/** Count of filters that differ from "show all tasks". */
export function activeFilterCount(filters: TaskFilters): number {
  let count = 0;
  if (filters.projectId !== null) count += 1;
  if (!sameSet(filters.statuses, DEFAULT_FILTERS.statuses)) count += 1;
  if (filters.priorities.length > 0) count += 1;
  if (filters.labels.length > 0) count += 1;
  return count;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}

export function toggleIn<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

export interface PanelTask {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  projectId: string;
  projectPrefix: string;
  pinned: boolean;
  labels: string[];
  agentsWorking: number;
  updatedAt: string;
  /** Original issue URL for Linear, or an in-app route for Tasks. */
  href?: string;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

/** Group tasks by status in canonical status order, dropping empty groups. */
export function groupByStatus(tasks: PanelTask[]): Array<{ status: TaskStatus; tasks: PanelTask[] }> {
  const buckets = new Map<TaskStatus, PanelTask[]>();
  for (const status of ALL_STATUSES) buckets.set(status, []);
  for (const task of tasks) buckets.get(task.status)?.push(task);
  const order: TaskStatus[] = ["done", "in_review", "in_progress", "todo", "backlog", "canceled"];
  return order.map((status) => ({ status, tasks: buckets.get(status) ?? [] })).filter(
    (group) => group.tasks.length > 0,
  );
}

/** Board columns: the five main statuses always, canceled only when populated. */
export function boardColumns(tasks: PanelTask[]): Array<{ status: TaskStatus; tasks: PanelTask[] }> {
  const groups = new Map(groupByStatus(tasks).map((group) => [group.status, group.tasks] as const));
  const statuses: TaskStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];
  if ((groups.get("canceled") ?? []).length > 0) statuses.push("canceled");
  return statuses.map((status) => ({ status, tasks: groups.get(status) ?? [] }));
}

/** Where a task lands when dropped at `index` in `columnIds` (excluding itself). */
export function dropNeighbours(
  columnIds: string[],
  taskId: string,
  index: number,
): { beforeTaskId: string | null; afterTaskId: string | null } {
  const rest = columnIds.filter((id) => id !== taskId);
  const at = Math.max(0, Math.min(index, rest.length));
  return { beforeTaskId: rest[at - 1] ?? null, afterTaskId: rest[at] ?? null };
}

export function comparePriority(a: TaskPriority, b: TaskPriority): number {
  return PRIORITY_RANK[a] - PRIORITY_RANK[b];
}
