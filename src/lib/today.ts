// Pure grouping logic for the Linear Panel. No bb imports so it unit-tests in
// plain node and both server.ts and app.tsx can share the types.

export const PIN_LABEL = "today";
export const OPEN_STATUSES = ["backlog", "todo", "in_progress", "in_review"] as const;

export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export type TaskPriority = "urgent" | "high" | "medium" | "low" | "none";

/** The subset of a Tasks-plugin task the rail cares about. */
export interface SourceTask {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  updatedAt: string;
  labelIds: string[];
}

export interface TaskRow {
  id: string;
  key: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  pinned: boolean;
  /** Whole days since the task was first seen pinned; 0 on the day it was pinned. */
  pinnedDays: number;
  labels: string[];
}

export interface TodayView {
  /** The local calendar date the view was built for, YYYY-MM-DD. */
  today: string;
  overdue: TaskRow[];
  dueToday: TaskRow[];
  /** Pinned but not overdue or due today (those sections win). */
  pinned: TaskRow[];
  doneToday: TaskRow[];
}

/** YYYY-MM-DD in the machine's local timezone (Tasks due dates are calendar dates). */
export function localDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(dateString: string, days: number): string {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(y!, m! - 1, d! + days);
  return localDateString(date);
}

function daysBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const from = Date.UTC(fy!, fm! - 1, fd!);
  const to = Date.UTC(ty!, tm! - 1, td!);
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

function byDueThenPriority(a: TaskRow, b: TaskRow): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

export interface GroupInput {
  openTasks: SourceTask[];
  doneTasks: SourceTask[];
  /** label id → name */
  labelNames: Map<string, string>;
  pinLabelId: string | null;
  today: string;
  /** task id → YYYY-MM-DD first seen pinned */
  pinnedAt: Record<string, string>;
}

export function groupToday(input: GroupInput): { view: TodayView; nextPinnedAt: Record<string, string> } {
  const { openTasks, doneTasks, labelNames, pinLabelId, today, pinnedAt } = input;
  const nextPinnedAt: Record<string, string> = {};

  const toRow = (task: SourceTask): TaskRow => {
    const pinned = pinLabelId !== null && task.labelIds.includes(pinLabelId);
    let pinnedDays = 0;
    if (pinned) {
      const since = pinnedAt[task.id] ?? today;
      nextPinnedAt[task.id] = since;
      pinnedDays = daysBetween(since, today);
    }
    return {
      id: task.id,
      key: task.key,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      pinned,
      pinnedDays,
      labels: task.labelIds.map((id) => labelNames.get(id) ?? id).filter((name) => name !== PIN_LABEL),
    };
  };

  const overdue: TaskRow[] = [];
  const dueToday: TaskRow[] = [];
  const pinned: TaskRow[] = [];
  for (const task of openTasks) {
    const row = toRow(task);
    if (row.dueDate !== null && row.dueDate < today) overdue.push(row);
    else if (row.dueDate === today) dueToday.push(row);
    else if (row.pinned) pinned.push(row);
  }
  overdue.sort(byDueThenPriority);
  dueToday.sort(byDueThenPriority);
  pinned.sort((a, b) => b.pinnedDays - a.pinnedDays || byDueThenPriority(a, b));

  const doneToday = doneTasks
    .filter((task) => localDateString(new Date(task.updatedAt)) === today)
    .map(toRow)
    .sort((a, b) => a.key.localeCompare(b.key));

  // A pin that was completed today keeps its date so "undo" restores the count;
  // anything else that is no longer pinned falls out of the map.
  for (const row of doneToday) {
    if (row.pinned && pinnedAt[row.id] !== undefined) nextPinnedAt[row.id] = pinnedAt[row.id]!;
  }

  return { view: { today, overdue, dueToday, pinned, doneToday }, nextPinnedAt };
}
