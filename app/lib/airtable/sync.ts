/**
 * Airtable ↔ アプリの Project 形状の変換・読み書き（サーバー専用）
 * テーブル・フィールド名は .env の AIRTABLE_TABLE_* で上書き可（既定: projects / cards / tasks / edges）
 */

import { randomUUID } from "node:crypto";

export type DeferredCardJson = {
  id: string;
  title: string;
  note: string;
  checked: boolean;
};

export type StoredEdgeJson = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
  style?: unknown;
};

export type StoredNodeJson = {
  id: string;
  position: { x: number; y: number };
  kind?: "normal" | "pre" | "sql" | "memo";
  title: string;
  checked: boolean;
  tasks?: {
    id: string;
    text: string;
    checked: boolean;
    promptText?: string;
  }[];
  promptText?: string;
  preTasks?: { id: string; text: string; checked: boolean }[];
  sqlNotes?: { id: string; text: string }[];
  sqlCardText?: string;
  memoCardText?: string;
  sqlText?: string;
};

export type SaveProjectBody = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  sharedPromptMemo: string;
  deferredCards: DeferredCardJson[];
  nodes: StoredNodeJson[];
  edges: StoredEdgeJson[];
};

function escFormula(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Airtable 上の実テーブル名と一致させる（既定は小文字の projects / cards / tasks / edges） */
function getTables() {
  return {
    projects: process.env.AIRTABLE_TABLE_PROJECTS?.trim() || "projects",
    cards: process.env.AIRTABLE_TABLE_CARDS?.trim() || "cards",
    tasks: process.env.AIRTABLE_TABLE_TASKS?.trim() || "tasks",
    edges: process.env.AIRTABLE_TABLE_EDGES?.trim() || "edges",
  };
}

function trimAirtableAuth(
  baseId: string,
  apiKey: string,
): { baseId: string; apiKey: string } {
  return { baseId: baseId.trim(), apiKey: apiKey.trim() };
}

function logAirtableRequestUrl(url: string): void {
  if (process.env.NODE_ENV === "development") {
    console.log("🚀 Accessing Airtable URL:", url);
  }
}

/**
 * Airtable Web API v0 のリソース URL。
 * 形式: https://api.airtable.com/v0/${baseId}/${table}
 * （table はテーブル名または tbl… のテーブル ID。encodeURIComponent 済み）
 */
function baseUrl(baseId: string, table: string, recordId?: string): string {
  const t = encodeURIComponent(table);
  if (recordId) {
    return `https://api.airtable.com/v0/${baseId}/${t}/${encodeURIComponent(recordId)}`;
  }
  return `https://api.airtable.com/v0/${baseId}/${t}`;
}

async function listAllRecords(
  baseId: string,
  apiKey: string,
  table: string,
  filterByFormula?: string,
): Promise<{ id: string; fields: Record<string, unknown> }[]> {
  const { baseId: b, apiKey: k } = trimAirtableAuth(baseId, apiKey);
  const out: { id: string; fields: Record<string, unknown> }[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams();
    params.set("pageSize", "100");
    if (filterByFormula) params.set("filterByFormula", filterByFormula);
    if (offset) params.set("offset", offset);
    const url = `${baseUrl(b, table)}?${params.toString()}`;
    logAirtableRequestUrl(url);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${k}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Airtable list ${table}: ${res.status} ${t}`);
    }
    const json = (await res.json()) as {
      records?: { id: string; fields: Record<string, unknown> }[];
      offset?: string;
    };
    for (const r of json.records ?? []) {
      out.push({ id: r.id, fields: r.fields ?? {} });
    }
    offset = json.offset;
  } while (offset);
  return out;
}

async function deleteRecord(
  baseId: string,
  apiKey: string,
  table: string,
  recordId: string,
): Promise<void> {
  const { baseId: b, apiKey: k } = trimAirtableAuth(baseId, apiKey);
  const url = baseUrl(b, table, recordId);
  logAirtableRequestUrl(url);
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${k}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Airtable delete ${table}/${recordId}: ${res.status} ${t}`);
  }
}

async function createRecords(
  baseId: string,
  apiKey: string,
  table: string,
  fieldsList: Record<string, unknown>[],
): Promise<void> {
  const { baseId: b, apiKey: k } = trimAirtableAuth(baseId, apiKey);
  const chunk = 10;
  for (let i = 0; i < fieldsList.length; i += chunk) {
    const slice = fieldsList.slice(i, i + chunk);
    const url = baseUrl(b, table);
    logAirtableRequestUrl(url);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${k}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: slice.map((fields) => ({ fields })) }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Airtable create ${table}: ${res.status} ${t}`);
    }
  }
}

async function patchRecords(
  baseId: string,
  apiKey: string,
  table: string,
  updates: { id: string; fields: Record<string, unknown> }[],
): Promise<void> {
  const { baseId: b, apiKey: k } = trimAirtableAuth(baseId, apiKey);
  const chunk = 10;
  for (let i = 0; i < updates.length; i += chunk) {
    const slice = updates.slice(i, i + chunk);
    const url = baseUrl(b, table);
    logAirtableRequestUrl(url);
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${k}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ records: slice }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Airtable patch ${table}: ${res.status} ${t}`);
    }
  }
}

function str(f: Record<string, unknown>, k: string): string {
  const v = f[k];
  return typeof v === "string" ? v : v != null ? String(v) : "";
}

function num(f: Record<string, unknown>, k: string): number {
  const v = f[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function bool(f: Record<string, unknown>, k: string): boolean {
  const v = f[k];
  return Boolean(v);
}

/** プロジェクトに紐づく cards / tasks / edges を消してから再作成 */
export async function saveProjectToAirtable(
  baseId: string,
  apiKey: string,
  body: SaveProjectBody,
): Promise<void> {
  const t = getTables();
  const pid = body.id;

  const projectRows = await listAllRecords(
    baseId,
    apiKey,
    t.projects,
    `{id}='${escFormula(pid)}'`,
  );
  if (projectRows.length === 0) {
    await createRecords(baseId, apiKey, t.projects, [
      {
        id: pid,
        name: body.name,
        shared_prompt_memo: body.sharedPromptMemo,
      },
    ]);
  } else {
    await patchRecords(baseId, apiKey, t.projects, [
      {
        id: projectRows[0].id,
        fields: {
          id: pid,
          name: body.name,
          shared_prompt_memo: body.sharedPromptMemo,
        },
      },
    ]);
  }

  const cardRows = await listAllRecords(
    baseId,
    apiKey,
    t.cards,
    `{project_id}='${escFormula(pid)}'`,
  );
  const cardAppIds = cardRows
    .map((r) => str(r.fields, "id"))
    .filter((x) => x.length > 0);

  const taskOrChunks: string[] = [];
  const chunkSize = 12;
  for (let i = 0; i < cardAppIds.length; i += chunkSize) {
    const part = cardAppIds.slice(i, i + chunkSize);
    if (part.length === 0) continue;
    taskOrChunks.push(
      `OR(${part.map((cid) => `{card_id}='${escFormula(cid)}'`).join(",")})`,
    );
  }

  const taskRecordIds: string[] = [];
  for (const formula of taskOrChunks) {
    const rows = await listAllRecords(baseId, apiKey, t.tasks, formula);
    for (const r of rows) taskRecordIds.push(r.id);
  }

  const edgeRows = await listAllRecords(
    baseId,
    apiKey,
    t.edges,
    `{project_id}='${escFormula(pid)}'`,
  );

  for (const rid of taskRecordIds) {
    await deleteRecord(baseId, apiKey, t.tasks, rid);
  }
  for (const r of edgeRows) {
    await deleteRecord(baseId, apiKey, t.edges, r.id);
  }
  for (const r of cardRows) {
    await deleteRecord(baseId, apiKey, t.cards, r.id);
  }

  const cardFields: Record<string, unknown>[] = [];
  const taskFields: Record<string, unknown>[] = [];
  const edgeFields: Record<string, unknown>[] = [];

  for (const dc of body.deferredCards) {
    if (!dc.id) continue;
    cardFields.push({
      id: dc.id,
      project_id: pid,
      type: "deferred",
      title: dc.title ?? "",
      checked: Boolean(dc.checked),
      position_x: 0,
      position_y: 0,
      content_text: typeof dc.note === "string" ? dc.note : "",
    });
  }

  for (const n of body.nodes) {
    const nx = Number(n.position?.x);
    const ny = Number(n.position?.y);
    const px = Number.isFinite(nx) ? nx : 0;
    const py = Number.isFinite(ny) ? ny : 0;
    const kind = n.kind ?? "normal";

    if (kind === "pre") {
      cardFields.push({
        id: n.id,
        project_id: pid,
        type: "pre",
        title: n.title ?? "",
        checked: Boolean(n.checked),
        position_x: px,
        position_y: py,
        content_text: "",
      });
      const preTasks = Array.isArray(n.preTasks) ? n.preTasks : [];
      preTasks.forEach((pt, order_no) => {
        if (!pt?.id) return;
        taskFields.push({
          id: pt.id,
          card_id: n.id,
          text: pt.text ?? "",
          checked: Boolean(pt.checked),
          prompt_text: "",
          order_no,
        });
      });
      continue;
    }

    if (kind === "sql") {
      cardFields.push({
        id: n.id,
        project_id: pid,
        type: "sql",
        title: n.title ?? "",
        checked: Boolean(n.checked),
        position_x: px,
        position_y: py,
        content_text:
          typeof n.sqlCardText === "string"
            ? n.sqlCardText
            : typeof n.sqlText === "string"
              ? n.sqlText
              : "",
      });
      continue;
    }

    if (kind === "memo") {
      cardFields.push({
        id: n.id,
        project_id: pid,
        type: "memo",
        title: n.title ?? "",
        checked: Boolean(n.checked),
        position_x: px,
        position_y: py,
        content_text:
          typeof n.memoCardText === "string" ? n.memoCardText : "",
      });
      continue;
    }

    const sqlNotes = Array.isArray(n.sqlNotes) ? n.sqlNotes : [];
    const payload = {
      promptText: typeof n.promptText === "string" ? n.promptText : "",
      sqlNotes: sqlNotes.map((s) => ({
        id: s.id,
        text: s.text ?? "",
      })),
    };
    cardFields.push({
      id: n.id,
      project_id: pid,
      type: "normal",
      title: n.title ?? "",
      checked: Boolean(n.checked),
      position_x: px,
      position_y: py,
      content_text: JSON.stringify(payload),
    });

    const tasks = Array.isArray(n.tasks) ? n.tasks : [];
    tasks.forEach((task, order_no) => {
      if (!task?.id) return;
      taskFields.push({
        id: task.id,
        card_id: n.id,
        text: task.text ?? "",
        checked: Boolean(task.checked),
        prompt_text:
          typeof task.promptText === "string" ? task.promptText : "",
        order_no,
      });
    });
  }

  for (const e of body.edges) {
    if (!e.source || !e.target) continue;
    edgeFields.push({
      id: e.id || `${e.source}-${e.target}`,
      project_id: pid,
      from_card_id: e.source,
      to_card_id: e.target,
    });
  }

  await createRecords(baseId, apiKey, t.cards, cardFields);
  await createRecords(baseId, apiKey, t.tasks, taskFields);
  await createRecords(baseId, apiKey, t.edges, edgeFields);
}

export type AirtableProjectSummary = {
  id: string;
  name: string;
  shared_prompt_memo: string;
};

/** projects テーブルの全行（アプリ側 id があるもの）を一覧用に返す */
export async function listAirtableProjectSummaries(
  baseId: string,
  apiKey: string,
): Promise<AirtableProjectSummary[]> {
  const table = getTables().projects;
  const rows = await listAllRecords(baseId, apiKey, table);
  const out: AirtableProjectSummary[] = [];
  for (const r of rows) {
    const id = str(r.fields, "id");
    if (!id) continue;
    out.push({
      id,
      name: str(r.fields, "name"),
      shared_prompt_memo: str(r.fields, "shared_prompt_memo"),
    });
  }
  out.sort((a, b) =>
    a.name.localeCompare(b.name, "ja", { sensitivity: "base" }),
  );
  return out;
}

export async function loadProjectFromAirtable(
  baseId: string,
  apiKey: string,
  projectId: string,
  fallbackMeta: { createdAt: string; updatedAt: string },
): Promise<SaveProjectBody> {
  const t = getTables();

  const projectRows = await listAllRecords(
    baseId,
    apiKey,
    t.projects,
    `{id}='${escFormula(projectId)}'`,
  );
  if (projectRows.length === 0) {
    throw new Error("Project not found in Airtable");
  }
  const pf = projectRows[0].fields;
  const name = str(pf, "name") || "無題";
  const sharedPromptMemo = str(pf, "shared_prompt_memo");

  const cardRows = await listAllRecords(
    baseId,
    apiKey,
    t.cards,
    `{project_id}='${escFormula(projectId)}'`,
  );

  const canvasCardIds = cardRows
    .filter((r) => str(r.fields, "type") !== "deferred")
    .map((r) => str(r.fields, "id"))
    .filter(Boolean);

  const tasksByCard = new Map<string, Record<string, unknown>[]>();
  const chunkSize = 12;
  for (let i = 0; i < canvasCardIds.length; i += chunkSize) {
    const part = canvasCardIds.slice(i, i + chunkSize);
    if (part.length === 0) continue;
    const formula = `OR(${part.map((cid) => `{card_id}='${escFormula(cid)}'`).join(",")})`;
    const taskRows = await listAllRecords(baseId, apiKey, t.tasks, formula);
    for (const tr of taskRows) {
      const cid = str(tr.fields, "card_id");
      if (!cid) continue;
      const arr = tasksByCard.get(cid) ?? [];
      arr.push(tr.fields);
      tasksByCard.set(cid, arr);
    }
  }

  const edgeRows = await listAllRecords(
    baseId,
    apiKey,
    t.edges,
    `{project_id}='${escFormula(projectId)}'`,
  );

  const deferredCards: DeferredCardJson[] = [];
  const nodes: StoredNodeJson[] = [];

  for (const r of cardRows) {
    const f = r.fields;
    const cid = str(f, "id");
    if (!cid) continue;
    const ctype = str(f, "type") || "normal";
    const title = str(f, "title");
    const checked = bool(f, "checked");
    const px = num(f, "position_x");
    const py = num(f, "position_y");
    const content_text = str(f, "content_text");

    if (ctype === "deferred") {
      deferredCards.push({
        id: cid,
        title,
        note: content_text,
        checked,
      });
      continue;
    }

    if (ctype === "pre") {
      const rawTasks = tasksByCard.get(cid) ?? [];
      rawTasks.sort((a, b) => num(a, "order_no") - num(b, "order_no"));
      nodes.push({
        id: cid,
        position: { x: px, y: py },
        kind: "pre",
        title,
        checked,
        tasks: [],
        preTasks: rawTasks.map((tf) => ({
          id: str(tf, "id") || randomUUID(),
          text: str(tf, "text"),
          checked: bool(tf, "checked"),
        })),
      });
      continue;
    }

    if (ctype === "sql") {
      nodes.push({
        id: cid,
        position: { x: px, y: py },
        kind: "sql",
        title,
        checked,
        tasks: [],
        sqlCardText: content_text,
      });
      continue;
    }

    if (ctype === "memo") {
      nodes.push({
        id: cid,
        position: { x: px, y: py },
        kind: "memo",
        title,
        checked,
        tasks: [],
        memoCardText: content_text,
      });
      continue;
    }

    let promptText = "";
    let sqlNotes: { id: string; text: string }[] = [];
    if (content_text.trim()) {
      try {
        const parsed = JSON.parse(content_text) as {
          promptText?: string;
          sqlNotes?: { id?: string; text?: string }[];
        };
        promptText =
          typeof parsed.promptText === "string" ? parsed.promptText : "";
        if (Array.isArray(parsed.sqlNotes)) {
          sqlNotes = parsed.sqlNotes.map((s) => ({
            id: typeof s.id === "string" && s.id ? s.id : randomUUID(),
            text: typeof s.text === "string" ? s.text : "",
          }));
        }
      } catch {
        promptText = content_text;
      }
    }

    const rawTasks = tasksByCard.get(cid) ?? [];
    rawTasks.sort((a, b) => num(a, "order_no") - num(b, "order_no"));
    nodes.push({
      id: cid,
      position: { x: px, y: py },
      kind: "normal",
      title,
      checked,
      promptText,
      sqlNotes,
      tasks: rawTasks.map((tf) => ({
        id: str(tf, "id") || randomUUID(),
        text: str(tf, "text"),
        checked: bool(tf, "checked"),
        promptText: str(tf, "prompt_text"),
      })),
    });
  }

  const edges: StoredEdgeJson[] = edgeRows.map((er) => {
    const ef = er.fields;
    return {
      id: str(ef, "id") || `${str(ef, "from_card_id")}-${str(ef, "to_card_id")}`,
      source: str(ef, "from_card_id"),
      target: str(ef, "to_card_id"),
      sourceHandle: null,
      targetHandle: null,
      type: "smoothstep",
      style: { stroke: "#a78bfa", strokeWidth: 2 },
    };
  });

  const now = new Date().toISOString();
  return {
    id: projectId,
    name,
    createdAt: fallbackMeta.createdAt || now,
    updatedAt: now,
    sharedPromptMemo,
    deferredCards,
    nodes,
    edges,
  };
}

export function validateSaveBody(x: unknown): SaveProjectBody | null {
  if (!isRecord(x)) return null;
  const id = typeof x.id === "string" && x.id ? x.id : null;
  if (!id) return null;
  const name = typeof x.name === "string" ? x.name : "無題";
  const createdAt =
    typeof x.createdAt === "string" ? x.createdAt : new Date().toISOString();
  const updatedAt =
    typeof x.updatedAt === "string" ? x.updatedAt : new Date().toISOString();
  const sharedPromptMemo =
    typeof x.sharedPromptMemo === "string" ? x.sharedPromptMemo : "";
  const deferredCards = Array.isArray(x.deferredCards)
    ? x.deferredCards
        .filter(isRecord)
        .map((d) => ({
          id: typeof d.id === "string" && d.id ? d.id : randomUUID(),
          title: typeof d.title === "string" ? d.title : "",
          note: typeof d.note === "string" ? d.note : "",
          checked: Boolean(d.checked),
        }))
    : [];
  const nodes = Array.isArray(x.nodes) ? (x.nodes as StoredNodeJson[]) : [];
  const edges = Array.isArray(x.edges) ? (x.edges as StoredEdgeJson[]) : [];
  return {
    id,
    name,
    createdAt,
    updatedAt,
    sharedPromptMemo,
    deferredCards,
    nodes,
    edges,
  };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
