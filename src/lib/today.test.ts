import { describe, expect, it } from "vitest";
import { addDays, groupToday, localDateString, type SourceTask } from "./today";

const PIN = "lbl_today";
const labels = new Map([
  [PIN, "today"],
  ["lbl_home", "home"],
]);

function task(overrides: Partial<SourceTask> & { id: string }): SourceTask {
  return {
    key: overrides.id.toUpperCase(),
    title: `Task ${overrides.id}`,
    status: "todo",
    priority: "none",
    dueDate: null,
    updatedAt: "2026-09-14T10:00:00.000Z",
    labelIds: [],
    ...overrides,
  };
}

describe("groupToday", () => {
  const today = "2026-09-14";

  it("splits open tasks into overdue, due today, and pinned", () => {
    const { view } = groupToday({
      openTasks: [
        task({ id: "a", dueDate: "2026-09-10" }),
        task({ id: "b", dueDate: today }),
        task({ id: "c", labelIds: [PIN] }),
        task({ id: "d", dueDate: "2026-09-20" }),
        task({ id: "e" }),
      ],
      doneTasks: [],
      labelNames: labels,
      pinLabelId: PIN,
      today,
      pinnedAt: {},
    });
    expect(view.overdue.map((r) => r.id)).toEqual(["a"]);
    expect(view.dueToday.map((r) => r.id)).toEqual(["b"]);
    expect(view.pinned.map((r) => r.id)).toEqual(["c"]);
  });

  it("a pinned task that is also due today shows under due today, not twice", () => {
    const { view } = groupToday({
      openTasks: [task({ id: "a", dueDate: today, labelIds: [PIN] })],
      doneTasks: [],
      labelNames: labels,
      pinLabelId: PIN,
      today,
      pinnedAt: {},
    });
    expect(view.dueToday).toHaveLength(1);
    expect(view.dueToday[0]!.pinned).toBe(true);
    expect(view.pinned).toHaveLength(0);
  });

  it("records first-seen pin dates and counts carried-over days", () => {
    const first = groupToday({
      openTasks: [task({ id: "a", labelIds: [PIN] })],
      doneTasks: [],
      labelNames: labels,
      pinLabelId: PIN,
      today: "2026-09-11",
      pinnedAt: {},
    });
    expect(first.nextPinnedAt).toEqual({ a: "2026-09-11" });
    expect(first.view.pinned[0]!.pinnedDays).toBe(0);

    const later = groupToday({
      openTasks: [task({ id: "a", labelIds: [PIN] })],
      doneTasks: [],
      labelNames: labels,
      pinLabelId: PIN,
      today,
      pinnedAt: first.nextPinnedAt,
    });
    expect(later.view.pinned[0]!.pinnedDays).toBe(3);
  });

  it("drops unpinned tasks from the pin map", () => {
    const { nextPinnedAt } = groupToday({
      openTasks: [task({ id: "a" })],
      doneTasks: [],
      labelNames: labels,
      pinLabelId: PIN,
      today,
      pinnedAt: { a: "2026-09-01" },
    });
    expect(nextPinnedAt).toEqual({});
  });

  it("only lists done tasks completed today", () => {
    const todayNoon = new Date(`${today}T12:00:00`).toISOString();
    const { view } = groupToday({
      openTasks: [],
      doneTasks: [
        task({ id: "old", status: "done", updatedAt: "2026-09-01T12:00:00.000Z" }),
        task({ id: "new", status: "done", updatedAt: todayNoon }),
      ],
      labelNames: labels,
      pinLabelId: PIN,
      today,
      pinnedAt: {},
    });
    expect(view.doneToday.map((r) => r.id)).toEqual(["new"]);
  });

  it("hides the pin label from the label chips", () => {
    const { view } = groupToday({
      openTasks: [task({ id: "a", labelIds: [PIN, "lbl_home"] })],
      doneTasks: [],
      labelNames: labels,
      pinLabelId: PIN,
      today,
      pinnedAt: {},
    });
    expect(view.pinned[0]!.labels).toEqual(["home"]);
  });

  it("sorts overdue by due date then priority, pinned by age", () => {
    const { view } = groupToday({
      openTasks: [
        task({ id: "late-low", dueDate: "2026-09-12", priority: "low" }),
        task({ id: "later-high", dueDate: "2026-09-12", priority: "high" }),
        task({ id: "oldest", dueDate: "2026-09-01" }),
        task({ id: "p-new", labelIds: [PIN] }),
        task({ id: "p-old", labelIds: [PIN] }),
      ],
      doneTasks: [],
      labelNames: labels,
      pinLabelId: PIN,
      today,
      pinnedAt: { "p-old": "2026-09-10" },
    });
    expect(view.overdue.map((r) => r.id)).toEqual(["oldest", "later-high", "late-low"]);
    expect(view.pinned.map((r) => r.id)).toEqual(["p-old", "p-new"]);
  });
});

describe("dates", () => {
  it("formats local dates and adds days across month ends", () => {
    expect(localDateString(new Date(2026, 8, 14))).toBe("2026-09-14");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});
