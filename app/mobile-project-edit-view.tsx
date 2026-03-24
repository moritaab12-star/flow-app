"use client";

import type { Node } from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent,
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

const MOBILE_CARD_W = 260;
const MOBILE_CARD_H = 86;
const MOBILE_CANVAS_PAD = 40;

function mobileCanvasBounds(nodes: Node[]): { w: number; h: number } {
  let w = 360;
  let h = 320;
  for (const n of nodes) {
    const x = n.position?.x ?? 0;
    const y = n.position?.y ?? 0;
    w = Math.max(w, x + MOBILE_CARD_W + MOBILE_CANVAS_PAD);
    h = Math.max(h, y + MOBILE_CARD_H + MOBILE_CANVAS_PAD);
  }
  return { w, h };
}

function MobileCanvasCard({
  node,
  setNodes,
  onOpenEdit,
}: {
  node: Node;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  onOpenEdit: () => void;
}) {
  const dragRef = useRef<{
    active: boolean;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const px = node.position?.x ?? 0;
  const py = node.position?.y ?? 0;

  const onHandlePointerDown = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: px,
      originY: py,
    };
  };

  const onHandlePointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d?.active) return;
    const nx = d.originX + (e.clientX - d.startClientX);
    const ny = d.originY + (e.clientY - d.startClientY);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === node.id ? { ...n, position: { x: nx, y: ny } } : n,
      ),
    );
  };

  const endDrag = (e: PointerEvent) => {
    if (dragRef.current?.active) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    dragRef.current = null;
  };

  return (
    <div
      className="absolute z-[2] rounded-xl border border-[#2e3544] bg-[#1a1d24] shadow-[0_8px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/[0.05]"
      style={{
        left: px,
        top: py,
        width: MOBILE_CARD_W,
        minHeight: MOBILE_CARD_H,
      }}
    >
      <div
        aria-label="カードを移動するにはドラッグ"
        className="flex touch-none cursor-grab select-none items-center gap-2 border-b border-[#2e3544]/90 bg-[#1e222b] px-2.5 py-2 active:cursor-grabbing"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="text-sm leading-none text-zinc-500" aria-hidden>
          ⠿
        </span>
        <span className="text-[10px] font-medium tracking-wide text-zinc-500">
          ここをドラッグで移動
        </span>
      </div>
      <button
        type="button"
        onClick={onOpenEdit}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left active:bg-[#262a34]"
      >
        <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
          {kindLabel(node.type)}
        </span>
        <span className="min-w-0 flex-1 break-words text-sm font-medium text-zinc-100">
          {titleFromNode(node)}
        </span>
      </button>
    </div>
  );
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
  const [actionPanelOpen, setActionPanelOpen] = useState(false);

  const closeActionPanel = useCallback(() => {
    setActionPanelOpen(false);
    setAddOpen(false);
  }, []);

  const sorted = useMemo(() => sortCanvasNodes(nodes), [nodes]);
  const canvasBounds = useMemo(() => mobileCanvasBounds(nodes), [nodes]);
  const selected = useMemo(
    () => (selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null),
    [nodes, selectedId],
  );

  useEffect(() => {
    if (!selectedId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selectedId]);

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

      <div
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 transition-[padding] duration-200 ${
          actionPanelOpen
            ? "pb-[min(58vh,24rem)]"
            : "pb-[calc(4.25rem+env(safe-area-inset-bottom))]"
        }`}
      >
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

        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          キャンバス上のカード
        </h2>
        <p className="mb-2 text-[10px] leading-snug text-zinc-500">
          上部の「⠿」エリアをドラッグして位置を変えられます。タイトル行をタップすると全画面の編集が開きます。スクロールでキャンバス全体を見渡せます。
        </p>
        {nodes.length === 0 ? (
          <p className="text-sm text-zinc-600">
            カードがありません。「操作を開く」から追加してください。
          </p>
        ) : (
          <div className="mb-2 h-[min(52vh,26rem)] w-full overflow-auto overscroll-contain rounded-xl border border-[#2e3544]/60 bg-[#080a0f] shadow-inner [-webkit-overflow-scrolling:touch]">
            <div
              className="relative min-h-full min-w-full"
              style={{
                width: Math.max(canvasBounds.w, 320),
                height: Math.max(canvasBounds.h, 280),
              }}
            >
              {sorted.map((n) => (
                <MobileCanvasCard
                  key={n.id}
                  node={n}
                  setNodes={setNodes}
                  onOpenEdit={() => {
                    closeActionPanel();
                    setSelectedId(n.id);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {actionPanelOpen ? (
        <button
          type="button"
          aria-label="操作パネルを閉じる"
          className="fixed inset-0 z-[33] bg-black/45 backdrop-blur-[1px] transition-opacity duration-200"
          onClick={closeActionPanel}
        />
      ) : null}

      <div
        className={`fixed left-0 right-0 z-[34] max-h-[min(58vh,26rem)] overflow-y-auto overscroll-contain rounded-t-2xl border-x border-t border-[#2e3544] bg-[#12141a]/98 px-3 pb-3 pt-2 shadow-[0_-12px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.04] backdrop-blur-md transition-transform duration-200 ease-out ${
          actionPanelOpen ? "translate-y-0" : "pointer-events-none translate-y-full"
        }`}
        style={{
          bottom: "calc(3.25rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="sticky top-0 z-[1] mb-2 flex justify-center pt-1">
          <div className="h-1 w-10 rounded-full bg-zinc-600/80" aria-hidden />
        </div>
        <button
          type="button"
          onClick={closeActionPanel}
          className="mb-3 w-full rounded-xl border border-[#3d4454] bg-[#1a1d24] py-2.5 text-sm font-medium text-zinc-300"
        >
          ▼ 閉じる
        </button>
        <div className="flex flex-col gap-2.5">
          {hasDiagnoseOutput ? (
            <button
              type="button"
              onClick={() => {
                onOpenDiagnosePanel();
                closeActionPanel();
              }}
              className="w-full rounded-xl border border-[#5b4a8a]/45 bg-[#2a2540]/90 py-3.5 text-sm font-medium text-[#ddd6fe] active:bg-[#352d50]"
            >
              診断結果を見る
            </button>
          ) : null}
          <button
            type="button"
            disabled={diagnoseLoading}
            onClick={runDiagnose}
            className="w-full rounded-xl border border-[#3d4454] bg-[#1a1d24] py-3.5 text-sm font-medium text-zinc-200 disabled:opacity-50 active:bg-[#22262f]"
          >
            {diagnoseLoading ? "診断中…" : "診断する"}
          </button>
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            className="w-full rounded-xl border border-[#7c6bb0]/50 bg-[#22262f] py-3.5 text-sm font-semibold text-[#c4b5fd] active:bg-[#2a2e38]"
          >
            {addOpen ? "追加メニューを閉じる" : "カードを追加"}
          </button>
          {addOpen ? (
            <div className="flex flex-col gap-2 rounded-xl border border-[#3d4454] bg-[#151820] p-2">
              <button
                type="button"
                onClick={addFlowBox}
                className="w-full rounded-lg bg-[#262a34] py-3 text-sm text-zinc-200 active:bg-[#303545]"
              >
                通常カード
              </button>
              <button
                type="button"
                onClick={addPreCard}
                className="w-full rounded-lg bg-[#262a34] py-3 text-sm text-zinc-200 active:bg-[#303545]"
              >
                前準備カード
              </button>
              <button
                type="button"
                onClick={addSqlCard}
                className="w-full rounded-lg bg-[#262a34] py-3 text-sm text-zinc-200 active:bg-[#303545]"
              >
                SQLカード
              </button>
              <button
                type="button"
                onClick={addMemoCard}
                className="w-full rounded-lg bg-[#262a34] py-3 text-sm text-zinc-200 active:bg-[#303545]"
              >
                メモカード
              </button>
            </div>
          ) : null}
          <button
            type="button"
            disabled={airtableBusy !== null}
            onClick={saveProjectToAirtable}
            className="w-full rounded-xl border border-emerald-800/50 bg-emerald-950/50 py-3.5 text-sm font-semibold text-emerald-100 disabled:opacity-45 active:bg-emerald-900/40"
          >
            {airtableBusy === "save" ? "保存中…" : "Airtable に保存"}
          </button>
          <button
            type="button"
            disabled={airtableBusy !== null}
            onClick={loadProjectFromAirtable}
            className="w-full rounded-xl border border-[#2d4a3d] bg-[#14221c] py-3.5 text-sm font-medium text-emerald-200/90 disabled:opacity-45 active:bg-[#182a24]"
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
            <p className="text-center text-xs text-red-300/90">
              {airtableSaveError}
            </p>
          ) : null}
          <p className="text-center text-[10px] text-zinc-500">
            最終保存: {airtableLastSavedLabel}
          </p>
          <button
            type="button"
            onClick={clearCurrentCanvas}
            className="w-full rounded-xl border border-[#3d4454] py-3.5 text-sm text-zinc-400 active:bg-[#1a1d24]"
          >
            キャンバスをクリア
          </button>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-[35] border-t border-[#2e3544] bg-[#0f1115]/98 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <button
          type="button"
          onClick={() => {
            setActionPanelOpen((o) => {
              if (o) setAddOpen(false);
              return !o;
            });
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#3d4454] bg-[#1a1d24] py-3 text-sm font-semibold text-zinc-200 shadow-md ring-1 ring-white/[0.05] active:bg-[#22262f]"
        >
          <span className="text-zinc-400" aria-hidden>
            {actionPanelOpen ? "▼" : "▲"}
          </span>
          {actionPanelOpen ? "閉じる" : "操作を開く"}
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
  const supported =
    node.type === "flowBox" ||
    node.type === "preFlowBox" ||
    node.type === "sqlFlowBox" ||
    node.type === "memoFlowBox";

  return (
    <div
      className="fixed inset-0 z-[100] flex h-[100dvh] max-h-[100dvh] flex-col bg-[#080a0f] pt-[env(safe-area-inset-top)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-card-editor-title"
    >
      <header className="flex shrink-0 flex-col gap-2 border-b border-[#2e3544] bg-[#0f1115]/95 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 shrink-0 rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-2 text-sm font-semibold text-[#c4b5fd] active:bg-[#22262f]"
          >
            ← 戻る
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
            className="min-h-11 shrink-0 rounded-xl px-3 py-2 text-sm font-medium text-red-400 active:bg-red-950/30"
          >
            カード削除
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1
            id="mobile-card-editor-title"
            className="text-lg font-bold tracking-tight text-zinc-100"
          >
            カードを編集
          </h1>
          <span className="rounded-lg bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300">
            {kindLabel(node.type)}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-zinc-500">
          変更はすぐに反映されます。Airtable に保存するとこの内容も保持されます。
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4">
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
        {!supported ? (
          <div className="rounded-xl border border-[#3d4454] bg-[#1a1d24] p-6 text-center text-sm text-zinc-400">
            このカードタイプの編集画面は未対応です。
          </div>
        ) : null}
      </div>

      <footer className="shrink-0 border-t border-[#2e3544] bg-[#12141a]/98 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-12 w-full items-center justify-center rounded-xl border border-[#5b4a8a]/55 bg-[#2a2540]/90 py-3.5 text-base font-semibold text-[#e9d5ff] shadow-lg ring-1 ring-white/[0.06] active:bg-[#352d50]"
        >
          閉じて一覧へ
        </button>
      </footer>
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
  const items =
    Array.isArray(d.items) && d.items.length > 0 ? d.items : [newItem()];
  const sqlNotes =
    Array.isArray(d.sqlNotes) && d.sqlNotes.length > 0
      ? d.sqlNotes
      : [newSqlNote()];

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
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          タイトル
        </span>
        <input
          value={d.title ?? ""}
          onChange={(e) => patch({ title: e.target.value })}
          className="min-h-12 rounded-xl border border-[#3d4454] bg-[#1a1d24] px-4 py-3 text-base text-zinc-100 outline-none ring-violet-500/20 focus:border-[#7c6bb0]/55 focus:ring-2"
          placeholder="カードのタイトル"
        />
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[#353b4a] bg-[#1a1d24] px-4 py-3 text-base font-medium text-zinc-200">
        <input
          type="checkbox"
          checked={Boolean(d.checked)}
          onChange={(e) => patch({ checked: e.target.checked })}
          className="size-5 shrink-0 accent-violet-500"
        />
        完了
      </label>
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          タスク
        </p>
        <ul className="flex flex-col gap-4">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-2xl border border-[#3d4454] bg-[#262a34] p-4 shadow-sm"
            >
              <div className="mb-3 flex items-start gap-3">
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
                  className="mt-1.5 size-5 shrink-0 accent-violet-500"
                  aria-label="タスク完了"
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
                  className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#3d4454] bg-[#1a1d24] px-3 py-3 text-base text-zinc-100 outline-none"
                  placeholder="タスクの内容"
                />
              </div>
              <div className="rounded-xl border border-[#2f3543] bg-[#1a1e28]/95 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  実装プロンプト
                </p>
                <textarea
                  value={it.promptText ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({
                      items: items.map((x) =>
                        x.id === it.id ? { ...x, promptText: v } : x,
                      ),
                    });
                  }}
                  rows={5}
                  className="min-h-[7.5rem] w-full resize-y rounded-xl border border-[#353b4a] bg-[#22262f] px-3 py-3 text-[15px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-[#7c6bb0]/55 focus:ring-1 focus:ring-[#7c6bb0]/35"
                  placeholder="このタスクを実装するためのプロンプトを書いてください"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(
                      "このタスクを削除しますか？（取り消せません）",
                    )
                  ) {
                    return;
                  }
                  const next = items.filter((x) => x.id !== it.id);
                  patch({
                    items: next.length > 0 ? next : [newItem()],
                  });
                }}
                className="mt-3 min-h-11 w-full rounded-lg border border-red-900/35 bg-red-950/25 py-2.5 text-sm font-medium text-red-300 active:bg-red-950/40"
              >
                このタスクを削除
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => patch({ items: [...items, newItem()] })}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl border border-dashed border-[#454c5c] bg-[#22262f]/80 py-3 text-base font-medium text-zinc-400 active:bg-[#262a34]"
        >
          ＋ タスクを追加
        </button>
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          ボックス共通プロンプト（メモ）
        </span>
        <textarea
          value={d.promptText ?? ""}
          onChange={(e) => patch({ promptText: e.target.value })}
          rows={5}
          className="min-h-[8rem] rounded-xl border border-[#3d4454] bg-[#1a1d24] px-4 py-3 text-[15px] leading-relaxed text-zinc-100 outline-none focus:border-[#7c6bb0]/55"
          placeholder="このカード全体に関するメモ・共通プロンプト"
        />
      </label>
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          SQLメモ
        </p>
        <ul className="flex flex-col gap-3">
          {sqlNotes.map((sn) => (
            <li
              key={sn.id}
              className="flex flex-col gap-2 rounded-xl border border-[#3d4454] bg-[#1a1d24] p-3"
            >
              <input
                value={sn.text}
                onChange={(e) => {
                  patch({
                    sqlNotes: sqlNotes.map((x) =>
                      x.id === sn.id ? { ...x, text: e.target.value } : x,
                    ),
                  });
                }}
                className="min-h-12 w-full rounded-xl border border-[#3d4454] bg-[#22262f] px-3 py-3 text-base text-zinc-100 outline-none"
                placeholder="SQL メモ行"
              />
              <button
                type="button"
                onClick={() => {
                  if (
                    !window.confirm(
                      "この SQL メモ行を削除しますか？（取り消せません）",
                    )
                  ) {
                    return;
                  }
                  const next = sqlNotes.filter((x) => x.id !== sn.id);
                  patch({
                    sqlNotes: next.length > 0 ? next : [newSqlNote()],
                  });
                }}
                className="min-h-10 text-sm font-medium text-red-400"
              >
                この行を削除
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() =>
            patch({ sqlNotes: [...sqlNotes, newSqlNote()] })
          }
          className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-dashed border-zinc-600 py-3 text-base text-zinc-400"
        >
          ＋ SQLメモの行を追加
        </button>
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
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-emerald-600/90">
          タイトル
        </span>
        <input
          value={d.title ?? ""}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="前準備カードのタイトル"
          className="min-h-12 rounded-xl border border-[#2a5c4a] bg-[#14221c] px-4 py-3 text-base text-emerald-50 outline-none placeholder:text-emerald-800/80 focus:border-[#34d399]/55 focus:ring-2 focus:ring-[#34d399]/25"
        />
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[#2a4a3d] bg-[#14221c] px-4 py-3 text-base font-medium text-emerald-100/90">
        <input
          type="checkbox"
          checked={Boolean(d.checked)}
          onChange={(e) => patch({ checked: e.target.checked })}
          className="size-5 shrink-0 accent-emerald-500"
        />
        完了
      </label>
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400/90">
        前準備タスク
      </p>
      <ul className="flex flex-col gap-3">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="rounded-2xl border border-[#2d5244] bg-[#132820]/95 p-4"
          >
            <div className="flex items-start gap-3">
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
                className="mt-1.5 size-5 shrink-0 accent-emerald-500"
                aria-label="前準備タスクの完了"
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
                placeholder="前準備タスク"
                className="min-h-12 min-w-0 flex-1 rounded-xl border border-[#2d5244] bg-[#0f1a16] px-3 py-3 text-base text-emerald-100 outline-none placeholder:text-emerald-800/80"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                if (
                  !window.confirm(
                    "この前準備タスクを削除しますか？（取り消せません）",
                  )
                ) {
                  return;
                }
                const next = tasks.filter((x) => x.id !== t.id);
                patch({
                  preTasks: next.length > 0 ? next : [newPreTask()],
                });
              }}
              className="mt-3 min-h-11 w-full rounded-lg border border-red-900/40 bg-red-950/20 py-2.5 text-sm font-medium text-red-300"
            >
              この行を削除
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => patch({ preTasks: [...tasks, newPreTask()] })}
        className="flex min-h-12 w-full items-center justify-center rounded-xl border border-dashed border-[#2d5c48] bg-[#14221c]/90 py-3 text-base font-medium text-emerald-300/90"
      >
        ＋ 前準備タスクを追加
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
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          タイトル
        </span>
        <input
          value={d.title ?? ""}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="SQLカードのタイトル"
          className="min-h-12 rounded-xl border border-[#3d4454] bg-[#1a1d24] px-4 py-3 text-base text-zinc-100 outline-none focus:border-sky-500/50 focus:ring-2 focus:ring-sky-500/20"
        />
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[#353b4a] bg-[#1a1d24] px-4 py-3 text-base font-medium text-zinc-200">
        <input
          type="checkbox"
          checked={Boolean(d.checked)}
          onChange={(e) => patch({ checked: e.target.checked })}
          className="size-5 shrink-0 accent-sky-500"
        />
        完了
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          SQL
        </span>
        <textarea
          value={d.body ?? ""}
          onChange={(e) => patch({ body: e.target.value })}
          rows={14}
          className="min-h-[12rem] rounded-xl border border-[#3d4454] bg-[#1a1d24] px-4 py-3 font-mono text-[15px] leading-relaxed text-zinc-100 outline-none focus:border-sky-500/50"
          placeholder="SQL を入力"
        />
      </label>
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
    <div className="flex flex-col gap-5">
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          タイトル
        </span>
        <input
          value={d.title ?? ""}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="メモカードのタイトル"
          className="min-h-12 rounded-xl border border-[#3d4454] bg-[#1a1d24] px-4 py-3 text-base text-zinc-100 outline-none focus:border-amber-600/45 focus:ring-2 focus:ring-amber-600/20"
        />
      </label>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-[#353b4a] bg-[#1a1d24] px-4 py-3 text-base font-medium text-zinc-200">
        <input
          type="checkbox"
          checked={Boolean(d.checked)}
          onChange={(e) => patch({ checked: e.target.checked })}
          className="size-5 shrink-0 accent-amber-500"
        />
        完了
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          メモ本文
        </span>
        <textarea
          value={d.body ?? ""}
          onChange={(e) => patch({ body: e.target.value })}
          rows={12}
          className="min-h-[10rem] rounded-xl border border-[#3d4454] bg-[#1a1d24] px-4 py-3 text-[15px] leading-relaxed text-zinc-100 outline-none focus:border-amber-600/45"
          placeholder="メモを入力"
        />
      </label>
    </div>
  );
}
