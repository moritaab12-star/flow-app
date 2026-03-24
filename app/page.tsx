"use client";

import {
  addEdge,
  applyEdgeChanges,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type FlowItem = {
  id: string;
  text: string;
  done: boolean;
  promptText: string;
};

type SqlNote = {
  id: string;
  text: string;
};

/** 前準備カード（preFlowBox）の行 */
type PreTask = {
  id: string;
  text: string;
  checked: boolean;
};

type FlowBoxData = {
  title: string;
  checked: boolean;
  items: FlowItem[];
  sqlNotes: SqlNote[];
  /** ボックス単位のメモ */
  promptText: string;
};

function newItem(): FlowItem {
  return { id: crypto.randomUUID(), text: "", done: false, promptText: "" };
}

function coerceItem(it: Partial<FlowItem> & { id?: string }): FlowItem {
  return {
    id:
      typeof it.id === "string" && it.id.length > 0
        ? it.id
        : crypto.randomUUID(),
    text: it.text ?? "",
    done: it.done ?? false,
    promptText: typeof it.promptText === "string" ? it.promptText : "",
  };
}

function newSqlNote(): SqlNote {
  return { id: crypto.randomUUID(), text: "" };
}

function coerceSqlNote(it: Partial<SqlNote> & { id?: string }): SqlNote {
  return {
    id:
      typeof it.id === "string" && it.id.length > 0
        ? it.id
        : crypto.randomUUID(),
    text: typeof it.text === "string" ? it.text : "",
  };
}

function newPreTask(): PreTask {
  return { id: crypto.randomUUID(), text: "", checked: false };
}

function coercePreTask(it: Partial<PreTask> & { id?: string }): PreTask {
  return {
    id:
      typeof it.id === "string" && it.id.length > 0
        ? it.id
        : crypto.randomUUID(),
    text: typeof it.text === "string" ? it.text : "",
    checked: Boolean(it.checked),
  };
}

/** キャンバス上の前準備専用ノード */
type PreCardData = {
  title: string;
  checked: boolean;
  preTasks: PreTask[];
};

/** SQL 専用カード（sqlFlowBox） */
type SqlCardData = {
  title: string;
  checked: boolean;
  body: string;
};

/** メモ専用カード（memoFlowBox） */
type MemoCardData = {
  title: string;
  checked: boolean;
  body: string;
};

type FlowCanvasNode =
  | Node<FlowBoxData, "flowBox">
  | Node<PreCardData, "preFlowBox">
  | Node<SqlCardData, "sqlFlowBox">
  | Node<MemoCardData, "memoFlowBox">;

const LEGACY_STORAGE_KEY = "flow-app-data";
const PROJECTS_STORAGE_KEY = "flow-app-projects";
const LAST_DIAGNOSE_STORAGE_KEY = "flow-app-last-diagnose";
const AIRTABLE_LAST_SAVED_KEY = "flow-app-airtable-last-saved";

function readAirtableLastSavedMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(AIRTABLE_LAST_SAVED_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) return {};
    return p as Record<string, string>;
  } catch {
    return {};
  }
}

function writeAirtableLastSaved(projectId: string, iso: string) {
  if (typeof window === "undefined") return;
  try {
    const m = { ...readAirtableLastSavedMap(), [projectId]: iso };
    sessionStorage.setItem(AIRTABLE_LAST_SAVED_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

function formatAirtableSavedAt(iso: string | null): string {
  if (!iso) return "まだ保存していません";
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type StoredTask = {
  id: string;
  text: string;
  checked: boolean;
  promptText?: string;
};

type StoredPreTask = {
  id: string;
  text: string;
  checked: boolean;
};

type StoredNode = {
  id: string;
  position: { x: number; y: number };
  /** normal=通常 / pre=前準備 / sql=SQLカード / memo=メモカード（deferred はプロジェクト側） */
  kind?: "normal" | "pre" | "sql" | "memo";
  title: string;
  checked: boolean;
  tasks: StoredTask[];
  promptText?: string;
  /** @deprecated 旧データに残存しうるが読み込み時は無視 */
  prepText?: string;
  preTasks?: StoredPreTask[];
  /** @deprecated 読み込み互換のみ。保存は sqlNotes を使用 */
  sqlText?: string;
  sqlNotes?: { id: string; text: string }[];
  /** kind: sql の本文 */
  sqlCardText?: string;
  /** kind: memo の本文 */
  memoCardText?: string;
};

type StoredPayload = {
  v: 1;
  nodes: StoredNode[];
  edges: Edge[];
};

type DeferredCard = {
  id: string;
  title: string;
  note: string;
  checked: boolean;
};

type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodes: StoredNode[];
  edges: StoredPayload["edges"];
  /** 各タスクのプロンプトに共通で付けたい注意文など */
  sharedPromptMemo?: string;
  /** メインフロー外の「あとで実行」アイデア */
  deferredCards?: DeferredCard[];
};

type ProjectsStore = {
  v: 2;
  projects: ProjectRecord[];
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function newDeferredCard(): DeferredCard {
  return { id: crypto.randomUUID(), title: "", note: "", checked: false };
}

function safeNodePosition(n: Pick<Node, "position">): { x: number; y: number } {
  const p = n.position;
  const x = typeof p?.x === "number" && Number.isFinite(p.x) ? p.x : 0;
  const y = typeof p?.y === "number" && Number.isFinite(p.y) ? p.y : 0;
  return { x, y };
}

/** 同一ソースから出る複数エッジの smoothstep パスをずらして重なりを減らす */
function assignOutgoingEdgeOffsets(edges: Edge[]): Edge[] {
  const bySource = new Map<string, Edge[]>();
  for (const e of edges) {
    if (
      typeof e.source !== "string" ||
      !e.source ||
      typeof e.target !== "string" ||
      !e.target
    ) {
      continue;
    }
    const list = bySource.get(e.source);
    if (list) list.push(e);
    else bySource.set(e.source, [e]);
  }
  const offsetById = new Map<string, number>();
  for (const group of bySource.values()) {
    if (group.length <= 1) {
      offsetById.set(group[0].id, 0);
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const t = a.target.localeCompare(b.target);
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });
    const step = 20;
    sorted.forEach((e, i) => {
      const offset = (i - (sorted.length - 1) / 2) * step;
      offsetById.set(e.id, offset);
    });
  }
  return edges.map((e) => {
    const offset = offsetById.get(e.id) ?? 0;
    return {
      ...e,
      type: (e.type ?? "smoothstep") as Edge["type"],
      pathOptions: { offset },
      style: {
        stroke: "#a78bfa",
        strokeWidth: 2,
        ...(typeof e.style === "object" && e.style && !Array.isArray(e.style)
          ? e.style
          : {}),
      },
    };
  });
}

function parseDeferredCards(raw: unknown): DeferredCard[] {
  if (!Array.isArray(raw)) return [];
  const out: DeferredCard[] = [];
  for (const x of raw) {
    if (!isRecord(x)) continue;
    const id =
      typeof x.id === "string" && x.id.length > 0 ? x.id : crypto.randomUUID();
    out.push({
      id,
      title: typeof x.title === "string" ? x.title : "",
      note: typeof x.note === "string" ? x.note : "",
      checked: Boolean(x.checked),
    });
  }
  return out;
}

function buildProjectRecordFromAirtablePayload(
  raw: Record<string, unknown>,
  fallbackId: string,
  fallbackCreatedAt: string,
): ProjectRecord {
  const pid =
    typeof raw.id === "string" && raw.id.length > 0 ? raw.id : fallbackId;
  return {
    id: pid,
    name: typeof raw.name === "string" ? raw.name : "無題",
    createdAt:
      typeof raw.createdAt === "string" ? raw.createdAt : fallbackCreatedAt,
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : new Date().toISOString(),
    nodes: Array.isArray(raw.nodes) ? (raw.nodes as StoredNode[]) : [],
    edges: Array.isArray(raw.edges)
      ? (raw.edges as ProjectRecord["edges"])
      : [],
    sharedPromptMemo:
      typeof raw.sharedPromptMemo === "string" ? raw.sharedPromptMemo : "",
    deferredCards: parseDeferredCards(raw.deferredCards),
  };
}

function serializePayload(nodes: FlowCanvasNode[], edges: Edge[]): StoredPayload {
  return {
    v: 1,
    nodes: nodes.map((n) => {
      const position = safeNodePosition(n);
      if (n.type === "preFlowBox") {
        const d = n.data as PreCardData;
        return {
          id: n.id,
          position,
          kind: "pre" as const,
          title: typeof d.title === "string" ? d.title : "",
          checked: Boolean(d.checked),
          tasks: [],
          promptText: "",
          sqlNotes: [],
          preTasks: (d.preTasks ?? []).map((pt) => {
            const row = coercePreTask({
              id: pt.id,
              text: pt.text,
              checked: pt.checked,
            });
            return { id: row.id, text: row.text, checked: row.checked };
          }),
        };
      }
      if (n.type === "sqlFlowBox") {
        const d = n.data as SqlCardData;
        return {
          id: n.id,
          position,
          kind: "sql" as const,
          title: typeof d.title === "string" ? d.title : "",
          checked: Boolean(d.checked),
          tasks: [],
          promptText: "",
          sqlNotes: [],
          sqlCardText: typeof d.body === "string" ? d.body : "",
        };
      }
      if (n.type === "memoFlowBox") {
        const d = n.data as MemoCardData;
        return {
          id: n.id,
          position,
          kind: "memo" as const,
          title: typeof d.title === "string" ? d.title : "",
          checked: Boolean(d.checked),
          tasks: [],
          promptText: "",
          sqlNotes: [],
          memoCardText: typeof d.body === "string" ? d.body : "",
        };
      }
      const d = n.data as FlowBoxData;
      return {
        id: n.id,
        position,
        title: typeof d.title === "string" ? d.title : "",
        checked: Boolean(d.checked),
        tasks: (d.items ?? []).map((it) => {
          const row = coerceItem({
            id: it.id,
            text: it.text,
            done: it.done,
            promptText: it.promptText,
          });
          return {
            id: row.id,
            text: row.text,
            checked: row.done,
            promptText: row.promptText,
          };
        }),
        promptText:
          typeof d.promptText === "string" ? d.promptText : "",
        sqlNotes: (d.sqlNotes ?? []).map((sn) => {
          const row = coerceSqlNote({ id: sn.id, text: sn.text });
          return { id: row.id, text: row.text };
        }),
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      type: e.type ?? "smoothstep",
      style: e.style ?? { stroke: "#a78bfa", strokeWidth: 2 },
    })) as Edge[],
  };
}

function parseStored(
  raw: string,
): { nodes: FlowCanvasNode[]; edges: Edge[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.v !== 1) return null;
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;

  const nodes: FlowCanvasNode[] = [];
  for (const n of data.nodes) {
    if (!isRecord(n)) continue;
    const id = typeof n.id === "string" ? n.id : null;
    const pos = n.position;
    if (!id || !isRecord(pos)) continue;
    const x = Number(pos.x);
    const y = Number(pos.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const title = typeof n.title === "string" ? n.title : "";
    const boxChecked = Boolean(n.checked);
    const nodeKind: "normal" | "pre" | "sql" | "memo" =
      n.kind === "pre"
        ? "pre"
        : n.kind === "sql"
          ? "sql"
          : n.kind === "memo"
            ? "memo"
            : n.kind === "normal"
              ? "normal"
              : "normal";

    if (nodeKind === "pre") {
      const preRaw: unknown[] | null = Array.isArray(n.preTasks)
        ? n.preTasks
        : null;
      const preParsed: PreTask[] = [];
      if (preRaw) {
        for (const t of preRaw) {
          if (!isRecord(t)) continue;
          const pid =
            typeof t.id === "string" && t.id.length > 0
              ? t.id
              : crypto.randomUUID();
          const ptext = typeof t.text === "string" ? t.text : "";
          const pchecked = Boolean(
            t.checked !== undefined
              ? t.checked
              : typeof t.done === "boolean"
                ? t.done
                : false,
          );
          preParsed.push(coercePreTask({ id: pid, text: ptext, checked: pchecked }));
        }
      }
      const finalPre =
        preParsed.length > 0 ? preParsed.map((p) => coercePreTask(p)) : [newPreTask()];
      nodes.push({
        id,
        type: "preFlowBox",
        position: { x, y },
        data: {
          title,
          checked: boxChecked,
          preTasks: finalPre,
        },
      });
      continue;
    }

    if (nodeKind === "sql") {
      const body =
        typeof n.sqlCardText === "string"
          ? n.sqlCardText
          : typeof n.sqlText === "string"
            ? n.sqlText
            : "";
      nodes.push({
        id,
        type: "sqlFlowBox",
        position: { x, y },
        data: {
          title,
          checked: boxChecked,
          body,
        },
      });
      continue;
    }

    if (nodeKind === "memo") {
      const body =
        typeof n.memoCardText === "string" ? n.memoCardText : "";
      nodes.push({
        id,
        type: "memoFlowBox",
        position: { x, y },
        data: {
          title,
          checked: boxChecked,
          body,
        },
      });
      continue;
    }

    let tasksRaw: unknown[] | null = Array.isArray(n.tasks) ? n.tasks : null;
    if (!tasksRaw && Array.isArray(n.items)) tasksRaw = n.items;
    if (!tasksRaw) tasksRaw = [];
    const items: FlowItem[] = [];
    for (const t of tasksRaw) {
      if (!isRecord(t)) continue;
      const tid =
        typeof t.id === "string" && t.id.length > 0
          ? t.id
          : crypto.randomUUID();
      const text = typeof t.text === "string" ? t.text : "";
      const taskChecked = Boolean(
        t.checked !== undefined
          ? t.checked
          : typeof t.done === "boolean"
            ? t.done
            : false,
      );
      const taskPrompt =
        typeof t.promptText === "string" ? t.promptText : "";
      items.push(
        coerceItem({
          id: tid,
          text,
          done: taskChecked,
          promptText: taskPrompt,
        }),
      );
    }
    const finalItems = (items.length > 0 ? items : [newItem()]).map((it) =>
      coerceItem(it),
    );
    const promptText =
      typeof n.promptText === "string" ? n.promptText : "";
    const sqlNotesRaw: unknown[] | null = Array.isArray(n.sqlNotes)
      ? n.sqlNotes
      : null;
    const sqlNotesParsed: SqlNote[] = [];
    if (sqlNotesRaw) {
      for (const s of sqlNotesRaw) {
        if (!isRecord(s)) continue;
        const sid =
          typeof s.id === "string" && s.id.length > 0
            ? s.id
            : crypto.randomUUID();
        const stext = typeof s.text === "string" ? s.text : "";
        sqlNotesParsed.push(coerceSqlNote({ id: sid, text: stext }));
      }
    }
    let finalSqlNotes = sqlNotesParsed;
    if (finalSqlNotes.length === 0) {
      const legacySql =
        typeof n.sqlText === "string" ? n.sqlText.trim() : "";
      if (legacySql.length > 0) {
        finalSqlNotes = [
          coerceSqlNote({
            id: crypto.randomUUID(),
            text: legacySql,
          }),
        ];
      } else {
        finalSqlNotes = [newSqlNote()];
      }
    }
    nodes.push({
      id,
      type: "flowBox",
      position: { x, y },
      data: {
        title,
        checked: boxChecked,
        items: finalItems,
        promptText,
        sqlNotes: finalSqlNotes,
      },
    });
  }

  const edges: Edge[] = [];
  for (const e of data.edges) {
    if (!isRecord(e)) continue;
    const source = typeof e.source === "string" ? e.source : "";
    const target = typeof e.target === "string" ? e.target : "";
    if (!source || !target) continue;
    const id =
      typeof e.id === "string" && e.id.length > 0
        ? e.id
        : `${source}-${target}-${edges.length}`;
    edges.push({
      id,
      source,
      target,
      sourceHandle:
        e.sourceHandle === null
          ? undefined
          : typeof e.sourceHandle === "string"
            ? e.sourceHandle
            : undefined,
      targetHandle:
        e.targetHandle === null
          ? undefined
          : typeof e.targetHandle === "string"
            ? e.targetHandle
            : undefined,
      type: typeof e.type === "string" ? e.type : "smoothstep",
      style: isRecord(e.style)
        ? (e.style as Edge["style"])
        : { stroke: "#a78bfa", strokeWidth: 2 },
    });
  }

  return { nodes, edges: assignOutgoingEdgeOffsets(edges) };
}

function parseProjectRecordFlow(
  p: Pick<ProjectRecord, "nodes" | "edges">,
): { nodes: FlowCanvasNode[]; edges: Edge[] } | null {
  return parseStored(
    JSON.stringify({ v: 1, nodes: p.nodes, edges: p.edges }),
  );
}

function parseProjectsStore(raw: string | null): ProjectsStore | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.v !== 2 || !Array.isArray(data.projects)) {
    return null;
  }
  const projects: ProjectRecord[] = [];
  for (const pr of data.projects) {
    if (!isRecord(pr)) continue;
    const id = typeof pr.id === "string" ? pr.id : null;
    const name = typeof pr.name === "string" ? pr.name : "無題";
    const createdAt =
      typeof pr.createdAt === "string" ? pr.createdAt : new Date().toISOString();
    const updatedAt =
      typeof pr.updatedAt === "string" ? pr.updatedAt : createdAt;
    if (!id) continue;
    const nodes = Array.isArray(pr.nodes) ? (pr.nodes as StoredNode[]) : [];
    const edges = Array.isArray(pr.edges) ? (pr.edges as StoredPayload["edges"]) : [];
    const sharedPromptMemo =
      typeof pr.sharedPromptMemo === "string" ? pr.sharedPromptMemo : "";
    const deferredCards = parseDeferredCards(pr.deferredCards);
    projects.push({
      id,
      name,
      createdAt,
      updatedAt,
      nodes,
      edges,
      sharedPromptMemo,
      deferredCards,
    });
  }
  return { v: 2, projects };
}

function loadInitialProjects(): ProjectRecord[] {
  try {
    const raw2 = localStorage.getItem(PROJECTS_STORAGE_KEY);
    const store2 = parseProjectsStore(raw2);
    if (store2) {
      return store2.projects;
    }
    const raw1 = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw1) {
      const flow = parseStored(raw1);
      if (flow) {
        const ser = serializePayload(flow.nodes, flow.edges);
        const now = new Date().toISOString();
        const migrated: ProjectRecord = {
          id: crypto.randomUUID(),
          name: "以前のプロジェクト",
          createdAt: now,
          updatedAt: now,
          nodes: ser.nodes,
          edges: ser.edges,
          sharedPromptMemo: "",
          deferredCards: [],
        };
        const next: ProjectsStore = { v: 2, projects: [migrated] };
        localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(next));
        return [migrated];
      }
    }
  } catch {
    /* ignore */
  }
  return [];
}

function writeProjectsStore(projects: ProjectRecord[]) {
  const store: ProjectsStore = { v: 2, projects };
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(store));
}

function formatUpdatedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function nodeDisplayTitle(n: FlowCanvasNode): string {
  const t = n.data?.title?.trim();
  const base = t && t.length > 0 ? t : `（無題・${n.id.slice(0, 8)}）`;
  if (n.type === "preFlowBox") return `［前準備］${base}`;
  if (n.type === "sqlFlowBox") return `［SQL］${base}`;
  if (n.type === "memoFlowBox") return `［メモ］${base}`;
  return base;
}

function buildDiagnoseDocument(
  projectName: string,
  sharedPromptMemo: string,
  deferredCards: DeferredCard[],
  nodes: FlowCanvasNode[],
  edges: Edge[],
): string {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const lines: string[] = [];

  lines.push("【プロジェクト名】");
  lines.push(projectName.trim() || "（無題）");
  lines.push("");
  lines.push("【共通プロンプトメモ】");
  {
    const m = sharedPromptMemo.trim();
    lines.push(m.length > 0 ? m : "（なし）");
  }
  lines.push("");
  lines.push("【後から実行】");
  if (deferredCards.length === 0) {
    lines.push("（カードなし）");
  } else {
    deferredCards.forEach((c, i) => {
      const mark = c.checked ? "[x]" : "[ ]";
      const t = c.title?.trim() || "（無題）";
      lines.push(`${i + 1}. ${mark} ${t}`);
      const n = (c.note ?? "").trim();
      lines.push(n.length > 0 ? `   メモ: ${n.replace(/\n/g, "\n   ")}` : "   メモ: （なし）");
    });
  }
  lines.push("");
  lines.push("【全体フロー】");
  if (nodes.length === 0) {
    lines.push("ボックスがありません。");
  } else {
    lines.push(`ボックス数: ${nodes.length}`);
    lines.push("接続関係:");
    if (edges.length === 0) {
      lines.push("（接続なし）");
    } else {
      for (const e of edges) {
        const s = byId.get(e.source);
        const t = byId.get(e.target);
        const sa = s
          ? nodeDisplayTitle(s)
          : `不明（${e.source.slice(0, 8)}…）`;
        const ta = t
          ? nodeDisplayTitle(t)
          : `不明（${e.target.slice(0, 8)}…）`;
        lines.push(`・「${sa}」 → 「${ta}」`);
      }
    }
    lines.push("");
    lines.push("ボックス一覧（配列順・参考）:");
    nodes.forEach((n, i) => {
      lines.push(`${i + 1}. ${nodeDisplayTitle(n)}`);
    });
  }
  lines.push("");

  nodes.forEach((n, i) => {
    const title = n.data?.title?.trim() || "（無題）";
    if (n.type === "preFlowBox") {
      const d = n.data as PreCardData;
      lines.push(`【前準備カード${i + 1}】`);
      lines.push(`タイトル：${title}`);
      lines.push(`完了：${d.checked ? "はい" : "いいえ"}`);
      lines.push("前準備タスク：");
      const plist = d.preTasks ?? [];
      if (plist.length === 0) {
        lines.push("（なし）");
      } else {
        for (const pt of plist) {
          const mark = pt.checked ? "[x]" : "[ ]";
          lines.push(
            `- ${mark} ${pt.text?.trim() ? pt.text : "（空）"}`,
          );
        }
      }
      lines.push("");
      return;
    }
    if (n.type === "sqlFlowBox") {
      const d = n.data as SqlCardData;
      lines.push(`【SQLカード${i + 1}】`);
      lines.push(`タイトル：${title}`);
      lines.push(`完了：${d.checked ? "はい" : "いいえ"}`);
      lines.push("SQL：");
      const sqlBody = (d.body ?? "").trim();
      lines.push(sqlBody.length > 0 ? sqlBody : "（空）");
      lines.push("");
      return;
    }
    if (n.type === "memoFlowBox") {
      const d = n.data as MemoCardData;
      lines.push(`【メモカード${i + 1}】`);
      lines.push(`タイトル：${title}`);
      lines.push(`完了：${d.checked ? "はい" : "いいえ"}`);
      lines.push("メモ：");
      const memoBody = (d.body ?? "").trim();
      lines.push(memoBody.length > 0 ? memoBody : "（空）");
      lines.push("");
      return;
    }
    const d = n.data as FlowBoxData;
    lines.push(`【ボックス${i + 1}】`);
    lines.push(`タイトル：${title}`);
    lines.push(`完了：${d.checked ? "はい" : "いいえ"}`);
    lines.push("タスク：");
    const items = d.items ?? [];
    if (items.length === 0) {
      lines.push("（タスクなし）");
    } else {
      for (const it of items) {
        const mark = it.done ? "[x]" : "[ ]";
        lines.push(
          `- ${mark} ${it.text?.trim() ? it.text : "（空）"}`,
        );
        const taskPrompt =
          typeof it.promptText === "string" ? it.promptText.trim() : "";
        if (taskPrompt.length > 0) {
          lines.push("  実装プロンプト：");
          lines.push(`  ${taskPrompt.replace(/\n/g, "\n  ")}`);
        } else {
          lines.push("  実装プロンプト：（なし）");
        }
      }
    }
    const sqlList = d.sqlNotes ?? [];
    lines.push("");
    lines.push("SQL：");
    if (sqlList.length === 0) {
      lines.push("（なし）");
    } else {
      sqlList.forEach((sn, j) => {
        const body = (sn.text ?? "").trim();
        lines.push(`--- ブロック${j + 1} ---`);
        lines.push(body.length > 0 ? body : "（空）");
      });
    }
    const boxMemo = (d.promptText ?? "").trim();
    lines.push("");
    lines.push("メモ：");
    lines.push(boxMemo.length > 0 ? boxMemo : "（なし）");
    lines.push("");
  });

  return lines.join("\n");
}

/** Gemini が「1. 2. 3.」見出しで返した本文を3ブロックに分割（微妙な表記差にも多少耐える） */
function parseDiagnoseSections(raw: string): {
  errors: string;
  fixes: string;
  advice: string;
  ok: boolean;
} {
  const t = raw.replace(/\r\n/g, "\n").trim();
  const rx1 = /1\.\s*エラーになりそうな箇所\s*/;
  const rx2 = /2\.\s*修正点\s*/;
  const rx3 = /3\.\s*助言\s*/;
  const p1 = t.search(rx1);
  const p2 = t.search(rx2);
  const p3 = t.search(rx3);
  if (p1 === -1 || p2 === -1 || p3 === -1 || !(p1 < p2 && p2 < p3)) {
    return { errors: "", fixes: "", advice: "", ok: false };
  }
  const m1 = t.slice(p1).match(rx1);
  const m2 = t.slice(p2).match(rx2);
  const m3 = t.slice(p3).match(rx3);
  if (!m1 || !m2 || !m3) {
    return { errors: "", fixes: "", advice: "", ok: false };
  }
  const e1 = p1 + m1[0].length;
  const e2 = p2 + m2[0].length;
  const e3 = p3 + m3[0].length;
  return {
    errors: t.slice(e1, p2).trim(),
    fixes: t.slice(e2, p3).trim(),
    advice: t.slice(e3).trim(),
    ok: true,
  };
}

function DiagnoseResultPanelBody({
  output,
}: {
  output: string;
}) {
  const parsed = parseDiagnoseSections(output);
  if (!parsed.ok) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-zinc-500">
          見出し形式で分割できなかったため、全文を表示しています。
        </p>
        <pre className="max-h-[min(70vh,36rem)] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-xl border border-[#2e3544] bg-[#1a1d24]/70 p-5 font-sans text-[14px] leading-[1.75] text-zinc-300 ring-1 ring-black/20">
          {output}
        </pre>
      </div>
    );
  }

  const blocks: { title: string; body: string }[] = [
    { title: "エラーになりそうな箇所", body: parsed.errors },
    { title: "修正点", body: parsed.fixes },
    { title: "助言", body: parsed.advice },
  ];

  return (
    <div className="space-y-6">
      {blocks.map((b, i) => (
        <section
          key={b.title}
          className="scroll-mt-4 rounded-xl border border-[#2e3544] bg-[#1a1d24]/70 p-5 shadow-inner ring-1 ring-black/20"
        >
          <h3 className="mb-4 flex items-center gap-3 border-l-2 border-[#a78bfa] pl-3 text-[15px] font-semibold tracking-tight text-zinc-50">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#2a2540] text-xs font-bold text-[#d4c4ff] ring-1 ring-[#5b4a8a]/50">
              {i + 1}
            </span>
            {b.title}
          </h3>
          <div className="whitespace-pre-wrap break-words pl-1 text-[14px] leading-[1.75] text-zinc-300">
            {b.body || "特になし"}
          </div>
        </section>
      ))}
    </div>
  );
}

const SetNodesContext =
  createContext<Dispatch<SetStateAction<FlowCanvasNode[]>> | null>(null);

const DeleteFlowCardContext = createContext<((nodeId: string) => void) | null>(
  null,
);

function FlowBoxSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[#2c3140] bg-gradient-to-b from-[#181b22]/95 to-[#12151c]/95 px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-black/25">
      <h3 className="mb-3 border-b border-[#343b4d] pb-2.5 text-[12px] font-semibold tracking-wide text-[#c8b4fc]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FlowBoxNode({ id, data }: NodeProps<Node<FlowBoxData>>) {
  const setNodes = useContext(SetNodesContext);
  const deleteFlowCard = useContext(DeleteFlowCardContext);
  if (!setNodes) {
    throw new Error("SetNodesContext is not available");
  }
  if (!deleteFlowCard) {
    throw new Error("DeleteFlowCardContext is not available");
  }

  const updateData = (updater: (d: FlowBoxData) => FlowBoxData) => {
    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id && n.type === "flowBox"
          ? { ...n, data: updater(n.data as FlowBoxData) }
          : n,
      ),
    );
  };

  const seedId = `${id}__item-seed`;
  const rawItems = data.items ?? [];
  const resolvedItems =
    rawItems.length > 0
      ? rawItems.map(coerceItem)
      : [{ id: seedId, text: "", done: false, promptText: "" }];

  const ensureItems = (d: FlowBoxData): FlowItem[] => {
    const arr = d.items ?? [];
    const base =
      arr.length > 0
        ? arr.map(coerceItem)
        : [{ id: seedId, text: "", done: false, promptText: "" }];
    return base;
  };

  return (
    <div className="relative w-[300px] rounded-2xl border border-[#2e3544] bg-[#1a1d24] px-4 py-4 shadow-[0_20px_56px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.06] backdrop-blur-sm">
      <button
        type="button"
        className="nodrag nopan absolute right-2 top-2 z-10 rounded-md border border-transparent px-2 py-0.5 text-[10px] font-medium text-zinc-500 transition hover:border-red-900/40 hover:bg-red-950/40 hover:text-red-400"
        aria-label="このカードを削除"
        onClick={() => {
          if (
            !window.confirm(
              "このカードを削除しますか？\n接続されている線も削除されます。\n（取り消せません）",
            )
          ) {
            return;
          }
          deleteFlowCard(id);
        }}
      >
        カード削除
      </button>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-[#1a1d24] !bg-[#a78bfa]"
      />
      <input
        type="text"
        value={data.title ?? ""}
        onChange={(e) =>
          updateData((d) => ({ ...d, title: e.target.value }))
        }
        placeholder="タイトル"
        className="nodrag nopan mb-3 w-full rounded-xl border border-[#3d4454] bg-[#22262f] py-2.5 pr-16 pl-3 text-base font-semibold tracking-tight text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-[#7c6bb0] focus:ring-2 focus:ring-[#7c6bb0]/35"
      />
      <label className="nodrag nopan mb-4 flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#353b4a] bg-[#22262f] px-3 py-2 text-[13px] font-medium text-zinc-300 select-none">
        <input
          type="checkbox"
          checked={Boolean(data.checked)}
          onChange={(e) =>
            updateData((d) => ({ ...d, checked: e.target.checked }))
          }
          className="size-4 rounded border-[#4b5363] bg-[#1a1d24] accent-[#8b5cf6]"
        />
        完了
      </label>

      <div className="nodrag nopan flex flex-col gap-3">
        <FlowBoxSection title="タスク">
          <div className="flex flex-col gap-3">
            {resolvedItems.map((item, index) => (
              <div key={item.id} className="flex flex-col gap-2">
                {index > 0 ? (
                  <div
                    className="pointer-events-none flex justify-center py-0.5 text-sm font-semibold text-[#b8a1ff]"
                    aria-hidden
                  >
                    ↓
                  </div>
                ) : null}
                <div
                  className={`overflow-hidden rounded-xl border transition ${
                    item.done
                      ? "border-[#333948] bg-[#1e222b] opacity-[0.52]"
                      : "border-[#3d4454] bg-[#262a34]"
                  }`}
                >
                  <div className="flex items-start gap-2 px-2.5 py-2.5">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() =>
                        updateData((d) => ({
                          ...d,
                          items: ensureItems(d).map((it) =>
                            it.id === item.id ? { ...it, done: !it.done } : it,
                          ),
                        }))
                      }
                      className="nodrag nopan mt-0.5 size-4 shrink-0 rounded border-[#4b5363] bg-[#1a1d24] accent-[#8b5cf6]"
                      aria-label="タスク完了"
                    />
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateData((d) => ({
                          ...d,
                          items: ensureItems(d).map((it) =>
                            it.id === item.id ? { ...it, text: v } : it,
                          ),
                        }));
                      }}
                      placeholder="タスク"
                      className={`nodrag nopan min-w-0 flex-1 bg-transparent py-0.5 text-[14px] leading-snug placeholder:text-zinc-500 outline-none ${
                        item.done
                          ? "text-zinc-500 line-through decoration-zinc-500"
                          : "text-zinc-100"
                      }`}
                    />
                    <button
                      type="button"
                      className="nodrag nopan shrink-0 rounded-md border border-transparent px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 transition hover:border-red-900/40 hover:bg-red-950/35 hover:text-red-400"
                      aria-label="このタスクを削除"
                      onClick={() => {
                        if (
                          !window.confirm(
                            "このタスクを削除しますか？\n（取り消せません）",
                          )
                        ) {
                          return;
                        }
                        updateData((d) => ({
                          ...d,
                          items: ensureItems(d).filter((it) => it.id !== item.id),
                        }));
                      }}
                    >
                      削除
                    </button>
                  </div>
                  <div className="border-t border-[#2f3543] bg-[#1a1e28]/95 px-2.5 py-2 ring-1 ring-inset ring-black/20">
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                      実装プロンプト
                    </p>
                    <textarea
                      value={item.promptText ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateData((d) => ({
                          ...d,
                          items: ensureItems(d).map((it) =>
                            it.id === item.id ? { ...it, promptText: v } : it,
                          ),
                        }));
                      }}
                      placeholder="このタスクを実装するためのプロンプトを書いてください"
                      rows={5}
                      className="nodrag nopan min-h-[6.5rem] w-full resize-y rounded-lg border border-[#353b4a] bg-[#22262f] px-2.5 py-2 text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-[#7c6bb0]/55 focus:ring-1 focus:ring-[#7c6bb0]/35"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              updateData((d) => ({
                ...d,
                items: [...ensureItems(d), newItem()],
              }))
            }
            className="nodrag nopan mt-3 w-full rounded-xl border border-dashed border-[#454c5c] bg-[#22262f]/80 px-3 py-2 text-[13px] font-medium text-zinc-400 transition hover:border-[#7c6bb0]/55 hover:bg-[#262a34] hover:text-zinc-200"
          >
            ＋ 項目追加
          </button>
        </FlowBoxSection>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-[#1a1d24] !bg-[#a78bfa]"
      />
    </div>
  );
}

function PreFlowBoxNode({
  id,
  data,
}: NodeProps<Node<PreCardData, "preFlowBox">>) {
  const setNodes = useContext(SetNodesContext);
  const deleteFlowCard = useContext(DeleteFlowCardContext);
  if (!setNodes) {
    throw new Error("SetNodesContext is not available");
  }
  if (!deleteFlowCard) {
    throw new Error("DeleteFlowCardContext is not available");
  }

  const updateData = (updater: (d: PreCardData) => PreCardData) => {
    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id && n.type === "preFlowBox"
          ? { ...n, data: updater(n.data as PreCardData) }
          : n,
      ),
    );
  };

  const preSeedId = `${id}__pre-seed`;
  const rawPre = data.preTasks ?? [];
  const resolvedPreTasks =
    rawPre.length > 0
      ? rawPre.map((pt) => coercePreTask(pt))
      : [{ id: preSeedId, text: "", checked: false }];

  const ensurePreTasks = (d: PreCardData): PreTask[] => {
    const arr = d.preTasks ?? [];
    return arr.length > 0
      ? arr.map((pt) => coercePreTask(pt))
      : [{ id: preSeedId, text: "", checked: false }];
  };

  return (
    <div className="relative w-[300px] rounded-2xl border border-[#1e4a3d] bg-gradient-to-b from-[#0f1f1a] to-[#0c1815] px-4 py-4 shadow-[0_20px_56px_rgba(0,0,0,0.5)] ring-1 ring-[#22c55e]/20 backdrop-blur-sm">
      <button
        type="button"
        className="nodrag nopan absolute right-2 top-2 z-10 rounded-md border border-transparent px-2 py-0.5 text-[10px] font-medium text-emerald-700/90 transition hover:border-red-900/45 hover:bg-red-950/40 hover:text-red-400"
        aria-label="この前準備カードを削除"
        onClick={() => {
          if (
            !window.confirm(
              "この前準備カードを削除しますか？\n接続されている線も削除されます。\n（取り消せません）",
            )
          ) {
            return;
          }
          deleteFlowCard(id);
        }}
      >
        カード削除
      </button>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-[#0f1f1a] !bg-[#34d399]"
      />
      <p className="mb-2 pr-14 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400/90">
        前準備カード
      </p>
      <input
        type="text"
        value={data.title ?? ""}
        onChange={(e) =>
          updateData((d) => ({ ...d, title: e.target.value }))
        }
        placeholder="タイトル"
        className="nodrag nopan mb-3 w-full rounded-xl border border-[#2a5c4a] bg-[#14221c] py-2.5 pr-16 pl-3 text-base font-semibold tracking-tight text-emerald-50 placeholder:text-emerald-700/80 outline-none transition focus:border-[#34d399]/55 focus:ring-2 focus:ring-[#34d399]/25"
      />
      <label className="nodrag nopan mb-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#2a4a3d] bg-[#14221c] px-3 py-2 text-[13px] font-medium text-emerald-100/90 select-none">
        <input
          type="checkbox"
          checked={Boolean(data.checked)}
          onChange={(e) =>
            updateData((d) => ({ ...d, checked: e.target.checked }))
          }
          className="size-4 rounded border-[#3d6b58] bg-[#0f1a16] accent-[#22c55e]"
        />
        完了
      </label>
      <div className="nodrag nopan flex flex-col gap-2">
        {resolvedPreTasks.map((pt, index) => (
          <div key={pt.id}>
            {index > 0 ? (
              <div
                className="mb-2 h-px bg-gradient-to-r from-transparent via-[#2d5a48] to-transparent"
                aria-hidden
              />
            ) : null}
            <div
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 transition ${
                pt.checked
                  ? "border-[#2a4038] bg-[#0f1a16]/90 opacity-[0.72]"
                  : "border-[#2d5244] bg-[#132820]/95"
              }`}
            >
              <input
                type="checkbox"
                checked={pt.checked}
                onChange={() =>
                  updateData((d) => ({
                    ...d,
                    preTasks: ensurePreTasks(d).map((p) =>
                      p.id === pt.id ? { ...p, checked: !p.checked } : p,
                    ),
                  }))
                }
                className="nodrag nopan mt-0.5 size-4 shrink-0 rounded border-[#3d6b58] bg-[#0f1a16] accent-[#22c55e]"
                aria-label="前準備タスクの完了"
              />
              <input
                type="text"
                value={pt.text}
                onChange={(e) => {
                  const v = e.target.value;
                  updateData((d) => ({
                    ...d,
                    preTasks: ensurePreTasks(d).map((p) =>
                      p.id === pt.id ? { ...p, text: v } : p,
                    ),
                  }));
                }}
                placeholder="前準備タスク"
                className={`nodrag nopan min-w-0 flex-1 bg-transparent py-0.5 text-[13px] leading-snug placeholder:text-emerald-800/90 outline-none ${
                  pt.checked
                    ? "text-emerald-700 line-through decoration-emerald-700"
                    : "text-emerald-100"
                }`}
              />
              <button
                type="button"
                className="nodrag nopan shrink-0 rounded-md border border-transparent px-1.5 py-0.5 text-[10px] font-medium text-emerald-700/90 transition hover:border-red-900/50 hover:bg-red-950/40 hover:text-red-400"
                aria-label="この前準備タスクを削除"
                onClick={() => {
                  if (
                    !window.confirm(
                      "この前準備タスクを削除しますか？\n（取り消せません）",
                    )
                  ) {
                    return;
                  }
                  updateData((d) => ({
                    ...d,
                    preTasks: ensurePreTasks(d).filter((p) => p.id !== pt.id),
                  }));
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          updateData((d) => ({
            ...d,
            preTasks: [...ensurePreTasks(d), newPreTask()],
          }))
        }
        className="nodrag nopan mt-3 w-full rounded-xl border border-dashed border-[#2d5c48] bg-[#14221c]/90 px-3 py-2 text-[13px] font-medium text-emerald-300/80 transition hover:border-[#34d399]/45 hover:bg-[#183028] hover:text-emerald-100"
      >
        前準備追加
      </button>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-[#0f1f1a] !bg-[#34d399]"
      />
    </div>
  );
}

function SqlFlowBoxNode({
  id,
  data,
}: NodeProps<Node<SqlCardData, "sqlFlowBox">>) {
  const setNodes = useContext(SetNodesContext);
  const deleteFlowCard = useContext(DeleteFlowCardContext);
  if (!setNodes) {
    throw new Error("SetNodesContext is not available");
  }
  if (!deleteFlowCard) {
    throw new Error("DeleteFlowCardContext is not available");
  }

  const updateData = (updater: (d: SqlCardData) => SqlCardData) => {
    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id && n.type === "sqlFlowBox"
          ? { ...n, data: updater(n.data as SqlCardData) }
          : n,
      ),
    );
  };

  return (
    <div className="relative w-[300px] rounded-2xl border border-[#1e4a6e] bg-gradient-to-b from-[#0f1a28] to-[#0c1520] px-4 py-4 shadow-[0_20px_56px_rgba(0,0,0,0.5)] ring-1 ring-[#38bdf8]/18 backdrop-blur-sm">
      <button
        type="button"
        className="nodrag nopan absolute right-2 top-2 z-10 rounded-md border border-transparent px-2 py-0.5 text-[10px] font-medium text-sky-700/90 transition hover:border-red-900/45 hover:bg-red-950/40 hover:text-red-400"
        aria-label="このSQLカードを削除"
        onClick={() => {
          if (
            !window.confirm(
              "このSQLカードを削除しますか？\n接続されている線も削除されます。\n（取り消せません）",
            )
          ) {
            return;
          }
          deleteFlowCard(id);
        }}
      >
        カード削除
      </button>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-[#0f1a28] !bg-[#38bdf8]"
      />
      <p className="mb-2 pr-14 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-400/90">
        SQLカード
      </p>
      <input
        type="text"
        value={data.title ?? ""}
        onChange={(e) =>
          updateData((d) => ({ ...d, title: e.target.value }))
        }
        placeholder="タイトル"
        className="nodrag nopan mb-3 w-full rounded-xl border border-[#2a4f6e] bg-[#121f2e] py-2.5 pr-16 pl-3 text-base font-semibold tracking-tight text-sky-50 placeholder:text-sky-800/80 outline-none transition focus:border-[#38bdf8]/55 focus:ring-2 focus:ring-[#38bdf8]/25"
      />
      <label className="nodrag nopan mb-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#2a4a5e] bg-[#121f2e] px-3 py-2 text-[13px] font-medium text-sky-100/90 select-none">
        <input
          type="checkbox"
          checked={Boolean(data.checked)}
          onChange={(e) =>
            updateData((d) => ({ ...d, checked: e.target.checked }))
          }
          className="size-4 rounded border-[#3d6b8a] bg-[#0f1824] accent-[#38bdf8]"
        />
        完了
      </label>
      <textarea
        value={data.body ?? ""}
        onChange={(e) =>
          updateData((d) => ({ ...d, body: e.target.value }))
        }
        placeholder="SQLを入力してください"
        rows={8}
        spellCheck={false}
        className="nodrag nopan min-h-[7rem] w-full resize-y rounded-xl border border-[#2a4f6e] bg-[#0c141f] px-3 py-2.5 font-mono text-[12px] leading-relaxed text-sky-100 placeholder:text-sky-800/75 outline-none ring-1 ring-[#38bdf8]/10 transition focus:border-[#38bdf8]/50 focus:ring-2 focus:ring-[#38bdf8]/22"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-[#0f1a28] !bg-[#38bdf8]"
      />
    </div>
  );
}

function MemoFlowBoxNode({
  id,
  data,
}: NodeProps<Node<MemoCardData, "memoFlowBox">>) {
  const setNodes = useContext(SetNodesContext);
  const deleteFlowCard = useContext(DeleteFlowCardContext);
  if (!setNodes) {
    throw new Error("SetNodesContext is not available");
  }
  if (!deleteFlowCard) {
    throw new Error("DeleteFlowCardContext is not available");
  }

  const updateData = (updater: (d: MemoCardData) => MemoCardData) => {
    setNodes((nodes) =>
      nodes.map((n) =>
        n.id === id && n.type === "memoFlowBox"
          ? { ...n, data: updater(n.data as MemoCardData) }
          : n,
      ),
    );
  };

  return (
    <div className="relative w-[300px] rounded-2xl border border-[#5c4a2a] bg-gradient-to-b from-[#1a1710] to-[#12100c] px-4 py-4 shadow-[0_20px_56px_rgba(0,0,0,0.5)] ring-1 ring-amber-600/15 backdrop-blur-sm">
      <button
        type="button"
        className="nodrag nopan absolute right-2 top-2 z-10 rounded-md border border-transparent px-2 py-0.5 text-[10px] font-medium text-amber-800/90 transition hover:border-red-900/45 hover:bg-red-950/40 hover:text-red-400"
        aria-label="このメモカードを削除"
        onClick={() => {
          if (
            !window.confirm(
              "このメモカードを削除しますか？\n接続されている線も削除されます。\n（取り消せません）",
            )
          ) {
            return;
          }
          deleteFlowCard(id);
        }}
      >
        カード削除
      </button>
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-[#12100c] !bg-[#f59e0b]"
      />
      <p className="mb-2 pr-14 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-400/90">
        メモカード
      </p>
      <input
        type="text"
        value={data.title ?? ""}
        onChange={(e) =>
          updateData((d) => ({ ...d, title: e.target.value }))
        }
        placeholder="タイトル"
        className="nodrag nopan mb-3 w-full rounded-xl border border-[#4a3f2a] bg-[#1c1812] py-2.5 pr-16 pl-3 text-base font-semibold tracking-tight text-amber-50 placeholder:text-amber-900/60 outline-none transition focus:border-[#d97706]/45 focus:ring-2 focus:ring-[#f59e0b]/22"
      />
      <label className="nodrag nopan mb-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#4a3f2a] bg-[#1c1812] px-3 py-2 text-[13px] font-medium text-amber-100/90 select-none">
        <input
          type="checkbox"
          checked={Boolean(data.checked)}
          onChange={(e) =>
            updateData((d) => ({ ...d, checked: e.target.checked }))
          }
          className="size-4 rounded border-[#6b5a3d] bg-[#14110c] accent-[#f59e0b]"
        />
        完了
      </label>
      <textarea
        value={data.body ?? ""}
        onChange={(e) =>
          updateData((d) => ({ ...d, body: e.target.value }))
        }
        placeholder="メモを入力してください"
        rows={8}
        className="nodrag nopan min-h-[7rem] w-full resize-y rounded-xl border border-[#4a3f2a] bg-[#14110c] px-3 py-2.5 text-[13px] leading-relaxed text-amber-50/95 placeholder:text-amber-900/55 outline-none ring-1 ring-amber-900/25 transition focus:border-[#d97706]/45 focus:ring-2 focus:ring-[#f59e0b]/20"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-[#12100c] !bg-[#f59e0b]"
      />
    </div>
  );
}

function DeferredExecuteSidebar({
  cards,
  onCardsChange,
}: {
  cards: DeferredCard[];
  onCardsChange: (next: DeferredCard[]) => void;
}) {
  const patch = (id: string, part: Partial<DeferredCard>) => {
    onCardsChange(cards.map((c) => (c.id === id ? { ...c, ...part } : c)));
  };

  return (
    <aside className="flex h-full w-[min(100%,17.5rem)] shrink-0 flex-col border-r border-[#2a3242] bg-[#0c0e12] shadow-[inset_-1px_0_0_rgba(255,255,255,0.03)] sm:w-72">
      <div className="shrink-0 border-b border-[#2e3544] px-3 py-3">
        <h2 className="text-[13px] font-semibold tracking-wide text-amber-200/90">
          後から実行
        </h2>
        <p className="mt-1 text-[10px] leading-snug text-zinc-500">
          メインフローとは別枠のメモです
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {cards.length === 0 ? (
          <p className="mb-2 text-center text-[11px] text-zinc-600">
            カードはまだありません
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {cards.map((c) => (
              <li
                key={c.id}
                className={`rounded-xl border px-3 py-2.5 shadow-sm ring-1 ring-black/30 transition ${
                  c.checked
                    ? "border-[#353b48] bg-[#161a22] opacity-[0.7]"
                    : "border-[#403528] bg-[#1a1714]"
                }`}
              >
                <input
                  type="text"
                  value={c.title}
                  onChange={(e) => patch(c.id, { title: e.target.value })}
                  placeholder="タイトル"
                  className="mb-2 w-full rounded-lg border border-[#3d4454] bg-[#22262f] px-2.5 py-1.5 text-[13px] font-medium text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-[#a16207]/55 focus:ring-1 focus:ring-amber-900/35"
                />
                <textarea
                  value={c.note}
                  onChange={(e) => patch(c.id, { note: e.target.value })}
                  placeholder="メモ"
                  rows={3}
                  className="mb-2 w-full resize-y rounded-lg border border-[#3d4454] bg-[#22262f]/90 px-2.5 py-2 text-[12px] leading-relaxed text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-[#a16207]/55 focus:ring-1 focus:ring-amber-900/35"
                />
                <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-zinc-400 select-none">
                  <input
                    type="checkbox"
                    checked={c.checked}
                    onChange={() => patch(c.id, { checked: !c.checked })}
                    className="size-3.5 rounded border-[#4b5363] bg-[#1a1d24] accent-amber-600"
                  />
                  完了
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      !window.confirm(
                        "この後から実行カードを削除しますか？\n（取り消せません）",
                      )
                    ) {
                      return;
                    }
                    onCardsChange(cards.filter((x) => x.id !== c.id));
                  }}
                  className="mt-2 w-full rounded-lg border border-red-900/35 bg-red-950/20 px-2 py-1.5 text-[10px] font-medium text-red-300/90 transition hover:border-red-700/50 hover:bg-red-950/40 hover:text-red-200"
                >
                  カード削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="shrink-0 border-t border-[#2e3544] p-3">
        <button
          type="button"
          onClick={() => onCardsChange([...cards, newDeferredCard()])}
          className="w-full rounded-xl border border-dashed border-[#5c4a2a] bg-[#1a1814]/90 px-3 py-2 text-[12px] font-medium text-amber-200/80 transition hover:border-amber-700/50 hover:bg-[#221e18] hover:text-amber-100"
        >
          後から実行カード追加
        </button>
      </div>
    </aside>
  );
}

function ProjectEditHeaderPanel({
  name,
  onRename,
  sharedPromptMemo,
  onSharedPromptMemoChange,
}: {
  name: string;
  onRename: (name: string) => void;
  sharedPromptMemo: string;
  onSharedPromptMemoChange: (value: string) => void;
}) {
  return (
    <Panel
      position="top-center"
      className="m-0 mt-3 w-[min(100%,24rem)] max-w-[calc(100vw-2rem)]"
    >
      <div className="flex flex-col gap-3 rounded-2xl border border-[#2e3544] bg-[#151820]/95 px-4 py-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.4)] ring-1 ring-white/[0.05] backdrop-blur-sm">
        <label className="flex flex-col gap-1">
          <span className="px-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            プロジェクト名
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => onRename(e.target.value)}
            className="nodrag nopan w-full rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 text-sm font-medium text-zinc-100 outline-none ring-1 ring-white/[0.04] transition focus:border-[#7c6bb0] focus:ring-2 focus:ring-[#7c6bb0]/30"
            placeholder="プロジェクト名"
            autoComplete="off"
          />
        </label>
        <div className="border-t border-[#2e3544] pt-3">
          <h2 className="mb-2 px-0.5 text-[12px] font-semibold tracking-wide text-[#c8b4fc]">
            共通プロンプトメモ
          </h2>
          <textarea
            value={sharedPromptMemo}
            onChange={(e) => onSharedPromptMemoChange(e.target.value)}
            placeholder="毎回共通で付けたい注意文や条件を書いてください"
            rows={4}
            className="nodrag nopan max-h-[min(30vh,13rem)] min-h-[5.5rem] w-full resize-y rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2.5 text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 outline-none ring-1 ring-white/[0.04] transition focus:border-[#7c6bb0] focus:ring-2 focus:ring-[#7c6bb0]/28"
          />
        </div>
      </div>
    </Panel>
  );
}

function EditTopLeftPanel({
  onBack,
  onAddDeferredCard,
  onAirtableSave,
  airtableSaveBusy,
  airtableSaveDisabled,
  airtableLastSavedLabel,
  airtableSaveError,
}: {
  onBack: () => void;
  onAddDeferredCard: () => void;
  onAirtableSave: () => void;
  airtableSaveBusy: boolean;
  airtableSaveDisabled: boolean;
  airtableLastSavedLabel: string;
  airtableSaveError: string | null;
}) {
  const setNodes = useContext(SetNodesContext);
  const { screenToFlowPosition } = useReactFlow();
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);

  if (!setNodes) {
    return null;
  }

  const addBox = () => {
    setNodes((nds) => {
      const offset = nds.length * 28;
      const pos = screenToFlowPosition({
        x: typeof window !== "undefined" ? window.innerWidth / 2 + offset : 400,
        y: 160 + offset,
      });
      return [
        ...nds,
        {
          id: crypto.randomUUID(),
          type: "flowBox",
          position: pos,
          data: {
            title: "",
            checked: false,
            items: [newItem()],
            promptText: "",
            sqlNotes: [newSqlNote()],
          },
        },
      ];
    });
  };

  const addPreCard = () => {
    setNodes((nds) => {
      const offset = nds.length * 28;
      const pos = screenToFlowPosition({
        x: typeof window !== "undefined" ? window.innerWidth / 2 + offset : 400,
        y: 160 + offset,
      });
      return [
        ...nds,
        {
          id: crypto.randomUUID(),
          type: "preFlowBox",
          position: pos,
          data: {
            title: "",
            checked: false,
            preTasks: [newPreTask()],
          },
        },
      ];
    });
  };

  const addSqlCard = () => {
    setNodes((nds) => {
      const offset = nds.length * 28;
      const pos = screenToFlowPosition({
        x: typeof window !== "undefined" ? window.innerWidth / 2 + offset : 400,
        y: 160 + offset,
      });
      return [
        ...nds,
        {
          id: crypto.randomUUID(),
          type: "sqlFlowBox",
          position: pos,
          data: {
            title: "",
            checked: false,
            body: "",
          },
        },
      ];
    });
  };

  const addMemoCard = () => {
    setNodes((nds) => {
      const offset = nds.length * 28;
      const pos = screenToFlowPosition({
        x: typeof window !== "undefined" ? window.innerWidth / 2 + offset : 400,
        y: 160 + offset,
      });
      return [
        ...nds,
        {
          id: crypto.randomUUID(),
          type: "memoFlowBox",
          position: pos,
          data: {
            title: "",
            checked: false,
            body: "",
          },
        },
      ];
    });
  };

  useEffect(() => {
    if (!addMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = addMenuRef.current;
      if (el && !el.contains(e.target as globalThis.Node))
        setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [addMenuOpen]);

  return (
    <Panel
      position="top-left"
      className="m-0 flex max-w-[min(100vw-1rem,28rem)] flex-col gap-1.5"
    >
      <div className="flex flex-row flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-4 py-2.5 text-sm font-medium tracking-wide text-zinc-100 shadow-[0_8px_30px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.06] transition hover:border-[#7c6bb0]/65 hover:bg-[#22262f] active:scale-[0.99]"
      >
        ← 戻る
      </button>
      <div className="relative" ref={addMenuRef}>
        <div className="flex overflow-hidden rounded-xl border border-[#3d4454] bg-[#1a1d24] shadow-[0_8px_30px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.06]">
          <button
            type="button"
            onClick={addBox}
            className="border-0 bg-transparent px-4 py-2.5 text-sm font-medium tracking-wide text-zinc-100 transition hover:bg-[#22262f] active:scale-[0.99] sm:px-5"
          >
            ボックス追加
          </button>
          <button
            type="button"
            onClick={() => setAddMenuOpen((o) => !o)}
            aria-expanded={addMenuOpen}
            aria-haspopup="menu"
            aria-label="追加メニューを開く"
            className="nodrag nopan border-0 border-l border-[#3d4454]/90 bg-transparent px-2.5 py-2.5 text-xs text-zinc-400 transition hover:bg-[#22262f] hover:text-zinc-200"
          >
            ▼
          </button>
        </div>
        {addMenuOpen ? (
          <div
            role="menu"
            className="absolute left-0 top-[calc(100%+6px)] z-[200] min-w-[12.5rem] rounded-lg border border-[#3d4454] bg-[#1a1d24] py-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)] ring-1 ring-black/40"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                addBox();
                setAddMenuOpen(false);
              }}
              className="nodrag nopan flex w-full px-3 py-2.5 text-left text-[13px] text-zinc-200 transition hover:bg-[#262a34]"
            >
              通常カード
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                addPreCard();
                setAddMenuOpen(false);
              }}
              className="nodrag nopan flex w-full px-3 py-2.5 text-left text-[13px] text-zinc-200 transition hover:bg-[#262a34]"
            >
              前準備カード
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                addSqlCard();
                setAddMenuOpen(false);
              }}
              className="nodrag nopan flex w-full px-3 py-2.5 text-left text-[13px] text-zinc-200 transition hover:bg-[#262a34]"
            >
              SQLカード
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                addMemoCard();
                setAddMenuOpen(false);
              }}
              className="nodrag nopan flex w-full px-3 py-2.5 text-left text-[13px] text-zinc-200 transition hover:bg-[#262a34]"
            >
              メモカード
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onAddDeferredCard();
                setAddMenuOpen(false);
              }}
              className="nodrag nopan flex w-full px-3 py-2.5 text-left text-[13px] text-zinc-200 transition hover:bg-[#262a34]"
            >
              後から実行カード
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        disabled={airtableSaveDisabled}
        onClick={onAirtableSave}
        className="rounded-xl border border-emerald-800/50 bg-emerald-950/50 px-4 py-2.5 text-sm font-semibold tracking-wide text-emerald-100 shadow-[0_8px_30px_rgba(0,0,0,0.35)] ring-1 ring-emerald-700/25 transition hover:border-emerald-600/55 hover:bg-emerald-900/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
      >
        {airtableSaveBusy ? "保存中…" : "保存"}
      </button>
      </div>
      <div className="nodrag nopan px-0.5">
        <p className="text-[10px] leading-relaxed text-zinc-500">
          最終保存（Airtable）:{" "}
          <span className="font-medium text-zinc-400">
            {airtableLastSavedLabel}
          </span>
        </p>
        {airtableSaveError ? (
          <p
            role="alert"
            className="mt-1 text-[10px] leading-snug text-red-300/95"
          >
            {airtableSaveError}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

type AirtableListSummary = {
  id: string;
  name: string;
  shared_prompt_memo: string;
};

type ProjectListEntry =
  | {
      kind: "airtable";
      id: string;
      name: string;
      sharedMemo: string;
      localProject?: ProjectRecord;
    }
  | { kind: "local"; project: ProjectRecord };

function ProjectListView({
  listEntries,
  airtableListLoading,
  airtableListError,
  listOpenError,
  openingAirtableId,
  onRefreshAirtableList,
  onOpen,
  onOpenFromAirtable,
  onNew,
  onDelete,
  onRename,
}: {
  listEntries: ProjectListEntry[];
  airtableListLoading: boolean;
  airtableListError: string | null;
  listOpenError: string | null;
  openingAirtableId: string | null;
  onRefreshAirtableList: () => void;
  onOpen: (id: string) => void;
  onOpenFromAirtable: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (p: ProjectRecord) => {
    setEditingId(p.id);
    setDraft(p.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const commitEdit = (id: string) => {
    onRename(id, draft);
    setEditingId(null);
    setDraft("");
  };

  const renderLocalCard = (p: ProjectRecord) => (
    <div className="group flex flex-col gap-3 rounded-2xl border border-[#2e3544] bg-[#1a1d24] p-5 shadow-lg ring-1 ring-white/[0.05] transition hover:border-[#3d4a5c] sm:flex-row sm:items-start sm:justify-between">
      {editingId === p.id ? (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEdit(p.id);
                }
                if (e.key === "Escape") cancelEdit();
              }}
              className="w-full rounded-xl border border-[#3d4454] bg-[#22262f] px-3 py-2 text-base font-semibold text-zinc-100 outline-none focus:border-[#7c6bb0] focus:ring-2 focus:ring-[#7c6bb0]/30"
              autoFocus
              autoComplete="off"
            />
            <span className="text-xs text-zinc-500">
              更新: {formatUpdatedAt(p.updatedAt)}
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => commitEdit(p.id)}
                className="rounded-lg border border-[#3d4454] bg-[#262a34] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-[#7c6bb0]/55"
              >
                保存
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-[#3d4454] px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800/50"
              >
                キャンセル
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onDelete(p.id)}
            className="shrink-0 rounded-lg border border-[#3d4454] px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-red-500/50 hover:bg-red-950/30 hover:text-red-300"
          >
            削除
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => onOpen(p.id)}
            className="min-w-0 flex-1 text-left"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="block truncate text-base font-semibold text-zinc-100 group-hover:text-[#c4b5fd]">
                {p.name}
              </span>
              <span className="shrink-0 rounded bg-zinc-800/90 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 ring-1 ring-zinc-600/50">
                ローカルのみ
              </span>
            </span>
            <span className="mt-1 block text-xs text-zinc-500">
              更新: {formatUpdatedAt(p.updatedAt)}
            </span>
          </button>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startEdit(p);
              }}
              className="rounded-lg border border-[#3d4454] px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-[#7c6bb0]/55 hover:text-zinc-100"
            >
              編集
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.id);
              }}
              className="rounded-lg border border-[#3d4454] px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-red-500/50 hover:bg-red-950/30 hover:text-red-300"
            >
              削除
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#0f1115] px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
              プロジェクト
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Airtable の一覧を優先して表示します（ローカルのみの項目は下に並びます）
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={airtableListLoading}
              onClick={onRefreshAirtableList}
              className="rounded-xl border border-[#2d4a3d] bg-[#14221c]/90 px-4 py-2.5 text-sm font-medium text-emerald-200/90 shadow-md ring-1 ring-emerald-900/25 transition hover:border-emerald-600/45 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {airtableListLoading ? "取得中…" : "Airtable一覧を再取得"}
            </button>
            <button
              type="button"
              onClick={onNew}
              className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-5 py-2.5 text-sm font-medium text-zinc-100 shadow-md ring-1 ring-white/[0.06] transition hover:border-[#7c6bb0]/65 hover:bg-[#22262f]"
            >
              新規作成
            </button>
          </div>
        </div>

        {airtableListLoading ? (
          <p className="mb-4 rounded-xl border border-[#2e3544] bg-[#151820] px-4 py-3 text-sm text-zinc-400">
            Airtable からプロジェクト一覧を読み込み中…
          </p>
        ) : null}
        {airtableListError ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-amber-900/40 bg-amber-950/25 px-4 py-3 text-sm text-amber-200/90"
          >
            Airtable 一覧の取得に失敗しました: {airtableListError}
          </p>
        ) : null}
        {listOpenError ? (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-red-900/40 bg-red-950/25 px-4 py-3 text-sm text-red-200/90"
          >
            {listOpenError}
          </p>
        ) : null}

        {listEntries.length === 0 && !airtableListLoading ? (
          <p className="rounded-2xl border border-dashed border-[#2e3544] bg-[#151820] px-6 py-12 text-center text-sm text-zinc-500">
            プロジェクトがありません。Airtable に保存済みのプロジェクトがあれば「Airtable一覧を再取得」を押すか、「新規作成」から始めてください。
          </p>
        ) : listEntries.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-1">
            {listEntries.map((entry) => {
              if (entry.kind === "local") {
                return (
                  <li key={`local-${entry.project.id}`}>
                    {renderLocalCard(entry.project)}
                  </li>
                );
              }
              const a = entry;
              const pLocal = a.localProject;
              const rowBusy = openingAirtableId === a.id;
              return (
                <li key={`airtable-${a.id}`}>
                  <div className="group flex flex-col gap-3 rounded-2xl border border-[#2e3544] bg-[#1a1d24] p-5 shadow-lg ring-1 ring-white/[0.05] transition hover:border-[#3d4a5c] sm:flex-row sm:items-start sm:justify-between">
                    {pLocal && editingId === pLocal.id ? (
                      <>
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <input
                            type="text"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitEdit(pLocal.id);
                              }
                              if (e.key === "Escape") cancelEdit();
                            }}
                            className="w-full rounded-xl border border-[#3d4454] bg-[#22262f] px-3 py-2 text-base font-semibold text-zinc-100 outline-none focus:border-[#7c6bb0] focus:ring-2 focus:ring-[#7c6bb0]/30"
                            autoFocus
                            autoComplete="off"
                          />
                          <span className="text-xs text-zinc-500">
                            更新（ローカル）:{" "}
                            {formatUpdatedAt(pLocal.updatedAt)}
                          </span>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => commitEdit(pLocal.id)}
                              className="rounded-lg border border-[#3d4454] bg-[#262a34] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-[#7c6bb0]/55"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              className="rounded-lg border border-[#3d4454] px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800/50"
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onDelete(pLocal.id)}
                          className="shrink-0 rounded-lg border border-[#3d4454] px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-red-500/50 hover:bg-red-950/30 hover:text-red-300"
                        >
                          削除
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={openingAirtableId !== null}
                          onClick={() => onOpenFromAirtable(a.id)}
                          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="block truncate text-base font-semibold text-zinc-100 group-hover:text-[#c4b5fd]">
                              {a.name}
                            </span>
                            <span className="shrink-0 rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300/90 ring-1 ring-emerald-800/50">
                              Airtable
                            </span>
                          </span>
                          {a.sharedMemo.trim() ? (
                            <span className="mt-1.5 line-clamp-2 block text-xs leading-relaxed text-zinc-500">
                              {a.sharedMemo}
                            </span>
                          ) : null}
                          {pLocal ? (
                            <span className="mt-1 block text-xs text-zinc-500">
                              更新（ローカル）:{" "}
                              {formatUpdatedAt(pLocal.updatedAt)}
                            </span>
                          ) : (
                            <span className="mt-1 block text-xs text-zinc-600">
                              タップで Airtable から読み込んで開きます
                            </span>
                          )}
                          {rowBusy ? (
                            <span className="mt-1 block text-xs font-medium text-emerald-400/90">
                              読込中…
                            </span>
                          ) : null}
                        </button>
                        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                          {pLocal ? (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(pLocal);
                                }}
                                className="rounded-lg border border-[#3d4454] px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-[#7c6bb0]/55 hover:text-zinc-100"
                              >
                                編集
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onDelete(pLocal.id);
                                }}
                                className="rounded-lg border border-[#3d4454] px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-red-500/50 hover:bg-red-950/30 hover:text-red-300"
                              >
                                削除
                              </button>
                            </>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<"list" | "edit">("list");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowCanvasNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) =>
        assignOutgoingEdgeOffsets(applyEdgeChanges(changes, eds)),
      );
    },
    [setEdges],
  );
  const persistReadyRef = useRef(false);
  const [diagnosePanelOpen, setDiagnosePanelOpen] = useState(false);
  const [diagnoseLoading, setDiagnoseLoading] = useState(false);
  const [diagnoseOutput, setDiagnoseOutput] = useState<string | null>(null);
  const [diagnosePanelError, setDiagnosePanelError] = useState<string | null>(
    null,
  );
  const [diagnoseCopyNotice, setDiagnoseCopyNotice] = useState(false);
  const [airtableBusy, setAirtableBusy] = useState<null | "save" | "load">(
    null,
  );
  const [airtableSaveError, setAirtableSaveError] = useState<string | null>(
    null,
  );
  const [airtableLoadNotice, setAirtableLoadNotice] = useState<string | null>(
    null,
  );
  const [airtableSaveToast, setAirtableSaveToast] = useState(false);
  const [airtableLastSavedIso, setAirtableLastSavedIso] = useState<
    string | null
  >(null);

  const [airtableList, setAirtableList] = useState<AirtableListSummary[] | null>(
    null,
  );
  const [airtableListLoading, setAirtableListLoading] = useState(false);
  const [airtableListError, setAirtableListError] = useState<string | null>(
    null,
  );
  const [listViewOpenError, setListViewOpenError] = useState<string | null>(
    null,
  );
  const [openingAirtableId, setOpeningAirtableId] = useState<string | null>(
    null,
  );

  const fetchAirtableProjectList = useCallback(async () => {
    setAirtableListLoading(true);
    setAirtableListError(null);
    try {
      const res = await fetch("/api/airtable/projects");
      const data: unknown = await res.json();
      if (!res.ok) {
        const msg =
          data !== null &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `エラー (${res.status})`;
        setAirtableListError(msg);
        return;
      }
      if (
        data === null ||
        typeof data !== "object" ||
        !("projects" in data) ||
        !Array.isArray((data as { projects: unknown }).projects)
      ) {
        setAirtableListError("応答の形式が不正です");
        return;
      }
      const rawList = (data as { projects: unknown[] }).projects;
      const next: AirtableListSummary[] = [];
      for (const row of rawList) {
        if (!isRecord(row)) continue;
        const id = typeof row.id === "string" ? row.id.trim() : "";
        if (!id) continue;
        next.push({
          id,
          name: typeof row.name === "string" ? row.name : "無題",
          shared_prompt_memo:
            typeof row.shared_prompt_memo === "string"
              ? row.shared_prompt_memo
              : "",
        });
      }
      setAirtableList(next);
    } catch (e) {
      console.error(e);
      setAirtableListError("一覧の取得に失敗しました");
    } finally {
      setAirtableListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "list") return;
    void fetchAirtableProjectList();
  }, [view, fetchAirtableProjectList]);

  useEffect(() => {
    if (!activeProjectId) {
      setAirtableLastSavedIso(null);
      return;
    }
    const m = readAirtableLastSavedMap();
    setAirtableLastSavedIso(m[activeProjectId] ?? null);
  }, [activeProjectId]);

  useEffect(() => {
    if (!airtableSaveToast) return;
    const t = window.setTimeout(() => setAirtableSaveToast(false), 3200);
    return () => window.clearTimeout(t);
  }, [airtableSaveToast]);

  useLayoutEffect(() => {
    setProjects(loadInitialProjects());
    persistReadyRef.current = true;
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_DIAGNOSE_STORAGE_KEY);
      if (saved) setDiagnoseOutput(saved);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!diagnosePanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDiagnosePanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [diagnosePanelOpen]);

  useEffect(() => {
    if (!persistReadyRef.current || view !== "edit" || !activeProjectId) return;
    let payload: StoredPayload;
    try {
      payload = serializePayload(nodes, edges);
    } catch (e) {
      console.error("serializePayload failed", e);
      return;
    }
    const now = new Date().toISOString();
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.id === activeProjectId
          ? {
              ...p,
              updatedAt: now,
              nodes: payload.nodes,
              edges: payload.edges,
            }
          : p,
      );
      try {
        writeProjectsStore(next);
      } catch {
        /* quota */
      }
      return next;
    });
  }, [nodes, edges, view, activeProjectId]);

  const openProject = useCallback(
    (id: string) => {
      const p = projects.find((x) => x.id === id);
      if (!p) return;
      const flow = parseProjectRecordFlow(p);
      if (flow) {
        setNodes(flow.nodes);
        setEdges(flow.edges);
      } else {
        setNodes([]);
        setEdges([]);
      }
      setActiveProjectId(id);
      setView("edit");
    },
    [projects, setNodes, setEdges],
  );

  const projectListEntries = useMemo((): ProjectListEntry[] => {
    const byId = new Map(projects.map((p) => [p.id, p] as const));
    if (airtableList === null) {
      return [...projects]
        .sort((a, b) =>
          a.name.localeCompare(b.name, "ja", { sensitivity: "base" }),
        )
        .map((p) => ({ kind: "local" as const, project: p }));
    }
    const airtableIds = new Set(airtableList.map((a) => a.id));
    const out: ProjectListEntry[] = airtableList.map((a) => ({
      kind: "airtable" as const,
      id: a.id,
      name: a.name,
      sharedMemo: a.shared_prompt_memo,
      localProject: byId.get(a.id),
    }));
    const localsOnly = projects
      .filter((p) => !airtableIds.has(p.id))
      .sort((a, b) =>
        a.name.localeCompare(b.name, "ja", { sensitivity: "base" }),
      );
    for (const p of localsOnly) {
      out.push({ kind: "local", project: p });
    }
    return out;
  }, [airtableList, projects]);

  const openProjectFromAirtableById = useCallback(
    async (projectId: string) => {
      setListViewOpenError(null);
      setOpeningAirtableId(projectId);
      try {
        const pLocal = projects.find((x) => x.id === projectId);
        const q = new URLSearchParams({
          projectId,
          createdAt: pLocal?.createdAt ?? "",
        });
        const res = await fetch(`/api/airtable/load?${q.toString()}`);
        const data: unknown = await res.json();
        if (!res.ok) {
          const msg =
            data !== null &&
            typeof data === "object" &&
            "error" in data &&
            typeof (data as { error: unknown }).error === "string"
              ? (data as { error: string }).error
              : `エラー (${res.status})`;
          setListViewOpenError(msg);
          return;
        }
        if (
          data === null ||
          typeof data !== "object" ||
          !("project" in data) ||
          !isRecord((data as { project: unknown }).project)
        ) {
          setListViewOpenError("応答の形式が不正です");
          return;
        }
        const raw = (data as { project: Record<string, unknown> }).project;
        const createdAtFallback =
          pLocal?.createdAt ?? new Date().toISOString();
        const p = buildProjectRecordFromAirtablePayload(
          raw,
          projectId,
          createdAtFallback,
        );
        const flow = parseProjectRecordFlow(p);
        setProjects((prev) => {
          const next = prev.some((x) => x.id === p.id)
            ? prev.map((x) => (x.id === p.id ? p : x))
            : [...prev, p];
          try {
            writeProjectsStore(next);
          } catch {
            /* ignore */
          }
          return next;
        });
        if (flow) {
          setNodes(flow.nodes);
          setEdges(flow.edges);
        } else {
          setNodes([]);
          setEdges([]);
        }
        setActiveProjectId(p.id);
        setView("edit");
      } catch (e) {
        console.error(e);
        setListViewOpenError("読込リクエストに失敗しました");
      } finally {
        setOpeningAirtableId(null);
      }
    },
    [projects, setNodes, setEdges],
  );

  const createProject = useCallback(() => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const p: ProjectRecord = {
      id,
      name: "新しいプロジェクト",
      createdAt: now,
      updatedAt: now,
      nodes: [],
      edges: [],
      sharedPromptMemo: "",
      deferredCards: [],
    };
    setProjects((prev) => {
      const next = [...prev, p];
      try {
        writeProjectsStore(next);
      } catch {
        /* ignore */
      }
      return next;
    });
    setNodes([]);
    setEdges([]);
    setActiveProjectId(id);
    setView("edit");
  }, [setNodes, setEdges]);

  const deleteProject = useCallback((id: string) => {
    if (
      !window.confirm(
        "このプロジェクトを削除します。元に戻せません。よろしいですか？",
      )
    ) {
      return;
    }
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      try {
        writeProjectsStore(next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const goBackToList = useCallback(() => {
    setView("list");
    setActiveProjectId(null);
  }, []);

  const clearCurrentCanvas = useCallback(() => {
    if (
      !window.confirm(
        "このプロジェクトのキャンバス上のボックスと接続をすべて消します。よろしいですか？",
      )
    ) {
      return;
    }
    setNodes([]);
    setEdges([]);
  }, [setNodes, setEdges]);

  const runDiagnose = useCallback(async () => {
    const active = projects.find((p) => p.id === activeProjectId);
    const projectName = active?.name?.trim() || "（無題）";
    const sharedMemo = active?.sharedPromptMemo ?? "";
    const deferredCards = active?.deferredCards ?? [];
    const documentText = buildDiagnoseDocument(
      projectName,
      sharedMemo,
      deferredCards,
      nodes,
      edges,
    );

    setDiagnoseLoading(true);
    setDiagnosePanelError(null);
    setDiagnosePanelOpen(true);

    try {
      const res = await fetch("/api/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: documentText }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const msg =
          data !== null &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : JSON.stringify(data);
        setDiagnosePanelError(`エラー (${res.status}): ${msg}`);
        return;
      }
      let nextText: string;
      if (
        data !== null &&
        typeof data === "object" &&
        "result" in data &&
        typeof (data as { result: unknown }).result === "string"
      ) {
        nextText = (data as { result: string }).result;
      } else {
        nextText = JSON.stringify(data, null, 2);
      }
      setDiagnoseOutput(nextText);
      try {
        localStorage.setItem(LAST_DIAGNOSE_STORAGE_KEY, nextText);
      } catch {
        /* quota / private mode */
      }
    } catch (e) {
      console.error(e);
      setDiagnosePanelError("診断リクエストに失敗しました");
    } finally {
      setDiagnoseLoading(false);
    }
  }, [nodes, edges, projects, activeProjectId]);

  const copyDiagnoseToClipboard = useCallback(async () => {
    if (!diagnoseOutput?.trim()) return;
    try {
      await navigator.clipboard.writeText(diagnoseOutput);
      setDiagnoseCopyNotice(true);
      window.setTimeout(() => setDiagnoseCopyNotice(false), 2200);
    } catch {
      /* clipboard denied */
    }
  }, [diagnoseOutput]);

  const updateSharedPromptMemo = useCallback((text: string) => {
    if (!activeProjectId) return;
    const now = new Date().toISOString();
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.id === activeProjectId
          ? { ...p, sharedPromptMemo: text, updatedAt: now }
          : p,
      );
      try {
        writeProjectsStore(next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [activeProjectId]);

  const updateDeferredCards = useCallback((cards: DeferredCard[]) => {
    if (!activeProjectId) return;
    const now = new Date().toISOString();
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.id === activeProjectId
          ? { ...p, deferredCards: cards, updatedAt: now }
          : p,
      );
      try {
        writeProjectsStore(next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [activeProjectId]);

  const addDeferredCard = useCallback(() => {
    if (!activeProjectId) return;
    setProjects((prev) => {
      const p = prev.find((x) => x.id === activeProjectId);
      if (!p) return prev;
      const nextCards = [...(p.deferredCards ?? []), newDeferredCard()];
      const now = new Date().toISOString();
      const next = prev.map((x) =>
        x.id === activeProjectId
          ? { ...x, deferredCards: nextCards, updatedAt: now }
          : x,
      );
      try {
        writeProjectsStore(next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [activeProjectId]);

  const renameProject = useCallback((id: string, name: string) => {
    const nextName = name.trim() || "無題";
    const now = new Date().toISOString();
    setProjects((prev) => {
      const next = prev.map((p) =>
        p.id === id ? { ...p, name: nextName, updatedAt: now } : p,
      );
      try {
        writeProjectsStore(next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const saveProjectToAirtable = useCallback(async () => {
    if (!activeProjectId || !activeProject) return;
    setAirtableBusy("save");
    setAirtableSaveError(null);
    setAirtableSaveToast(false);
    try {
      const ser = serializePayload(nodes, edges);
      const now = new Date().toISOString();
      const res = await fetch("/api/airtable/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: activeProjectId,
          name: activeProject.name,
          createdAt: activeProject.createdAt,
          updatedAt: now,
          sharedPromptMemo: activeProject.sharedPromptMemo ?? "",
          deferredCards: activeProject.deferredCards ?? [],
          nodes: ser.nodes,
          edges: ser.edges,
        }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        const msg =
          data !== null &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `エラー (${res.status})`;
        setAirtableSaveError(msg);
        return;
      }
      writeAirtableLastSaved(activeProjectId, now);
      setAirtableLastSavedIso(now);
      setAirtableSaveToast(true);
      setProjects((prev) => {
        const next = prev.map((p) =>
          p.id === activeProjectId ? { ...p, updatedAt: now } : p,
        );
        try {
          writeProjectsStore(next);
        } catch {
          /* ignore */
        }
        return next;
      });
    } catch (e) {
      console.error(e);
      setAirtableSaveError("保存リクエストに失敗しました");
    } finally {
      setAirtableBusy(null);
    }
  }, [activeProjectId, activeProject, nodes, edges]);

  const loadProjectFromAirtable = useCallback(async () => {
    if (!activeProjectId || !activeProject) return;
    if (
      !window.confirm(
        "Airtable 上のデータでこのプロジェクトを上書きします。よろしいですか？\n（未保存のキャンバス変更は失われます）",
      )
    ) {
      return;
    }
    setAirtableBusy("load");
    setAirtableLoadNotice(null);
    try {
      const q = new URLSearchParams({
        projectId: activeProjectId,
        createdAt: activeProject.createdAt,
      });
      const res = await fetch(`/api/airtable/load?${q.toString()}`);
      const data: unknown = await res.json();
      if (!res.ok) {
        const msg =
          data !== null &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `エラー (${res.status})`;
        setAirtableLoadNotice(msg);
        return;
      }
      if (
        data === null ||
        typeof data !== "object" ||
        !("project" in data) ||
        !isRecord((data as { project: unknown }).project)
      ) {
        setAirtableLoadNotice("応答の形式が不正です");
        return;
      }
      const raw = (data as { project: Record<string, unknown> }).project;
      const p = buildProjectRecordFromAirtablePayload(
        raw,
        activeProjectId,
        activeProject.createdAt,
      );
      const flow = parseProjectRecordFlow(p);
      setProjects((prev) => {
        const next = prev.some((x) => x.id === p.id)
          ? prev.map((x) => (x.id === p.id ? p : x))
          : [...prev, p];
        try {
          writeProjectsStore(next);
        } catch {
          /* ignore */
        }
        return next;
      });
      if (flow) {
        setNodes(flow.nodes);
        setEdges(flow.edges);
      } else {
        setNodes([]);
        setEdges([]);
      }
      setAirtableLoadNotice("Airtable から読み込みました");
    } catch (e) {
      console.error(e);
      setAirtableLoadNotice("読込リクエストに失敗しました");
    } finally {
      setAirtableBusy(null);
    }
  }, [activeProjectId, activeProject, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || params.source === params.target) {
        return;
      }
      setEdges((eds) =>
        assignOutgoingEdgeOffsets(
          addEdge(
            {
              ...params,
              style: { stroke: "#a78bfa", strokeWidth: 2 },
              type: "smoothstep",
            },
            eds,
          ),
        ),
      );
    },
    [setEdges],
  );

  const isValidConnection = useCallback((c: Edge | Connection) => {
    const { source, target } = c;
    return Boolean(source && target && source !== target);
  }, []);

  const nodeTypes = useMemo(
    () => ({
      flowBox: FlowBoxNode,
      preFlowBox: PreFlowBoxNode,
      sqlFlowBox: SqlFlowBoxNode,
      memoFlowBox: MemoFlowBoxNode,
    }),
    [],
  );

  const deleteFlowCard = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
    },
    [setNodes, setEdges],
  );

  if (view === "list") {
    return (
      <ProjectListView
        listEntries={projectListEntries}
        airtableListLoading={airtableListLoading}
        airtableListError={airtableListError}
        listOpenError={listViewOpenError}
        openingAirtableId={openingAirtableId}
        onRefreshAirtableList={fetchAirtableProjectList}
        onOpen={openProject}
        onOpenFromAirtable={openProjectFromAirtableById}
        onNew={createProject}
        onDelete={deleteProject}
        onRename={renameProject}
      />
    );
  }

  return (
    <SetNodesContext.Provider value={setNodes}>
      <DeleteFlowCardContext.Provider value={deleteFlowCard}>
      <div className="flex h-dvh w-full bg-[#0f1115]">
        {activeProjectId ? (
          <DeferredExecuteSidebar
            cards={activeProject?.deferredCards ?? []}
            onCardsChange={updateDeferredCards}
          />
        ) : null}
        <div className="relative min-h-0 min-w-0 flex-1">
        {airtableSaveToast ? (
          <div
            role="status"
            className="pointer-events-none fixed bottom-8 left-1/2 z-[45] -translate-x-1/2 rounded-lg border border-emerald-800/50 bg-[#0f1f18]/95 px-4 py-2 text-xs font-medium text-emerald-100 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ring-1 ring-emerald-600/25"
          >
            保存しました
          </div>
        ) : null}
        <div className="absolute right-4 top-4 z-20 flex flex-col items-end gap-2">
          {diagnoseOutput && !diagnosePanelOpen ? (
            <button
              type="button"
              onClick={() => setDiagnosePanelOpen(true)}
              className="rounded-lg border border-[#5b4a8a]/45 bg-[#2a2540]/90 px-2.5 py-1.5 text-[11px] font-medium text-[#ddd6fe] shadow-md ring-1 ring-[#8b5cf6]/20 transition hover:border-[#a78bfa]/55 hover:text-white"
            >
              診断結果を見る
            </button>
          ) : null}
          <button
            type="button"
            disabled={diagnoseLoading}
            onClick={runDiagnose}
            className="rounded-lg border border-[#3d4454] bg-[#1a1d24]/95 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 shadow-md ring-1 ring-white/[0.05] transition hover:border-[#7c6bb0]/55 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {diagnoseLoading ? "診断中…" : "診断する"}
          </button>
          <button
            type="button"
            disabled={airtableBusy !== null}
            onClick={loadProjectFromAirtable}
            className="rounded-lg border border-[#2d4a3d] bg-[#14221c]/95 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200/90 shadow-md ring-1 ring-emerald-900/30 transition hover:border-emerald-600/45 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {airtableBusy === "load" ? "読込中…" : "Airtableから読込"}
          </button>
          {airtableLoadNotice ? (
            <p
              role="status"
              className={`max-w-[14rem] text-right text-[10px] leading-snug ${
                airtableLoadNotice === "Airtable から読み込みました"
                  ? "text-emerald-200/85"
                  : "text-red-300/90"
              }`}
            >
              {airtableLoadNotice}
            </p>
          ) : null}
          <button
            type="button"
            onClick={clearCurrentCanvas}
            className="rounded-lg border border-[#3d4454] bg-[#1a1d24]/95 px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 shadow-md ring-1 ring-white/[0.05] transition hover:border-[#7c6bb0]/55 hover:text-zinc-200"
          >
            キャンバスをクリア
          </button>
        </div>
        <ReactFlow
          className="!bg-[#0f1115] h-full w-full"
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionLineStyle={{ stroke: "#a78bfa", strokeWidth: 2 }}
          nodeTypes={nodeTypes}
          colorMode="dark"
          fitView={false}
          minZoom={0.12}
          maxZoom={2}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { stroke: "#a78bfa", strokeWidth: 2 },
          }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1.1}
            color="rgba(255,255,255,0.09)"
          />
          {activeProjectId ? (
            <ProjectEditHeaderPanel
              name={activeProject?.name ?? ""}
              onRename={(n) => renameProject(activeProjectId, n)}
              sharedPromptMemo={activeProject?.sharedPromptMemo ?? ""}
              onSharedPromptMemoChange={updateSharedPromptMemo}
            />
          ) : null}
          <EditTopLeftPanel
            onBack={goBackToList}
            onAddDeferredCard={addDeferredCard}
            onAirtableSave={saveProjectToAirtable}
            airtableSaveBusy={airtableBusy === "save"}
            airtableSaveDisabled={airtableBusy !== null}
            airtableLastSavedLabel={formatAirtableSavedAt(airtableLastSavedIso)}
            airtableSaveError={airtableSaveError}
          />
        </ReactFlow>

        {diagnosePanelOpen ? (
          <>
            <button
              type="button"
              aria-label="診断パネルを閉じる"
              className="fixed inset-0 z-[35] bg-black/50"
              onClick={() => setDiagnosePanelOpen(false)}
            />
            <aside className="fixed inset-y-0 right-0 z-[36] flex h-dvh max-h-dvh w-full max-w-xl flex-col border-l border-[#2e3544] bg-[#151820] shadow-2xl ring-1 ring-white/[0.04]">
              {diagnoseCopyNotice ? (
                <div
                  role="status"
                  className="pointer-events-none absolute right-5 top-[4.75rem] z-10 rounded-lg border border-[#5b4a8a]/40 bg-[#2a2540]/95 px-3 py-1.5 text-xs font-medium text-[#e9d5ff] shadow-lg ring-1 ring-[#8b5cf6]/25"
                >
                  コピーしました
                </div>
              ) : null}
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#2e3544] px-5 py-4">
                <div className="min-w-0 pr-2">
                  <h2 className="text-base font-semibold tracking-tight text-zinc-100">
                    診断レビュー
                  </h2>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Gemini によるフロー全体のレビューです
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={!diagnoseOutput?.trim() || diagnoseLoading}
                    onClick={() => void copyDiagnoseToClipboard()}
                    className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-[#7c6bb0]/55 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    コピー
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiagnosePanelOpen(false)}
                    className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-[#7c6bb0]/55 hover:text-white"
                  >
                    閉じる
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6">
                {diagnoseLoading ? (
                  <p className="text-sm leading-relaxed text-zinc-400">
                    診断中です。しばらくお待ちください…
                  </p>
                ) : diagnosePanelError ? (
                  <p className="whitespace-pre-wrap rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-sm leading-relaxed text-red-300">
                    {diagnosePanelError}
                  </p>
                ) : diagnoseOutput ? (
                  <DiagnoseResultPanelBody output={diagnoseOutput} />
                ) : (
                  <p className="text-sm text-zinc-500">結果がありません</p>
                )}
              </div>
            </aside>
          </>
        ) : null}
        </div>
      </div>
      </DeleteFlowCardContext.Provider>
    </SetNodesContext.Provider>
  );
}
