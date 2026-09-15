// Pure mapping between Linear's model and the panel's status/priority enums.
// No bb imports so it unit-tests in plain node.
import type { TaskPriority, TaskStatus } from "./today";

/** Linear workflow state types. */
export type LinearStateType = "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";

export interface LinearStateLike {
  id: string;
  name: string;
  type: string;
  position?: number;
}

/** Linear priority numbers: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export function priorityFromLinear(priority: number | null | undefined): TaskPriority {
  switch (priority) {
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "medium";
    case 4:
      return "low";
    default:
      return "none";
  }
}

export function priorityToLinear(priority: TaskPriority): number {
  return { urgent: 1, high: 2, medium: 3, low: 4, none: 0 }[priority];
}

/** A started state whose name mentions review counts as "in review". */
export function statusFromLinearState(state: Pick<LinearStateLike, "name" | "type">): TaskStatus {
  switch (state.type) {
    case "triage":
    case "backlog":
      return "backlog";
    case "unstarted":
      return "todo";
    case "started":
      return /review|qa|testing/i.test(state.name) ? "in_review" : "in_progress";
    case "completed":
      return "done";
    case "canceled":
      return "canceled";
    default:
      return "todo";
  }
}

/**
 * Pick the workflow state a panel status should move an issue to, within one
 * team's states. Prefers the lowest-position state of the matching type, and
 * for in_review a started state named like review; falls back to in_progress.
 */
export function stateForStatus(states: LinearStateLike[], status: TaskStatus): LinearStateLike | null {
  const byPos = [...states].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const first = (predicate: (s: LinearStateLike) => boolean) => byPos.find(predicate) ?? null;
  switch (status) {
    case "backlog":
      return first((s) => s.type === "backlog") ?? first((s) => s.type === "triage");
    case "todo":
      return first((s) => s.type === "unstarted");
    case "in_progress":
      return first((s) => s.type === "started" && !/review|qa|testing/i.test(s.name)) ?? first((s) => s.type === "started");
    case "in_review":
      return first((s) => s.type === "started" && /review|qa|testing/i.test(s.name)) ?? first((s) => s.type === "started");
    case "done":
      return first((s) => s.type === "completed");
    case "canceled":
      return first((s) => s.type === "canceled");
  }
}

/** Linear dueDate is already YYYY-MM-DD; guard against full timestamps anyway. */
export function dueDateFromLinear(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length >= 10 ? value.slice(0, 10) : null;
}
