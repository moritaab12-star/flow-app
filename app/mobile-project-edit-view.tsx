"use client";

import type { Node } from "@xyflow/react";
import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

type DeferredCard = {
  id: string;
  title: string;
  note: string;
  checked: boolean;
};

type FlowItem = {
  id: string;
  text: string;
  done: boolean;
  promptText: string;
};

type SqlNote = { id: string; text: string };
type PreTask = { id: string; text: string; checked: boolean };

function newItem(): FlowItem {
  return { id: crypto.randomUUID(), text: "", done: false, promptText: "" };
}
function newSqlNote(): SqlNote {
  return { id: crypto.randomUUID(), text: "" };
}
function newPreTask(): PreTask {
  return { id: crypto.randomUUID(), text: "", checked: false };
}

function stackPosition(index: number): { x: number; y: number } {
  const step = 36;
  return { x: 48 + (index % 4) * 24, y: 48 + index * step };
}

function sortCanvasNodes(nodes: Node[]): Node[] {
  return [...nodes].sort((a, b) => {
    const dy = (a.position?.y ?? 0) - (b.position?.y ?? 0);
    return dy !== 0 ? dy : (a.position?.x ?? 0) - (b.position?.x ?? 0);
  });
}

function kindLabel(type: string | undefined): string {
  switch (type) {
    case "flowBox":
      return "通常";
    case "preFlowBox":
      return "前準備";
    case "sqlFlowBox":
      return "SQL";
    case "memoFlowBox":
      return "メモ";
    default:
      return "カード";
  }
}

function titleFromNode(n: Node): string {
  const d = n.data as Record<string, unknown>;
  const t = d?.title;
  return typeof t === "string" && t.trim() ? t.trim() : "（無題）";
}

export function MobileProjectEditView({
  projectName,
  onRenameProject,
  sharedPromptMemo,
  onSharedPromptMemoChange,
  deferredCards,
  onDeferredChange,
  onAddDeferredCard,
  nodes,
  setNodes,
  deleteFlowCard,
  goBackToList,
  runDiagnose,
  diagnoseLoading,
  saveProjectToAirtable,
  airtableBusy,
  loadProjectFromAirtable,
  clearCurrentCanvas,
  airtableLoadNotice,
  airtableSaveError,
  airtableLastSavedLabel,
  onOpenDiagnosePanel,
  hasDiagnoseOutput,
}: {
  projectName: string;
  onRenameProject: (name: string) => void;
  sharedPromptMemo: string;
  onSharedPromptMemoChange: (v: string) => void;
  deferredCards: DeferredCard[];
  onDeferredChange: (cards: DeferredCard[]) => void;
  onAddDeferredCard: () => void;
  nodes: Node[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  deleteFlowCard: (id: string) => void;
  goBackToList: () => void;
  runDiagnose: () => void;
  diagnoseLoading: boolean;
  saveProjectToAirtable: () => void;
  airtableBusy: null | "save" | "load";
  loadProjectFromAirtable: () => void;
  clearCurrentCanvas: () => void;
  airtableLoadNotice: string | null;
  airtableSaveError: string | null;
  airtableLastSavedLabel: string;
  onOpenDiagnosePanel: () => void;
  hasDiagnoseOutput: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const sorted = useMemo(() => sortCanvasNodes(nodes), [nodes]);
  const selected = useMemo(
    () => (selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null),
    [nodes, selectedId],
  );

  const addFlowBox = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: crypto.randomUUID(),
        type: "flowBox",
        position: stackPosition(nds.length),
        data: {
          title: "",
          checked: false,
          items: [newItem()],
          promptText: "",
          sqlNotes: [newSqlNote()],
        },
      },
    ]);
    setAddOpen(false);
  }, [setNodes]);

  const addPreCard = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: crypto.randomUUID(),
        type: "preFlowBox",
        position: stackPosition(nds.length),
        data: { title: "", checked: false, preTasks: [newPreTask()] },
      },
    ]);
    setAddOpen(false);
  }, [setNodes]);

  const addSqlCard = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: crypto.randomUUID(),
        type: "sqlFlowBox",
        position: stackPosition(nds.length),
        data: { title: "", checked: false, body: "" },
      },
    ]);
    setAddOpen(false);
  }, [setNodes]);

  const addMemoCard = useCallback(() => {
    setNodes((nds) => [
      ...nds,
      {
        id: crypto.randomUUID(),
        type: "memoFlowBox",
        position: stackPosition(nds.length),
        data: { title: "", checked: false, body: "" },
      },
    ]);
    setAddOpen(false);
  }, [setNodes]);

  const patchDeferred = useCallback(
    (id: string, part: Partial<DeferredCard>) => {
      onDeferredChange(
        deferredCards.map((c) => (c.id === id ? { ...c, ...part } : c)),
      );
    },
    [deferredCards, onDeferredChange],
  );

  return (
    <div className="flex h-dvh w-full flex-col bg-[#0f1115] text-zinc-100">
      <header className="shrink-0 border-b border-[#2e3544] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={goBackToList}
          className="mb-2 text-left text-sm font-medium text-[#c4b5fd]"
        >
          ← プロジェクト一覧
        </button>
        <input
          type="text"
          value={projectName}
          onChange={(e) => onRenameProject(e.target.value)}
          className="mb-2 w-full rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2.5 text-base font-semibold outline-none focus:border-[#7c6bb0]"
          placeholder="プロジェクト名"
          autoComplete="off"
        />
        <textarea
          value={sharedPromptMemo}
          onChange={(e) => onSharedPromptMemoChange(e.target.value)}
          placeholder="共通プロンプトメモ"
          rows={2}
          className="w-full resize-none rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 text-sm text-zinc-200 outline-none focus:border-[#7c6bb0]"
        />
        <p className="mt-2 text-[10px] leading-snug text-zinc-500">
          カード間の接続線はPC表示でのみ編集できます。
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(13rem+env(safe-area-inset-bottom))] pt-3">
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-200/90">
            後から実行
          </h2>
          {deferredCards.length === 0 ? (
            <p className="text-xs text-zinc-600">カードはまだありません</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {deferredCards.map((c) => (
                <li
                  key={c.id}
                  className="rounded-xl border border-[#403528] bg-[#1a1714] p-3"
                >
                  <input
                    value={c.title}
                    onChange={(e) =>
                      patchDeferred(c.id, { title: e.target.value })
                    }
                    className="mb-2 w-full rounded-lg border border-[#3d4454] bg-[#22262f] px-2 py-1.5 text-sm outline-none"
                    placeholder="タイトル"
                  />
                  <textarea
                    value={c.note}
                    onChange={(e) =>
                      patchDeferred(c.id, { note: e.target.value })
                    }
                    rows={2}
                    className="mb-2 w-full rounded-lg border border-[#3d4454] bg-[#22262f] px-2 py-1.5 text-xs outline-none"
                    placeholder="メモ"
                  />
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    <input
                      type="checkbox"
                      checked={c.checked}
                      onChange={() =>
                        patchDeferred(c.id, { checked: !c.checked })
                      }
                      className="size-4 accent-amber-600"
                    />
                    完了
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={onAddDeferredCard}
            className="mt-2 w-full rounded-xl border border-dashed border-[#5c4a2a] py-2 text-sm text-amber-200/80"
          >
            後から実行カードを追加
          </button>
        </section>

        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          キャンバス上のカード
        </h2>
        {sorted.length === 0 ? (
          <p className="text-sm text-zinc-600">
            カードがありません。「追加」から作成してください。
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className="flex w-full items-start gap-3 rounded-xl border border-[#2e3544] bg-[#1a1d24] px-4 py-3 text-left ring-1 ring-white/[0.04] active:bg-[#22262f]"
                >
                  <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                    {kindLabel(n.type)}
                  </span>
                  <span className="min-w-0 flex-1 break-words text-sm font-medium text-zinc-100">
                    {titleFromNode(n)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 flex flex-col gap-2 border-t border-[#2e3544] bg-[#0f1115]/98 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        {hasDiagnoseOutput ? (
          <button
            type="button"
            onClick={onOpenDiagnosePanel}
            className="w-full rounded-xl border border-[#5b4a8a]/45 bg-[#2a2540]/90 py-3 text-sm font-medium text-[#ddd6fe]"
          >
            診断結果を見る
          </button>
        ) : null}
        <button
          type="button"
          disabled={diagnoseLoading}
          onClick={runDiagnose}
          className="w-full rounded-xl border border-[#3d4454] bg-[#1a1d24] py-3 text-sm font-medium text-zinc-200 disabled:opacity-50"
        >
          {diagnoseLoading ? "診断中…" : "診断する"}
        </button>
        <button
          type="button"
          onClick={() => setAddOpen((o) => !o)}
          className="w-full rounded-xl border border-[#7c6bb0]/50 bg-[#22262f] py-3 text-sm font-semibold text-[#c4b5fd]"
        >
          {addOpen ? "追加メニューを閉じる" : "カードを追加"}
        </button>
        {addOpen ? (
          <div className="flex flex-col gap-2 rounded-xl border border-[#3d4454] bg-[#151820] p-2">
            <button
              type="button"
              onClick={addFlowBox}
              className="w-full rounded-lg bg-[#262a34] py-2.5 text-sm text-zinc-200"
            >
              通常カード
            </button>
            <button
              type="button"
              onClick={addPreCard}
              className="w-full rounded-lg bg-[#262a34] py-2.5 text-sm text-zinc-200"
            >
              前準備カード
            </button>
            <button
              type="button"
              onClick={addSqlCard}
              className="w-full rounded-lg bg-[#262a34] py-2.5 text-sm text-zinc-200"
            >
              SQLカード
            </button>
            <button
              type="button"
              onClick={addMemoCard}
              className="w-full rounded-lg bg-[#262a34] py-2.5 text-sm text-zinc-200"
            >
              メモカード
            </button>
          </div>
        ) : null}
        <button
          type="button"
          disabled={airtableBusy !== null}
          onClick={saveProjectToAirtable}
          className="w-full rounded-xl border border-emerald-800/50 bg-emerald-950/50 py-3 text-sm font-semibold text-emerald-100 disabled:opacity-45"
        >
          {airtableBusy === "save" ? "保存中…" : "Airtable に保存"}
        </button>
        <button
          type="button"
          disabled={airtableBusy !== null}
          onClick={loadProjectFromAirtable}
          className="w-full rounded-xl border border-[#2d4a3d] bg-[#14221c] py-3 text-sm font-medium text-emerald-200/90 disabled:opacity-45"
        >
          {airtableBusy === "load" ? "読込中…" : "Airtable から読込"}
        </button>
        {airtableLoadNotice ? (
          <p
            className={`text-center text-xs ${
              airtableLoadNotice === "Airtable から読み込みました"
                ? "text-emerald-300/90"
                : "text-red-300/90"
            }`}
          >
            {airtableLoadNotice}
          </p>
        ) : null}
        {airtableSaveError ? (
          <p className="text-center text-xs text-red-300/90">{airtableSaveError}</p>
        ) : null}
        <p className="text-center text-[10px] text-zinc-500">
          最終保存: {airtableLastSavedLabel}
        </p>
        <button
          type="button"
          onClick={clearCurrentCanvas}
          className="w-full rounded-xl border border-[#3d4454] py-2.5 text-sm text-zinc-400"
        >
          キャンバスをクリア
        </button>
      </div>

      {selected ? (
        <MobileNodeEditorSheet
          node={selected}
          setNodes={setNodes}
          onClose={() => setSelectedId(null)}
          onDelete={(id) => {
            deleteFlowCard(id);
            setSelectedId(null);
          }}
        />
      ) : null}
    </div>
  );
}

function MobileNodeEditorSheet({
  node,
  setNodes,
  onClose,
  onDelete,
}: {
  node: Node;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#0f1115] pt-[env(safe-area-inset-top)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#2e3544] px-3 py-3">
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-medium text-[#c4b5fd]"
        >
          ← 一覧に戻る
        </button>
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                "このカードを削除しますか？接続線も削除されます。",
              )
            ) {
              onDelete(node.id);
            }
          }}
          className="text-xs text-red-400"
        >
          削除
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {node.type === "flowBox" ? (
          <MobileEditFlowBox node={node} setNodes={setNodes} />
        ) : null}
        {node.type === "preFlowBox" ? (
          <MobileEditPre node={node} setNodes={setNodes} />
        ) : null}
        {node.type === "sqlFlowBox" ? (
          <MobileEditSql node={node} setNodes={setNodes} />
        ) : null}
        {node.type === "memoFlowBox" ? (
          <MobileEditMemo node={node} setNodes={setNodes} />
        ) : null}
      </div>
    </div>
  );
}

function MobileEditFlowBox({
  node,
  setNodes,
}: {
  node: Node;
  setNodes: Dispatch<SetStateAction<Node[]>>;
}) {
  const d = node.data as {
    title: string;
    checked: boolean;
    items: FlowItem[];
    promptText: string;
    sqlNotes: SqlNote[];
  };
  const items = Array.isArray(d.items) && d.items.length > 0 ? d.items : [newItem()];

  const patch = useCallback(
    (data: Partial<typeof d>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id && n.type === "flowBox"
            ? { ...n, data: { ...d, ...data } }
            : n,
        ),
      );
    },
    [d, node.id, setNodes],
  );

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500">タイトル</span>
        <input
          value={d.title ?? ""}
          onChange={(e) => patch({ title: e.target.value })}
          className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 text-base outline-none"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(d.checked)}
          onChange={(e) => patch({ checked: e.target.checked })}
          className="size-4 accent-violet-500"
        />
        完了
      </label>
      <div>
        <p className="mb-2 text-xs font-semibold text-zinc-400">タスク</p>
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-xl border border-[#3d4454] bg-[#262a34] p-3"
            >
              <div className="mb-2 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={it.done}
                  onChange={() =>
                    patch({
                      items: items.map((x) =>
                        x.id === it.id ? { ...x, done: !x.done } : x,
                      ),
                    })
                  }
                  className="mt-1 size-4 accent-violet-500"
                />
                <input
                  value={it.text}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({
                      items: items.map((x) =>
                        x.id === it.id ? { ...x, text: v } : x,
                      ),
                    });
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-[#3d4454] bg-[#1a1d24] px-2 py-1.5 text-sm outline-none"
                  placeholder="タスク"
                />
              </div>
              <input
                value={it.promptText ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  patch({
                    items: items.map((x) =>
                      x.id === it.id ? { ...x, promptText: v } : x,
                    ),
                  });
                }}
                className="w-full rounded-lg border border-[#3d4454] bg-[#1a1d24] px-2 py-1 text-xs outline-none"
                placeholder="プロンプト"
              />
              <button
                type="button"
                onClick={() =>
                  patch({
                    items: items.filter((x) => x.id !== it.id),
                  })
                }
                className="mt-2 text-xs text-red-400"
              >
                タスクを削除
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() =>
            patch({ items: [...items, newItem()] })
          }
          className="mt-2 w-full rounded-lg border border-dashed border-zinc-600 py-2 text-sm text-zinc-400"
        >
          タスクを追加
        </button>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-zinc-500">ボックス共通プロンプト</span>
        <textarea
          value={d.promptText ?? ""}
          onChange={(e) => patch({ promptText: e.target.value })}
          rows={4}
          className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 text-sm outline-none"
        />
      </label>
      <div>
        <p className="mb-2 text-xs font-semibold text-zinc-400">SQLメモ</p>
        {(Array.isArray(d.sqlNotes) ? d.sqlNotes : [newSqlNote()]).map(
          (sn) => (
            <div key={sn.id} className="mb-2 flex gap-2">
              <input
                value={sn.text}
                onChange={(e) => {
                  const arr = Array.isArray(d.sqlNotes)
                    ? d.sqlNotes
                    : [newSqlNote()];
                  patch({
                    sqlNotes: arr.map((x) =>
                      x.id === sn.id ? { ...x, text: e.target.value } : x,
                    ),
                  });
                }}
                className="min-w-0 flex-1 rounded-lg border border-[#3d4454] bg-[#1a1d24] px-2 py-1.5 text-sm outline-none"
              />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function MobileEditPre({
  node,
  setNodes,
}: {
  node: Node;
  setNodes: Dispatch<SetStateAction<Node[]>>;
}) {
  const d = node.data as {
    title: string;
    checked: boolean;
    preTasks: PreTask[];
  };
  const tasks =
    Array.isArray(d.preTasks) && d.preTasks.length > 0
      ? d.preTasks
      : [newPreTask()];

  const patch = useCallback(
    (data: Partial<typeof d>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id && n.type === "preFlowBox"
            ? { ...n, data: { ...d, ...data } }
            : n,
        ),
      );
    },
    [d, node.id, setNodes],
  );

  return (
    <div className="flex flex-col gap-4">
      <input
        value={d.title ?? ""}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="タイトル"
        className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 text-base outline-none"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(d.checked)}
          onChange={(e) => patch({ checked: e.target.checked })}
          className="size-4 accent-emerald-500"
        />
        完了
      </label>
      <p className="text-xs font-semibold text-zinc-400">前準備タスク</p>
      {tasks.map((t) => (
        <div key={t.id} className="flex flex-col gap-2 rounded-xl border border-[#3d4454] p-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={t.checked}
              onChange={() =>
                patch({
                  preTasks: tasks.map((x) =>
                    x.id === t.id ? { ...x, checked: !x.checked } : x,
                  ),
                })
              }
              className="size-4 accent-emerald-500"
            />
            <input
              value={t.text}
              onChange={(e) =>
                patch({
                  preTasks: tasks.map((x) =>
                    x.id === t.id ? { ...x, text: e.target.value } : x,
                  ),
                })
              }
              className="min-w-0 flex-1 rounded-lg border border-[#3d4454] bg-[#1a1d24] px-2 py-1.5 text-sm outline-none"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => patch({ preTasks: [...tasks, newPreTask()] })}
        className="rounded-lg border border-dashed border-zinc-600 py-2 text-sm text-zinc-400"
      >
        行を追加
      </button>
    </div>
  );
}

function MobileEditSql({
  node,
  setNodes,
}: {
  node: Node;
  setNodes: Dispatch<SetStateAction<Node[]>>;
}) {
  const d = node.data as { title: string; checked: boolean; body: string };
  const patch = useCallback(
    (data: Partial<typeof d>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id && n.type === "sqlFlowBox"
            ? { ...n, data: { ...d, ...data } }
            : n,
        ),
      );
    },
    [d, node.id, setNodes],
  );
  return (
    <div className="flex flex-col gap-4">
      <input
        value={d.title ?? ""}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="タイトル"
        className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 outline-none"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(d.checked)}
          onChange={(e) => patch({ checked: e.target.checked })}
          className="size-4 accent-sky-500"
        />
        完了
      </label>
      <textarea
        value={d.body ?? ""}
        onChange={(e) => patch({ body: e.target.value })}
        rows={12}
        className="min-h-[10rem] rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 font-mono text-sm outline-none"
        placeholder="SQL"
      />
    </div>
  );
}

function MobileEditMemo({
  node,
  setNodes,
}: {
  node: Node;
  setNodes: Dispatch<SetStateAction<Node[]>>;
}) {
  const d = node.data as { title: string; checked: boolean; body: string };
  const patch = useCallback(
    (data: Partial<typeof d>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === node.id && n.type === "memoFlowBox"
            ? { ...n, data: { ...d, ...data } }
            : n,
        ),
      );
    },
    [d, node.id, setNodes],
  );
  return (
    <div className="flex flex-col gap-4">
      <input
        value={d.title ?? ""}
        onChange={(e) => patch({ title: e.target.value })}
        placeholder="タイトル"
        className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 outline-none"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(d.checked)}
          onChange={(e) => patch({ checked: e.target.checked })}
          className="size-4 accent-amber-500"
        />
        完了
      </label>
      <textarea
        value={d.body ?? ""}
        onChange={(e) => patch({ body: e.target.value })}
        rows={10}
        className="rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 text-sm outline-none"
        placeholder="メモ"
      />
    </div>
  );
}
