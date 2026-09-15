// Top pane: the complete task list from the Tasks plugin, filtered by the
// toolbar, rendered as a grouped list or a status board.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { PanelData, rpcContract } from "../server";
import type { RailState } from "@/lib/rail-store";
import type { PanelTask, TaskFilters as Filters } from "@/lib/tasks-view";
import { addDays, localDateString } from "@/lib/today";
import { TaskBoard, type BoardMove } from "./TaskBoard";
import { TaskFilters } from "./TaskFilters";
import { TaskList } from "./TaskList";
import type { TaskActions } from "./TaskRow";

const TODAY_CHANGED = "today-changed";
const POLL_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function usePanel(filters: Filters) {
  const rpc = useRpc<typeof rpcContract>();
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const latest = useRef(filters);
  latest.current = filters;

  const refetch = useCallback(() => {
    const mine = ++seq.current;
    rpc.call("tasks_list", latest.current).then(
      (result) => {
        if (mine !== seq.current) return;
        setPanel(result);
        setError(null);
      },
      (cause: unknown) => {
        if (mine !== seq.current) return;
        setError(errorMessage(cause));
      },
    );
  }, [rpc]);

  // Refetch when filters change; debounce typing in the search box.
  const key = JSON.stringify(filters);
  useEffect(() => {
    const timer = window.setTimeout(refetch, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [key, refetch]);
  useRealtime(TODAY_CHANGED, refetch);

  // Tasks' own change signals are scoped to its plugin, so poll lightly while
  // the window is visible and refetch when it regains focus.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refetch();
    }, POLL_MS);
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch]);

  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (previous.current !== "connected" && connection === "connected") refetch();
    previous.current = connection;
  }, [connection, refetch]);

  return { rpc, panel, setPanel, error, refetch };
}

export function TaskPanel({ state }: { state: RailState }) {
  const { rpc, panel, setPanel, error, refetch } = usePanel(state.filters);
  const today = panel?.today ?? localDateString(new Date());

  const run = (label: string, call: Promise<{ ok: boolean }>) => {
    call.then(
      (result) => {
        if (!result.ok) toast.error(`${label}: Tasks rejected the change`);
        refetch();
      },
      (cause: unknown) => {
        toast.error(`${label}: ${errorMessage(cause)}`);
        refetch();
      },
    );
  };
  /** Apply a change locally first so the row moves without waiting on the round trip. */
  const patch = (taskId: string, changes: Partial<PanelTask>) =>
    setPanel((prev) =>
      prev === null ? prev : { ...prev, tasks: prev.tasks.map((task) => (task.id === taskId ? { ...task, ...changes } : task)) },
    );

  const actionsFor = (task: PanelTask): TaskActions => ({
    onStatus: (status) => {
      patch(task.id, { status });
      run("Status", rpc.call("tasks_setStatus", { taskId: task.id, status }));
    },
    onPriority: (priority) => {
      patch(task.id, { priority });
      run("Priority", rpc.call("tasks_setPriority", { taskId: task.id, priority }));
    },
    onPin: (pinned) => {
      patch(task.id, { pinned });
      run("Pin", rpc.call("today_setPinned", { taskId: task.id, pinned }));
    },
    onTomorrow: () => {
      const dueDate = addDays(today, 1);
      patch(task.id, { dueDate });
      run("Reschedule", rpc.call("today_setDue", { taskId: task.id, dueDate }));
    },
    onUnschedule: () => {
      patch(task.id, { dueDate: null });
      run("Unschedule", rpc.call("today_setDue", { taskId: task.id, dueDate: null }));
    },
  });

  const onMove = (move: BoardMove) => {
    setPanel((prev) => {
      if (prev === null) return prev;
      const moving = prev.tasks.find((task) => task.id === move.taskId);
      if (moving === undefined) return prev;
      const rest = prev.tasks.filter((task) => task.id !== move.taskId);
      const updated = { ...moving, status: move.status };
      // Insert relative to its new neighbours so the board reflects the drop
      // before the server confirms.
      const afterIndex = move.afterTaskId === null ? -1 : rest.findIndex((task) => task.id === move.afterTaskId);
      const beforeIndex = move.beforeTaskId === null ? -1 : rest.findIndex((task) => task.id === move.beforeTaskId);
      const at = afterIndex >= 0 ? afterIndex : beforeIndex >= 0 ? beforeIndex + 1 : rest.length;
      return { ...prev, tasks: [...rest.slice(0, at), updated, ...rest.slice(at)] };
    });
    run("Move", rpc.call("tasks_boardMove", move));
  };

  if (error !== null) {
    return (
      <div className="flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm">
        <p role="alert" className="text-destructive">
          {error}
        </p>
        <p className="text-xs text-muted-foreground">
          The rail reads Linear (set an API key with <code>bb plugin config linear set apiKey</code> and bind a team with{" "}
          <code>bb linear bind &lt;TEAM&gt;</code>) or the Tasks plugin, per the Task source setting.
        </p>
        <button type="button" className="self-start text-xs underline" onClick={refetch}>
          Retry
        </button>
      </div>
    );
  }

  const showProject = state.filters.projectId === null && (panel?.projects.length ?? 0) > 1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TaskFilters
        filters={state.filters}
        view={state.view}
        source={panel?.source ?? "tasks"}
        projects={panel?.projects ?? []}
        labels={panel?.labels ?? []}
        count={panel?.tasks.length ?? null}
      />
      <div className="min-h-0 flex-1">
        {panel === null ? (
          <p className="p-3 text-sm text-muted-foreground">Loading…</p>
        ) : panel.tasks.length === 0 && state.view === "list" ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            No tasks match. Jot something below to file a task, or loosen the filters.
          </p>
        ) : state.view === "board" ? (
          <TaskBoard tasks={panel.tasks} today={today} showProject={showProject} actionsFor={actionsFor} onMove={onMove} />
        ) : (
          <TaskList tasks={panel.tasks} today={today} showProject={showProject} actionsFor={actionsFor} />
        )}
      </div>
    </div>
  );
}
