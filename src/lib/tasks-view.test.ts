import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  boardColumns,
  DEFAULT_FILTERS,
  dropNeighbours,
  groupByStatus,
  parseFilters,
  parseView,
  type PanelTask,
} from "./tasks-view";

function task(overrides: Partial<PanelTask> & { id: string }): PanelTask {
  return {
    key: `ME-${overrides.id}`,
    title: `Task ${overrides.id}`,
    status: "todo",
    priority: "none",
    dueDate: null,
    projectId: "p1",
    projectPrefix: "ME",
    pinned: false,
    labels: [],
    agentsWorking: 0,
    updatedAt: "2026-09-14T10:00:00.000Z",
    ...overrides,
  };
}

describe("parseFilters", () => {
  it("falls back to all tasks for garbage", () => {
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters("nope")).toEqual(DEFAULT_FILTERS);
    expect(parseFilters({ statuses: ["bogus", "done", "done"], sort: "weird", projectId: "" })).toEqual({
      ...DEFAULT_FILTERS,
      statuses: ["done"],
    });
  });
  it("keeps an explicit empty status list", () => {
    expect(parseFilters({ statuses: [] }).statuses).toEqual([]);
  });
  it("parses views", () => {
    expect(parseView("board")).toBe("board");
    expect(parseView(42)).toBe("list");
  });
});

describe("activeFilterCount", () => {
  it("ignores search and sort", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, search: "x", sort: "due" })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, statuses: ["done"], labels: ["home"], projectId: "p" })).toBe(3);
    // Same statuses in a different order is still the default.
    expect(activeFilterCount({ ...DEFAULT_FILTERS, statuses: [] })).toBe(0);
  });
});

describe("grouping", () => {
  const tasks = [
    task({ id: "1", status: "done" }),
    task({ id: "2", status: "backlog" }),
    task({ id: "3", status: "todo" }),
    task({ id: "4", status: "todo" }),
  ];
  it("groups by status in canonical order and drops empties", () => {
    expect(groupByStatus(tasks).map((group) => [group.status, group.tasks.length])).toEqual([
      ["done", 1],
      ["todo", 2],
      ["backlog", 1],
    ]);
  });
  it("keeps the five main board columns and hides canceled when empty", () => {
    expect(boardColumns(tasks).map((column) => column.status)).toEqual(["backlog", "todo", "in_progress", "in_review", "done"]);
    expect(boardColumns([...tasks, task({ id: "5", status: "canceled" })]).map((column) => column.status)).toContain("canceled");
  });
});

describe("dropNeighbours", () => {
  it("excludes the moving task and clamps the index", () => {
    expect(dropNeighbours(["a", "b", "c"], "b", 0)).toEqual({ beforeTaskId: null, afterTaskId: "a" });
    expect(dropNeighbours(["a", "b", "c"], "b", 2)).toEqual({ beforeTaskId: "c", afterTaskId: null });
    expect(dropNeighbours(["a", "b", "c"], "x", 1)).toEqual({ beforeTaskId: "a", afterTaskId: "b" });
    expect(dropNeighbours([], "x", 5)).toEqual({ beforeTaskId: null, afterTaskId: null });
  });
});
