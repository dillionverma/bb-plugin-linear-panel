// Linear as a rail source.
//
// Reads come from the Linear plugin's local mirror (a SQLite file the plugin
// keeps in sync on this host), attached read-only-by-convention to our own
// database handle. The plugin's list RPC returns rows rendered for its own
// panel (no raw due date, labels, or state type), so the mirror is the only
// exact source. Writes go through the Linear plugin's `updateIssue` RPC so its
// "Allow changes to Linear" switch and rate budget still apply.
import { existsSync } from "node:fs";
import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Database } from "better-sqlite3";
import { z } from "zod";
import { priorityFromLinear, priorityToLinear, stateForStatus, statusFromLinearState, type LinearStateLike } from "./linear-map";
import type { TaskPriority, TaskStatus } from "./today";

const LINEAR_PLUGIN_ID = "linear";

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  teamId: string;
  teamKey: string;
  stateId: string | null;
  stateName: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeId: string | null;
  labelIds: string[];
  labels: string[];
  sortOrder: number;
  /** Epoch ms. */
  updatedAt: number;
  completedAt: number | null;
  url: string | null;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}
export interface LinearLabel {
  id: string;
  teamId: string | null;
  name: string;
  color: string | null;
}

export interface LinearQuery {
  teamId: string | null;
  assignee: "me" | "all";
  search: string;
  sort: "manual" | "priority" | "due";
  includeClosed: boolean;
}

const mutationOutput = z.object({ ok: z.boolean(), message: z.string().nullable() }).loose();

export function createLinearSource(bb: BbPluginApi) {
  const mirrorPath = path.join(bb.server.experimental_dataDir, "plugins", LINEAR_PLUGIN_ID, "data.db");
  let handle: Database | null = null;

  function setupHint(): string {
    return (
      "The Linear plugin has no local mirror yet. Set an API key with " +
      "`bb plugin config linear set apiKey <key>` and bind a team with `bb linear bind <TEAM-KEY>`, then retry."
    );
  }

  function db(): Database {
    if (handle !== null) return handle;
    if (!existsSync(mirrorPath)) throw new Error(setupHint());
    const own = bb.storage.database();
    own.exec(`ATTACH DATABASE '${mirrorPath.replace(/'/g, "''")}' AS linear`);
    handle = own;
    return own;
  }

  /** Teams the Linear plugin mirrors: those with a bb-project binding. */
  function boundTeams(): LinearTeam[] {
    const rows = db()
      .prepare(
        `SELECT DISTINCT team.id AS id, team.key AS key, team.name AS name
           FROM linear.team AS team
           JOIN linear.binding AS binding ON binding.team_id = team.id
          ORDER BY team.key`,
      )
      .all() as LinearTeam[];
    if (rows.length === 0) throw new Error("No Linear team is bound. Run `bb linear bind <TEAM-KEY>` first.");
    return rows;
  }

  function viewerIds(): string[] {
    const rows = db().prepare(`SELECT viewer_id AS id FROM linear.workspace`).all() as { id: string }[];
    const fromMembers = db().prepare(`SELECT id FROM linear.member WHERE is_me = 1`).all() as { id: string }[];
    return [...new Set([...rows, ...fromMembers].map((row) => row.id))];
  }

  function states(teamId: string): LinearStateLike[] {
    return db()
      .prepare(`SELECT id, name, type, position FROM linear.workflow_state WHERE team_id = ? ORDER BY position`)
      .all(teamId) as LinearStateLike[];
  }

  function labels(): LinearLabel[] {
    return db()
      .prepare(`SELECT id, team_id AS teamId, name, color FROM linear.label WHERE is_group = 0 ORDER BY name`)
      .all() as LinearLabel[];
  }

  interface RawIssue {
    id: string;
    identifier: string;
    title: string;
    team_id: string;
    team_key: string;
    state_id: string | null;
    state_name: string | null;
    state_type: string | null;
    priority: number;
    due_date: string | null;
    assignee_id: string | null;
    label_ids: string;
    sort_order: number;
    updated_at: number;
    completed_at: number | null;
    url: string | null;
  }

  function toIssue(row: RawIssue, labelName: Map<string, string>): LinearIssue {
    let labelIds: string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.label_ids);
      if (Array.isArray(parsed)) labelIds = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      labelIds = [];
    }
    const state = { name: row.state_name ?? "", type: row.state_type ?? "unstarted" };
    return {
      id: row.id,
      identifier: row.identifier,
      title: row.title,
      teamId: row.team_id,
      teamKey: row.team_key,
      stateId: row.state_id,
      stateName: state.name,
      status: statusFromLinearState(state),
      priority: priorityFromLinear(row.priority),
      dueDate: row.due_date,
      assigneeId: row.assignee_id,
      labelIds,
      labels: labelIds.map((id) => labelName.get(id) ?? id),
      sortOrder: row.sort_order,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      url: row.url,
    };
  }

  const ORDER: Record<LinearQuery["sort"], string> = {
    manual: "issue.sort_order ASC, issue.updated_at DESC",
    priority: "CASE WHEN issue.priority = 0 THEN 5 ELSE issue.priority END ASC, issue.updated_at DESC",
    due: "CASE WHEN issue.due_date IS NULL THEN 1 ELSE 0 END, issue.due_date ASC, CASE WHEN issue.priority = 0 THEN 5 ELSE issue.priority END ASC",
  };

  function listIssues(query: LinearQuery): { issues: LinearIssue[]; teams: LinearTeam[]; labels: LinearLabel[] } {
    const teams = boundTeams();
    const scoped = query.teamId === null ? teams : teams.filter((team) => team.id === query.teamId);
    const allLabels = labels();
    const labelName = new Map(allLabels.map((label) => [label.id, label.name] as const));
    if (scoped.length === 0) return { issues: [], teams, labels: allLabels };

    const clauses = [
      `issue.team_id IN (${scoped.map(() => "?").join(",")})`,
      "(issue.number > 0 OR issue.parent_id IS NOT NULL)",
      "issue.archived_at IS NULL",
    ];
    const params: unknown[] = scoped.map((team) => team.id);
    if (!query.includeClosed) clauses.push("(state.type IS NULL OR state.type NOT IN ('completed','canceled'))");
    if (query.assignee === "me") {
      const me = viewerIds();
      if (me.length === 0) return { issues: [], teams, labels: allLabels };
      clauses.push(`issue.assignee_id IN (${me.map(() => "?").join(",")})`);
      params.push(...me);
    }
    const search = query.search.trim();
    if (search !== "") {
      clauses.push("(issue.title LIKE ? OR issue.identifier LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const rows = db()
      .prepare(
        `SELECT issue.id, issue.identifier, issue.title, issue.team_id, team.key AS team_key,
                issue.state_id, state.name AS state_name, state.type AS state_type,
                issue.priority, issue.due_date, issue.assignee_id, issue.label_ids,
                issue.sort_order, issue.updated_at, issue.completed_at, issue.url
           FROM linear.issue AS issue
           LEFT JOIN linear.workflow_state AS state ON state.id = issue.state_id
           LEFT JOIN linear.team AS team ON team.id = issue.team_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY ${ORDER[query.sort]}
          LIMIT 500`,
      )
      .all(...params) as RawIssue[];
    return { issues: rows.map((row) => toIssue(row, labelName)), teams, labels: allLabels };
  }

  function getIssue(idOrKey: string): LinearIssue {
    const labelName = new Map(labels().map((label) => [label.id, label.name] as const));
    const row = db()
      .prepare(
        `SELECT issue.id, issue.identifier, issue.title, issue.team_id, team.key AS team_key,
                issue.state_id, state.name AS state_name, state.type AS state_type,
                issue.priority, issue.due_date, issue.assignee_id, issue.label_ids,
                issue.sort_order, issue.updated_at, issue.completed_at, issue.url
           FROM linear.issue AS issue
           LEFT JOIN linear.workflow_state AS state ON state.id = issue.state_id
           LEFT JOIN linear.team AS team ON team.id = issue.team_id
          WHERE issue.id = ? OR UPPER(issue.identifier) = UPPER(?)
          LIMIT 1`,
      )
      .get(idOrKey, idOrKey) as RawIssue | undefined;
    if (row === undefined) throw new Error(`No Linear issue ${idOrKey}`);
    return toIssue(row, labelName);
  }

  async function update(input: Record<string, unknown>): Promise<boolean> {
    const result = await bb.sdk.plugins.callRpc({
      pluginId: LINEAR_PLUGIN_ID,
      method: "updateIssue",
      input: input as never,
      outputSchema: mutationOutput,
    });
    if (!result.ok) bb.log.warn(`linear updateIssue failed: ${result.message ?? "unknown"}`);
    return result.ok;
  }

  async function setStatus(idOrKey: string, status: TaskStatus): Promise<boolean> {
    const issue = getIssue(idOrKey);
    const target = stateForStatus(states(issue.teamId), status);
    if (target === null) throw new Error(`Team ${issue.teamKey} has no workflow state for "${status}"`);
    if (target.id === issue.stateId) return true;
    return update({ id: issue.id, stateId: target.id });
  }

  async function setPriority(idOrKey: string, priority: TaskPriority): Promise<boolean> {
    const issue = getIssue(idOrKey);
    return update({ id: issue.id, priority: priorityToLinear(priority) });
  }

  async function setDue(idOrKey: string, dueDate: string | null): Promise<boolean> {
    const issue = getIssue(idOrKey);
    return update({ id: issue.id, dueDate });
  }

  /** The workspace or team label used for pins, if the workspace has one. */
  function pinLabel(name: string): LinearLabel | null {
    return labels().find((label) => label.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  async function setLabel(idOrKey: string, labelId: string, on: boolean): Promise<boolean> {
    const issue = getIssue(idOrKey);
    const has = issue.labelIds.includes(labelId);
    if (has === on) return true;
    return update(on ? { id: issue.id, addLabelIds: [labelId] } : { id: issue.id, removeLabelIds: [labelId] });
  }

  /** True once the Linear plugin has a mirror with at least one bound team. */
  function available(): boolean {
    if (!existsSync(mirrorPath)) return false;
    try {
      const row = db().prepare(`SELECT COUNT(*) AS n FROM linear.binding`).get() as { n: number };
      return row.n > 0;
    } catch (error) {
      bb.log.warn(`linear mirror not readable yet: ${String(error)}`);
      return false;
    }
  }

  return { available, setupHint, listIssues, getIssue, boundTeams, states, labels, pinLabel, setStatus, setPriority, setDue, setLabel };
}

export type LinearSource = ReturnType<typeof createLinearSource>;
