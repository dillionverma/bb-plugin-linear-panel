// bb-plugin-today-rail — backend.
//
// The rail composes three things that already exist in bb:
//   - the builtin Tasks plugin (storage, statuses, due dates, labels) reached
//     through cross-plugin RPC (`bb.sdk.plugins.callRpc`), never a subprocess;
//   - a general-purpose chat in the personal workspace, rendered with the
//     host ThreadChat component. No task-specific agent instructions are added.
//
// Plugin-owned state is tiny and lives in bb.storage.kv: the inbox thread id
// and the date each task was first seen pinned (for the "3d" carry-over chip).
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { buildHandoffInput, DEFAULT_MESSAGE } from "./lib/handoff";
import {
  groupToday,
  localDateString,
  OPEN_STATUSES,
  PIN_LABEL,
  type TaskRow,
  type TodayView,
} from "./lib/today";
import { ALL_PRIORITIES, ALL_STATUSES, SORTS, type PanelTask } from "./lib/tasks-view";
import { createLinearSource, type LinearIssue } from "./lib/linear-source.server";

export const SOURCES = ["linear", "tasks"] as const;
export type Source = (typeof SOURCES)[number];

// ---------------------------------------------------------------------------
// Tasks plugin wire shapes (mirrors builtin-plugins/tasks/dist/server.js).
// Kept loose (`passthrough`) so a Tasks upgrade adding fields does not break us.
// ---------------------------------------------------------------------------
const TASKS_PLUGIN_ID = "tasks";

export const taskStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]);
export const taskPrioritySchema = z.enum(["urgent", "high", "medium", "low", "none"]);

const tasksTaskSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    key: z.string(),
    title: z.string(),
    description: z.string(),
    status: taskStatusSchema,
    priority: taskPrioritySchema,
    dueDate: z.string().nullable(),
    parentTaskId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    labelIds: z.array(z.string()),
  })
  .loose();
type TasksTask = z.infer<typeof tasksTaskSchema>;

const tasksLabelSchema = z
  .object({ id: z.string(), projectId: z.string(), name: z.string(), color: z.string() })
  .loose();
const tasksProjectSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    prefix: z.string(),
    linkedBbProjectId: z.string().nullable(),
  })
  .loose();

const listTasksOutput = z.object({ tasks: z.array(tasksTaskSchema), nextCursor: z.string().nullable() });
const listLabelsOutput = z.object({ labels: z.array(tasksLabelSchema) });
const listProjectsOutput = z.object({ projects: z.array(tasksProjectSchema) });
const mutationOutput = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), task: tasksTaskSchema }),
  z.object({ ok: z.literal(false), error: z.unknown() }),
]);
const labelMutationOutput = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), label: tasksLabelSchema }),
  z.object({ ok: z.literal(false), error: z.unknown() }),
]);
const taskByKeyOutput = z.object({ task: tasksTaskSchema.nullable() });

// ---------------------------------------------------------------------------
// This plugin's RPC contract (app.tsx imports the type only).
// ---------------------------------------------------------------------------
const taskRowSchema: z.ZodType<TaskRow> = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueDate: z.string().nullable(),
  pinned: z.boolean(),
  pinnedDays: z.number().int().nonnegative(),
  labels: z.array(z.string()),
});
const todayViewSchema: z.ZodType<TodayView> = z.object({
  today: z.string(),
  overdue: z.array(taskRowSchema),
  dueToday: z.array(taskRowSchema),
  pinned: z.array(taskRowSchema),
  doneToday: z.array(taskRowSchema),
});
const panelTaskSchema: z.ZodType<PanelTask> = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueDate: z.string().nullable(),
  projectId: z.string(),
  projectPrefix: z.string(),
  pinned: z.boolean(),
  labels: z.array(z.string()),
  agentsWorking: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
const panelProjectSchema = z.object({ id: z.string(), name: z.string(), prefix: z.string() });
const panelLabelSchema = z.object({ id: z.string(), projectId: z.string(), name: z.string(), color: z.string() });
export type PanelProject = z.infer<typeof panelProjectSchema>;
export type PanelLabel = z.infer<typeof panelLabelSchema>;
export type { TaskRow, TodayView, PanelTask };

const chatSelectionSchema = z.object({
  providerId: z.string().trim().min(1),
  model: z.string().trim().min(1),
  reasoningLevel: z.enum(["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"]),
  serviceTier: z.enum(["default", "fast"]).optional(),
});

export const rpcContract = defineRpcContract({
  chat_defaults: {
    input: z.null(),
    output: z.object({ selection: chatSelectionSchema, hostId: z.string().nullable() }),
  },
  chat_setDefaults: {
    input: chatSelectionSchema,
    output: z.object({ ok: z.boolean() }),
  },
  today_list: {
    input: z.null(),
    output: z.object({ view: todayViewSchema, trackerPrefix: z.string() }),
  },
  /** The full task list with server-side filters; `projectId: null` spans every Tasks project. */
  tasks_list: {
    input: z.object({
      projectId: z.string().nullable(),
      statuses: z.array(taskStatusSchema),
      priorities: z.array(taskPrioritySchema),
      labels: z.array(z.string()),
      search: z.string(),
      sort: z.enum(SORTS),
    }),
    output: z.object({
      source: z.enum(SOURCES),
      today: z.string(),
      tasks: z.array(panelTaskSchema),
      projects: z.array(panelProjectSchema),
      labels: z.array(panelLabelSchema),
    }),
  },
  tasks_setStatus: {
    input: z.object({ taskId: z.string(), status: taskStatusSchema }),
    output: z.object({ ok: z.boolean() }),
  },
  tasks_setPriority: {
    input: z.object({ taskId: z.string(), priority: taskPrioritySchema }),
    output: z.object({ ok: z.boolean() }),
  },
  /** Move a card on the board: new status plus its neighbours in the target column. */
  tasks_boardMove: {
    input: z.object({
      taskId: z.string(),
      status: taskStatusSchema,
      beforeTaskId: z.string().nullable(),
      afterTaskId: z.string().nullable(),
    }),
    output: z.object({ ok: z.boolean() }),
  },
  today_setDone: {
    input: z.object({ taskId: z.string(), done: z.boolean() }),
    output: z.object({ ok: z.boolean() }),
  },
  today_setPinned: {
    input: z.object({ taskId: z.string(), pinned: z.boolean() }),
    output: z.object({ ok: z.boolean() }),
  },
  today_setDue: {
    input: z.object({ taskId: z.string(), dueDate: z.string().nullable() }),
    output: z.object({ ok: z.boolean() }),
  },
  chat_ensure: {
    input: z.null(),
    output: z.object({ threadId: z.string() }),
  },
  chat_new: {
    input: z.null(),
    output: z.object({ threadId: z.string() }),
  },
  /**
   * Continue the current chat somewhere else on the current chat defaults
   * (provider, model, reasoning): a fresh rail chat, or a full thread in the
   * sidebar. The new thread opens with a real @thread mention of the chat it
   * continues, so the agent reads the transcript with `bb thread log`.
   */
  chat_continue: {
    input: z.object({ target: z.enum(["chat", "thread"]) }),
    output: z.object({ threadId: z.string() }),
  },
});

export type PanelData = z.infer<typeof rpcContract.tasks_list.output>;

/** Realtime channels app.tsx listens on. */
export const TODAY_CHANGED = "today-changed";
export const CHAT_CHANGED = "chat-changed";

// A new key deliberately leaves legacy capture conversations intact.
const KV_CHAT_THREAD = "generalChatThreadId";
const KV_PINNED_AT = "pinnedAt";

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    source: {
      type: "select",
      label: "Task source",
      description: "Where the rail reads and files tasks: the Linear plugin's mirror of your issues, or the builtin Tasks plugin.",
      options: [...SOURCES],
      default: "linear",
    },
    linearTeam: {
      type: "string",
      label: "Linear team",
      description: "Team key (e.g. ENG) to show and file into. Blank shows every bound team and files into the first.",
      default: "",
    },
    linearAssignee: {
      type: "select",
      label: "Linear issues to show",
      options: ["me", "all"],
      default: "me",
    },
    trackerPrefix: {
      type: "string",
      label: "Tasks project prefix",
      description:
        "Fallback when no Tasks project is linked to your personal bb project. The rail reads and files tasks here.",
      default: "ME",
    },
    inboxProviderId: {
      type: "string",
      label: "Default chat provider",
      default: "codex",
    },
    inboxModel: {
      type: "string",
      label: "Default chat model",
      description: "Provider and model defaults apply to new chats.",
      default: "gpt-5.5",
    },
    inboxReasoning: {
      type: "select",
      label: "Default chat reasoning",
      options: ["none", "low", "medium", "high", "xhigh", "max", "ultra", "ultracode"],
      default: "low",
    },
    inboxServiceTier: {
      type: "select",
      label: "Default chat service tier",
      options: ["default", "fast"],
      default: "default",
    },
    inboxHostId: {
      type: "string",
      label: "Chat machine",
      description: "Machine id or name the inbox thread runs on. Blank picks the local or first connected machine.",
      default: "",
    },

  });

  // ---- Source selection ---------------------------------------------------
  const linear = createLinearSource(bb);
  let sourceCache: Source = "linear";
  let linearTeamCache = "";
  let linearAssigneeCache: "me" | "all" = "me";
  async function refreshSourceSettings(): Promise<void> {
    const values = await settings.get();
    sourceCache = values.source === "tasks" ? "tasks" : "linear";
    linearTeamCache = String(values.linearTeam ?? "").trim().toUpperCase();
    linearAssigneeCache = values.linearAssignee === "all" ? "all" : "me";
  }
  await refreshSourceSettings();
  async function getSource(): Promise<Source> {
    await refreshSourceSettings();
    // Fall back to Tasks until the Linear plugin has mirrored something.
    if (sourceCache === "linear" && !linear.available()) return "tasks";
    return sourceCache;
  }

  // ---- Tasks plugin access ------------------------------------------------
  async function tasks<T>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    return bb.sdk.plugins.callRpc<T>({
      pluginId: TASKS_PLUGIN_ID,
      method,
      // Tasks validates the full shape; we only promise JSON.
      input: input as never,
      outputSchema,
    });
  }

  let personalProjectId: string | null = null;
  async function getPersonalProjectId(): Promise<string | null> {
    if (personalProjectId !== null) return personalProjectId;
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    personalProjectId = projects.find((project) => project.kind === "personal")?.id ?? null;
    return personalProjectId;
  }

  interface Tracker {
    id: string;
    prefix: string;
  }
  let trackerCache: { value: Tracker; at: number } | null = null;
  async function getTracker(): Promise<Tracker> {
    if (trackerCache !== null && Date.now() - trackerCache.at < 60_000) return trackerCache.value;
    const [{ projects }, personalId, values] = await Promise.all([
      tasks("listProjects", {}, listProjectsOutput),
      getPersonalProjectId(),
      settings.get(),
    ]);
    const trackerPrefix = String(values.trackerPrefix ?? "ME");
    const linked = personalId === null ? undefined : projects.find((p) => p.linkedBbProjectId === personalId);
    const byPrefix = projects.find((p) => p.prefix.toUpperCase() === trackerPrefix.toUpperCase());
    const chosen = linked ?? byPrefix;
    if (chosen === undefined) {
      throw new Error(
        `No Tasks project is linked to your personal project or has prefix ${trackerPrefix}. ` +
          `Run: bb tasks project update <prefix> --link-bb-project ${personalId ?? "proj_personal"}`,
      );
    }
    trackerCache = { value: { id: chosen.id, prefix: chosen.prefix }, at: Date.now() };
    return trackerCache.value;
  }

  let labelCache: { value: Map<string, string>; projectId: string; at: number } | null = null;
  /** name → id for the tracker's labels, creating the pin label on first use. */
  async function getLabels(projectId: string): Promise<Map<string, string>> {
    if (labelCache !== null && labelCache.projectId === projectId && Date.now() - labelCache.at < 60_000) {
      return labelCache.value;
    }
    const { labels } = await tasks("listLabels", { projectId }, listLabelsOutput);
    const map = new Map(labels.map((label) => [label.name, label.id] as const));
    if (!map.has(PIN_LABEL)) {
      const created = await tasks(
        "createLabel",
        { projectId, name: PIN_LABEL, color: "gray" },
        labelMutationOutput,
      );
      if (created.ok) map.set(created.label.name, created.label.id);
    }
    labelCache = { value: map, projectId, at: Date.now() };
    return map;
  }

  async function readPinnedAt(): Promise<Record<string, string>> {
    return (await bb.storage.kv.get<Record<string, string>>(KV_PINNED_AT)) ?? {};
  }

  async function buildView(): Promise<{ view: TodayView; trackerPrefix: string }> {
    if ((await getSource()) === "linear") return buildLinearView();
    const tracker = await getTracker();
    const labels = await getLabels(tracker.id);
    const today = localDateString(new Date());
    const [open, done, pinnedAt] = await Promise.all([
      tasks(
        "listTasks",
        { projectId: tracker.id, statuses: [...OPEN_STATUSES], sort: "due", limit: 300 },
        listTasksOutput,
      ),
      tasks(
        "listTasks",
        { projectId: tracker.id, statuses: ["done"], sort: "manual", limit: 100 },
        listTasksOutput,
      ),
      readPinnedAt(),
    ]);
    const labelNames = new Map([...labels].map(([name, id]) => [id, name] as const));
    const { view, nextPinnedAt } = groupToday({
      openTasks: open.tasks,
      doneTasks: done.tasks,
      labelNames,
      pinLabelId: labels.get(PIN_LABEL) ?? null,
      today,
      pinnedAt,
    });
    if (JSON.stringify(nextPinnedAt) !== JSON.stringify(pinnedAt)) {
      await bb.storage.kv.set(KV_PINNED_AT, nextPinnedAt);
    }
    return { view, trackerPrefix: tracker.prefix };
  }

  async function getTask(taskId: string): Promise<TasksTask> {
    // Accept a task id or a key like ME-12 so the CLI is pleasant to use.
    const byId = await tasks("getTask", { taskId }, z.object({ task: tasksTaskSchema.nullable() })).catch(
      () => null,
    );
    if (byId?.task) return byId.task;
    const byKey = await tasks("getTaskByKey", { taskKey: taskId.toUpperCase() }, taskByKeyOutput);
    if (byKey.task === null) throw new Error(`No task ${taskId}`);
    return byKey.task;
  }

  async function updateTask(input: Record<string, unknown>): Promise<boolean> {
    const result = await tasks("updateTask", { ...input, authorName: "Today" }, mutationOutput);
    if (!result.ok) {
      bb.log.warn(`updateTask failed: ${JSON.stringify(result.error)}`);
    }
    bb.realtime.publish(TODAY_CHANGED, { at: Date.now() });
    return result.ok;
  }

  async function setDone(taskId: string, done: boolean): Promise<boolean> {
    if ((await getSource()) === "linear") return setStatusAny(taskId, done ? "done" : "todo");
    const task = await getTask(taskId);
    return updateTask({ taskId: task.id, status: done ? "done" : "todo" });
  }

  async function setPinned(taskId: string, pinned: boolean): Promise<boolean> {
    if ((await getSource()) === "linear") return setLinearPinned(taskId, pinned);
    const task = await getTask(taskId);
    const labels = await getLabels(task.projectId);
    const pinId = labels.get(PIN_LABEL);
    if (pinId === undefined) throw new Error(`Label "${PIN_LABEL}" is missing`);
    const has = task.labelIds.includes(pinId);
    if (has === pinned) return true;
    const labelIds = pinned ? [...task.labelIds, pinId] : task.labelIds.filter((id) => id !== pinId);
    const ok = await updateTask({ taskId: task.id, labelIds });
    if (ok && !pinned) {
      const pinnedAt = await readPinnedAt();
      delete pinnedAt[task.id];
      await bb.storage.kv.set(KV_PINNED_AT, pinnedAt);
    }
    return ok;
  }

  async function setDue(taskId: string, dueDate: string | null): Promise<boolean> {
    if ((await getSource()) === "linear") return publishAfter(linear.setDue(taskId, dueDate));
    const task = await getTask(taskId);
    return updateTask({ taskId: task.id, dueDate });
  }

  async function setStatusAny(taskId: string, status: TaskRow["status"]): Promise<boolean> {
    if ((await getSource()) === "linear") return publishAfter(linear.setStatus(taskId, status));
    return updateTask({ taskId, status });
  }

  async function setPriorityAny(taskId: string, priority: TaskRow["priority"]): Promise<boolean> {
    if ((await getSource()) === "linear") return publishAfter(linear.setPriority(taskId, priority));
    return updateTask({ taskId, priority });
  }

  async function publishAfter(call: Promise<boolean>): Promise<boolean> {
    const ok = await call;
    bb.realtime.publish(TODAY_CHANGED, { at: Date.now() });
    return ok;
  }

  // ---- Linear source ------------------------------------------------------
  /** Pins in Linear use a label named `today` when the workspace has one, else this plugin's kv. */
  async function isLinearPinned(issue: LinearIssue, pinnedAt: Record<string, string>): Promise<boolean> {
    const label = linear.pinLabel(PIN_LABEL);
    if (label !== null) return issue.labelIds.includes(label.id);
    return pinnedAt[issue.id] !== undefined;
  }

  async function setLinearPinned(idOrKey: string, pinned: boolean): Promise<boolean> {
    const issue = linear.getIssue(idOrKey);
    const label = linear.pinLabel(PIN_LABEL);
    const pinnedAt = await readPinnedAt();
    if (pinned) pinnedAt[issue.id] = pinnedAt[issue.id] ?? localDateString(new Date());
    else delete pinnedAt[issue.id];
    await bb.storage.kv.set(KV_PINNED_AT, pinnedAt);
    if (label === null) {
      bb.realtime.publish(TODAY_CHANGED, { at: Date.now() });
      return true;
    }
    return publishAfter(linear.setLabel(issue.id, label.id, pinned));
  }

  function linearTeamId(): string | null {
    if (linearTeamCache === "") return null;
    return linear.boundTeams().find((team) => team.key.toUpperCase() === linearTeamCache)?.id ?? null;
  }

  function linearHref(identifier: string): string {
    return `/plugins/linear/linear/i/${encodeURIComponent(identifier)}`;
  }

  async function linearRows(issues: LinearIssue[]): Promise<PanelTask[]> {
    const pinnedAt = await readPinnedAt();
    const rows: PanelTask[] = [];
    for (const issue of issues) {
      rows.push({
        id: issue.id,
        key: issue.identifier,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        dueDate: issue.dueDate,
        projectId: issue.teamId,
        projectPrefix: issue.teamKey,
        pinned: await isLinearPinned(issue, pinnedAt),
        labels: issue.labels.filter((name) => name.toLowerCase() !== PIN_LABEL),
        agentsWorking: 0,
        updatedAt: new Date(issue.updatedAt).toISOString(),
        href: issue.url ?? linearHref(issue.identifier),
      });
    }
    return rows;
  }

  async function listLinearPanel(input: PanelInput): Promise<PanelOutput> {
    const { issues, teams, labels } = linear.listIssues({
      teamId: input.projectId ?? linearTeamId(),
      assignee: linearAssigneeCache,
      search: input.search,
      sort: input.sort,
      includeClosed: input.statuses.length === 0 || input.statuses.some((s) => s === "done" || s === "canceled"),
    });
    const statuses = new Set(input.statuses.length === 0 ? ALL_STATUSES : input.statuses);
    const priorities = new Set(input.priorities);
    const wanted = new Set(input.labels.map((name) => name.toLowerCase()));
    const rows = (await linearRows(issues)).filter(
      (row) =>
        statuses.has(row.status) &&
        (priorities.size === 0 || priorities.has(row.priority)) &&
        (wanted.size === 0 || row.labels.some((name) => wanted.has(name.toLowerCase()))),
    );
    return {
      source: "linear",
      today: localDateString(new Date()),
      tasks: rows,
      projects: teams.map((team) => ({ id: team.id, name: team.name, prefix: team.key })),
      labels: labels.map((label) => ({ id: label.id, projectId: label.teamId ?? "", name: label.name, color: label.color ?? "gray" })),
    };
  }

  async function buildLinearView(): Promise<{ view: TodayView; trackerPrefix: string }> {
    const teamId = linearTeamId();
    const { issues, teams } = linear.listIssues({
      teamId,
      assignee: linearAssigneeCache,
      search: "",
      sort: "due",
      includeClosed: true,
    });
    const today = localDateString(new Date());
    const pinnedAt = await readPinnedAt();
    const PIN = "__pin__";
    const open = [];
    const done = [];
    for (const issue of issues) {
      const pinned = await isLinearPinned(issue, pinnedAt);
      const source = {
        id: issue.id,
        key: issue.identifier,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        dueDate: issue.dueDate,
        updatedAt: new Date(issue.completedAt ?? issue.updatedAt).toISOString(),
        labelIds: pinned ? [...issue.labelIds, PIN] : issue.labelIds,
      };
      if (issue.status === "done") done.push(source);
      else if (issue.status !== "canceled") open.push(source);
    }
    const labelNames = new Map(linear.labels().map((label) => [label.id, label.name] as const));
    const { view, nextPinnedAt } = groupToday({ openTasks: open, doneTasks: done, labelNames, pinLabelId: PIN, today, pinnedAt });
    if (JSON.stringify(nextPinnedAt) !== JSON.stringify(pinnedAt)) await bb.storage.kv.set(KV_PINNED_AT, nextPinnedAt);
    const prefix = teamId === null ? (teams[0]?.key ?? "") : (teams.find((t) => t.id === teamId)?.key ?? "");
    return { view, trackerPrefix: prefix };
  }

  // ---- Full task panel ----------------------------------------------------
  type PanelInput = z.infer<typeof rpcContract.tasks_list.input>;
  type PanelOutput = z.infer<typeof rpcContract.tasks_list.output>;

  /** Labels for every project (name lookups and the filter menu). */
  async function listAllLabels(projectIds: string[]): Promise<z.infer<typeof panelLabelSchema>[]> {
    const perProject = await Promise.all(
      projectIds.map((projectId) =>
        tasks("listLabels", { projectId }, listLabelsOutput).then(
          (result) => result.labels,
          () => [],
        ),
      ),
    );
    return perProject.flat().map((label) => ({
      id: label.id,
      projectId: label.projectId,
      name: label.name,
      color: label.color,
    }));
  }

  async function listPanel(input: PanelInput): Promise<PanelOutput> {
    if ((await getSource()) === "linear") return listLinearPanel(input);
    const { projects } = await tasks("listProjects", {}, listProjectsOutput);
    const scoped = input.projectId === null ? projects : projects.filter((p) => p.id === input.projectId);
    const labels = await listAllLabels(scoped.map((p) => p.id));
    const labelName = new Map(labels.map((label) => [label.id, label.name] as const));
    const wanted = new Set(input.labels);
    // Label filters are by name; a name may exist in several projects.
    const labelIds = labels.filter((label) => wanted.has(label.name)).map((label) => label.id);
    if (wanted.size > 0 && labelIds.length === 0) {
      return { source: "tasks", today: localDateString(new Date()), tasks: [], projects: scoped, labels };
    }
    const statuses = input.statuses.length === 0 ? [...ALL_STATUSES] : input.statuses;
    const priorities = input.priorities.length === 0 ? undefined : input.priorities;
    const search = input.search.trim();
    const pages = await Promise.all(
      scoped.map((project) =>
        tasks(
          "listTasks",
          {
            projectId: project.id,
            statuses,
            ...(priorities === undefined ? {} : { priorities }),
            ...(labelIds.length === 0 ? {} : { labelIds }),
            ...(search === "" ? {} : { search }),
            sort: input.sort,
            limit: 500,
          },
          listTasksOutput,
        ).then((page) => page.tasks.map((task) => ({ task, prefix: project.prefix }))),
      ),
    );
    const rows: PanelTask[] = pages.flat().map(({ task, prefix }) => {
      const names = task.labelIds.map((id) => labelName.get(id) ?? id);
      const working = (task as Record<string, unknown>).agentsWorking;
      return {
        id: task.id,
        key: task.key,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        projectId: task.projectId,
        projectPrefix: prefix,
        pinned: names.includes(PIN_LABEL),
        labels: names.filter((name) => name !== PIN_LABEL),
        agentsWorking: typeof working === "number" ? working : 0,
        updatedAt: task.updatedAt,
        href: `/plugins/tasks/tasks/task/${encodeURIComponent(task.key)}`,
      };
    });
    // Each project came back in its own order. Manual order only means
    // something within a project, so keep projects as blocks; priority and
    // due sorts interleave across projects so "all projects" reads as one list.
    if (scoped.length > 1 && input.sort !== "manual") rows.sort(compareForSort(input.sort));
    return {
      source: "tasks",
      today: localDateString(new Date()),
      tasks: rows,
      projects: scoped.map((p) => ({ id: p.id, name: p.name, prefix: p.prefix })),
      labels,
    };
  }

  function compareForSort(sort: "priority" | "due"): (a: PanelTask, b: PanelTask) => number {
    const priorityRank = new Map(ALL_PRIORITIES.map((p, i) => [p, i] as const));
    const byPriority = (a: PanelTask, b: PanelTask) =>
      (priorityRank.get(a.priority) ?? 9) - (priorityRank.get(b.priority) ?? 9);
    const byDue = (a: PanelTask, b: PanelTask) => {
      if (a.dueDate === b.dueDate) return 0;
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    };
    // Array.prototype.sort is stable, so ties keep each project's manual order.
    return sort === "priority" ? (a, b) => byPriority(a, b) || byDue(a, b) : (a, b) => byDue(a, b) || byPriority(a, b);
  }

  async function boardMove(input: z.infer<typeof rpcContract.tasks_boardMove.input>): Promise<boolean> {
    // Linear has no manual order over RPC; a drop only changes the state.
    if ((await getSource()) === "linear") return publishAfter(linear.setStatus(input.taskId, input.status));
    const result = await tasks(
      "boardMove",
      {
        taskId: input.taskId,
        status: input.status,
        beforeTaskId: input.beforeTaskId,
        afterTaskId: input.afterTaskId,
        authorName: "Today",
      },
      mutationOutput,
    );
    if (!result.ok) bb.log.warn(`boardMove failed: ${JSON.stringify(result.error)}`);
    bb.realtime.publish(TODAY_CHANGED, { at: Date.now() });
    return result.ok;
  }

  // ---- Inbox thread -------------------------------------------------------
  async function chatThreadAlive(threadId: string): Promise<boolean> {
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      return thread.deletedAt === null && thread.archivedAt === null;
    } catch {
      return false;
    }
  }

  /** The machine the inbox runs on: the configured one, else the local/primary host, else the first connected. */
  async function pickHostId(): Promise<string | null> {
    const configured = String((await settings.get()).inboxHostId ?? "").trim();
    const hosts = (await bb.sdk.hosts.list()) as unknown as Array<Record<string, unknown>>;
    if (configured !== "") {
      const match = hosts.find((host) => host.id === configured || host.name === configured);
      if (match !== undefined) return String(match.id);
      bb.log.warn(`inboxHostId "${configured}" is not an enrolled machine; falling back`);
    }
    const connected = hosts.filter((host) => host.status === "connected");
    const local = connected.find((host) => host.isLocal === true || host.isPrimary === true);
    const chosen = local ?? connected[0] ?? hosts[0];
    return chosen === undefined ? null : String(chosen.id);
  }

  async function personalEnvironment(): Promise<unknown> {
    // The personal project runs on a projectless environment provider that
    // needs a machine. Pick the provider by id rather than hardcoding it.
    try {
      const providers = await bb.sdk.environments.listProviders();
      const personal = providers.find((provider) =>
        String((provider as unknown as { id?: unknown }).id ?? "").includes("personal"),
      );
      const hostId = await pickHostId();
      if (personal !== undefined && hostId !== null) {
        return {
          type: "provider",
          environmentProviderId: (personal as unknown as { id: string }).id,
          inputs: null,
          machine: { type: "existing", hostId },
        };
      }
    } catch (error) {
      bb.log.warn(`resolving the personal environment failed, using project-default: ${String(error)}`);
    }
    return { type: "project-default" };
  }

  /** The chat defaults as spawn fields: provider, model, reasoning, tier. */
  async function chatExecution() {
    const values = await settings.get();
    return {
      providerId: String(values.inboxProviderId ?? "codex"),
      model: String(values.inboxModel ?? "gpt-5.5"),
      reasoningLevel: chatSelectionSchema.shape.reasoningLevel.parse(values.inboxReasoning ?? "low"),
      serviceTier: chatSelectionSchema.shape.serviceTier.parse(values.inboxServiceTier ?? "default"),
      permissionMode: "accept-edits" as const,
    };
  }

  /**
   * Start a thread in the personal workspace on the chat defaults. `select`
   * makes it the rail's chat; otherwise it is a normal sidebar thread.
   */
  async function spawnPersonalThread(options: {
    select: boolean;
    title?: string;
    prompt?: string;
    input?: ReturnType<typeof buildHandoffInput>[];
    pluginMetadata: Record<string, string>;
  }): Promise<string> {
    const projectId = await getPersonalProjectId();
    if (projectId === null) throw new Error("bb has no personal project to host the inbox thread");
    const environment = await personalEnvironment();
    const thread = await bb.sdk.threads.spawn({
      projectId,
      environment: environment as never,
      ...(await chatExecution()),
      ...(options.title === undefined ? {} : { title: options.title }),
      visibility: "visible",
      pluginMetadata: options.pluginMetadata,
      ...(options.input === undefined ? { prompt: options.prompt ?? "" } : { input: options.input }),
    } as never);
    if (options.select) {
      await bb.storage.kv.set(KV_CHAT_THREAD, thread.id);
      bb.realtime.publish(CHAT_CHANGED, { threadId: thread.id });
    }
    return thread.id;
  }

  function spawnChat(): Promise<string> {
    return spawnPersonalThread({
      select: true,
      title: "Chat",
      pluginMetadata: { role: "chat" },
      prompt: "Start a new general-purpose chat. Briefly greet me, then wait for my request.",
    });
  }

  /** Continue the current chat in a fresh rail chat or a full sidebar thread. */
  async function continueChat(target: "chat" | "thread"): Promise<string> {
    const sourceId = await bb.storage.kv.get<string>(KV_CHAT_THREAD);
    if (!sourceId) throw new Error("there is no chat to continue yet");
    const source = await bb.sdk.threads.get({ threadId: sourceId });
    const input = buildHandoffInput(DEFAULT_MESSAGE, {
      id: source.id,
      projectId: source.projectId,
      label: source.title ?? source.titleFallback ?? source.id,
    });
    return spawnPersonalThread({
      select: target === "chat",
      ...(target === "chat" ? { title: "Chat" } : {}),
      pluginMetadata: { role: target === "chat" ? "chat" : "handoff", sourceThreadId: source.id },
      input: [input],
    });
  }

  let ensureInFlight: Promise<string> | null = null;
  async function ensureChat(): Promise<string> {
    if (ensureInFlight !== null) return ensureInFlight;
    ensureInFlight = (async () => {
      const stored = await bb.storage.kv.get<string>(KV_CHAT_THREAD);
      if (stored && (await chatThreadAlive(stored))) return stored;
      return spawnChat();
    })().finally(() => {
      ensureInFlight = null;
    });
    return ensureInFlight;
  }

  // ---- RPC ----------------------------------------------------------------
  bb.rpc.register(rpcContract, {
    today_list: () => buildView(),
    today_setDone: async ({ taskId, done }) => ({ ok: await setDone(taskId, done) }),
    today_setPinned: async ({ taskId, pinned }) => ({ ok: await setPinned(taskId, pinned) }),
    today_setDue: async ({ taskId, dueDate }) => ({ ok: await setDue(taskId, dueDate) }),
    tasks_list: (input) => listPanel(input),
    tasks_setStatus: async ({ taskId, status }) => ({ ok: await setStatusAny(taskId, status) }),
    tasks_setPriority: async ({ taskId, priority }) => ({ ok: await setPriorityAny(taskId, priority) }),
    tasks_boardMove: async (input) => ({ ok: await boardMove(input) }),
    chat_defaults: async () => {
      const values = await settings.get();
      return {
        selection: chatSelectionSchema.parse({
          providerId: values.inboxProviderId,
          model: values.inboxModel,
          reasoningLevel: values.inboxReasoning,
          serviceTier: values.inboxServiceTier,
        }),
        hostId: await pickHostId(),
      };
    },
    chat_setDefaults: async (selection) => {
      // A no-op save must not broadcast: the picker echoes normalised values
      // and a broadcast would make every rail reload and echo again.
      const next = {
        inboxProviderId: selection.providerId,
        inboxModel: selection.model,
        inboxReasoning: selection.reasoningLevel,
        inboxServiceTier: selection.serviceTier ?? "default",
      };
      const current = await settings.get();
      if ((Object.keys(next) as Array<keyof typeof next>).every((key) => current[key] === next[key])) {
        return { ok: true };
      }
      await settings.experimental_set(next);
      bb.realtime.publish("chat-defaults-changed", {});
      return { ok: true };
    },
    chat_ensure: async () => ({ threadId: await ensureChat() }),
    chat_new: async () => {
      // Keep the previous chat selected if creating its replacement fails.
      if (ensureInFlight !== null) await ensureInFlight;
      ensureInFlight = spawnChat().finally(() => { ensureInFlight = null; });
      return { threadId: await ensureInFlight };
    },
    chat_continue: async ({ target }) => {
      if (ensureInFlight !== null) await ensureInFlight;
      if (target === "thread") return { threadId: await continueChat("thread") };
      ensureInFlight = continueChat("chat").finally(() => { ensureInFlight = null; });
      return { threadId: await ensureInFlight };
    },
  });

  // ---- Keep the rail fresh ------------------------------------------------
  // Plugin realtime is scoped per plugin on the client, so Tasks' own signals
  // do not reach our app. We publish on our own mutations, when the inbox
  // thread goes idle (it probably just filed something), and the app also
  // polls lightly while visible.
  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    async callback(event) {
      const inboxId = await bb.storage.kv.get<string>(KV_CHAT_THREAD);
      if (event.id === undefined || event.id !== inboxId) return;
      if (event.changes.includes("thread-deleted")) {
        await bb.storage.kv.delete(KV_CHAT_THREAD);
        bb.realtime.publish(CHAT_CHANGED, { threadId: null });
        return;
      }
      if (event.changes.includes("status-changed")) {
        bb.realtime.publish(TODAY_CHANGED, { at: Date.now() });
      }
    },
  });
  bb.onDispose(() => unsubscribe());

  // ---- CLI: `bb today` ----------------------------------------------------
  const usage = [
    "Usage:",
    "  bb today list [--json]            Overdue, due today, pinned, done today",
    "  bb today tasks [--json] [--all] [--project <prefix>] [--status <s>]... [--search <q>]",
    "                                    The full list the rail shows (open tasks across projects by default)",
    "  bb today pin <key> [--json]       Pin a task to today (adds the `today` label)",
    "  bb today unpin <key> [--json]",
    "  bb today done <key> [--json]",
    "  bb today undo <key> [--json]",
    "  bb today tomorrow <key> [--json]  Move a task's due date to tomorrow",
    "  bb today chat [--json]            Print the chat thread id (creates it if needed)",
  ].join("\n");
  const fmt = (row: TaskRow) => {
    const due = row.dueDate ? ` (due ${row.dueDate})` : "";
    const pin = row.pinned ? ` [pinned ${row.pinnedDays}d]` : "";
    return `${row.key.padEnd(8)} ${row.title}${due}${pin}`;
  };
  bb.cli.register({
    name: "today",
    summary: "Read and edit the Linear Panel (pins, due-today, inbox)",
    commands: [
      { name: "list", summary: "Show today's view", usage: "bb today list [--json]" },
      {
        name: "tasks",
        summary: "The full task list the rail shows",
        usage: "bb today tasks [--json] [--all] [--project <prefix>] [--status <s>]... [--search <q>]",
      },
      { name: "pin", summary: "Pin a task to today", usage: "bb today pin <key> [--json]" },
      { name: "unpin", summary: "Unpin a task", usage: "bb today unpin <key> [--json]" },
      { name: "done", summary: "Mark a task done", usage: "bb today done <key> [--json]" },
      { name: "undo", summary: "Mark a task todo again", usage: "bb today undo <key> [--json]" },
      { name: "tomorrow", summary: "Due tomorrow", usage: "bb today tomorrow <key> [--json]" },
      { name: "chat", summary: "Chat thread id", usage: "bb today chat [--json]" },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const flag = (name: string): string[] => {
        const values: string[] = [];
        argv.forEach((arg, index) => {
          if (arg === name && argv[index + 1] !== undefined) values.push(argv[index + 1]!);
        });
        return values;
      };
      const consumed = new Set(["--json", "--all"]);
      const positional = argv.filter(
        (arg, index) =>
          !consumed.has(arg) &&
          !["--project", "--status", "--search"].includes(arg) &&
          !["--project", "--status", "--search"].includes(argv[index - 1] ?? ""),
      );
      const [command, key] = positional;
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value) : text,
      });
      try {
        switch (command) {
          case undefined:
          case "help":
          case "--help":
            return { exitCode: 0, stdout: usage };
          case "list": {
            const { view } = await buildView();
            const section = (title: string, rows: TaskRow[]) =>
              rows.length === 0 ? [] : [`${title}:`, ...rows.map((row) => `  ${fmt(row)}`)];
            const text = [
              ...section("Overdue", view.overdue),
              ...section("Due today", view.dueToday),
              ...section("Pinned", view.pinned),
              ...section("Done today", view.doneToday),
            ];
            return reply(view, text.length === 0 ? "Nothing on the rail." : text.join("\n"));
          }
          case "tasks": {
            const prefix = flag("--project")[0];
            let project: { id: string } | undefined;
            if ((await getSource()) === "linear") {
              project = prefix === undefined ? undefined : linear.boundTeams().find((t) => t.key.toUpperCase() === prefix.toUpperCase());
              if (prefix !== undefined && project === undefined) return { exitCode: 1, stderr: `No bound Linear team ${prefix}` };
            } else {
              const { projects } = await tasks("listProjects", {}, listProjectsOutput);
              project = prefix === undefined ? undefined : projects.find((p) => p.prefix.toUpperCase() === prefix.toUpperCase());
              if (prefix !== undefined && project === undefined) return { exitCode: 1, stderr: `No Tasks project with prefix ${prefix}` };
            }
            const statuses = flag("--status").filter((value): value is TaskRow["status"] =>
              (ALL_STATUSES as readonly string[]).includes(value),
            );
            const panel = await listPanel({
              projectId: project?.id ?? null,
              statuses: argv.includes("--all") ? [] : statuses.length > 0 ? statuses : [...OPEN_STATUSES],
              priorities: [],
              labels: [],
              search: flag("--search")[0] ?? "",
              sort: "manual",
            });
            const text = panel.tasks.map((row) => {
              const due = row.dueDate ? ` (due ${row.dueDate})` : "";
              const pin = row.pinned ? " [pinned]" : "";
              return `${row.key.padEnd(8)} ${row.status.padEnd(11)} ${row.priority.padEnd(6)} ${row.title}${due}${pin}`;
            });
            return reply(panel, text.length === 0 ? "No tasks." : text.join("\n"));
          }
          case "pin":
          case "unpin":
          case "done":
          case "undo":
          case "tomorrow": {
            if (key === undefined) break;
            let ok: boolean;
            if (command === "pin" || command === "unpin") ok = await setPinned(key, command === "pin");
            else if (command === "done" || command === "undo") ok = await setDone(key, command === "done");
            else {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              ok = await setDue(key, localDateString(tomorrow));
            }
            return ok
              ? reply({ ok: true, key }, `${command} ${key}: ok`)
              : { exitCode: 1, stderr: `${command} ${key}: Tasks rejected the update` };
          }
          case "inbox":
          case "chat": {
            const threadId = await ensureChat();
            return reply({ threadId }, threadId);
          }
        }
        return { exitCode: 1, stderr: usage };
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  bb.log.info("today-rail loaded");
}
