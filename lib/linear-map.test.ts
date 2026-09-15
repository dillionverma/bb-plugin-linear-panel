import { describe, expect, it } from "vitest";
import { dueDateFromLinear, priorityFromLinear, priorityToLinear, stateForStatus, statusFromLinearState } from "./linear-map";

describe("linear priority", () => {
  it("maps numbers both ways", () => {
    expect(priorityFromLinear(1)).toBe("urgent");
    expect(priorityFromLinear(4)).toBe("low");
    expect(priorityFromLinear(0)).toBe("none");
    expect(priorityFromLinear(null)).toBe("none");
    for (const p of ["urgent", "high", "medium", "low", "none"] as const) {
      expect(priorityFromLinear(priorityToLinear(p))).toBe(p);
    }
  });
});

describe("linear states", () => {
  const states = [
    { id: "s1", name: "Backlog", type: "backlog", position: 0 },
    { id: "s2", name: "Todo", type: "unstarted", position: 1 },
    { id: "s3", name: "In Progress", type: "started", position: 2 },
    { id: "s4", name: "In Review", type: "started", position: 3 },
    { id: "s5", name: "Done", type: "completed", position: 4 },
    { id: "s6", name: "Canceled", type: "canceled", position: 5 },
  ];

  it("maps state types to panel statuses, detecting review states", () => {
    expect(statusFromLinearState(states[0]!)).toBe("backlog");
    expect(statusFromLinearState(states[1]!)).toBe("todo");
    expect(statusFromLinearState(states[2]!)).toBe("in_progress");
    expect(statusFromLinearState(states[3]!)).toBe("in_review");
    expect(statusFromLinearState(states[4]!)).toBe("done");
    expect(statusFromLinearState({ name: "Triage", type: "triage" })).toBe("backlog");
  });

  it("picks a target state for each panel status", () => {
    expect(stateForStatus(states, "in_progress")?.id).toBe("s3");
    expect(stateForStatus(states, "in_review")?.id).toBe("s4");
    expect(stateForStatus(states, "done")?.id).toBe("s5");
    expect(stateForStatus(states, "todo")?.id).toBe("s2");
  });

  it("falls back to any started state when no review state exists", () => {
    const noReview = states.filter((s) => s.id !== "s4");
    expect(stateForStatus(noReview, "in_review")?.id).toBe("s3");
  });
});

describe("due dates", () => {
  it("normalises to YYYY-MM-DD", () => {
    expect(dueDateFromLinear("2026-09-15")).toBe("2026-09-15");
    expect(dueDateFromLinear("2026-09-15T00:00:00.000Z")).toBe("2026-09-15");
    expect(dueDateFromLinear(null)).toBeNull();
  });
});
