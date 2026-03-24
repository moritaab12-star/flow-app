import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not set" },
        { status: 500 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 500 },
      );
    }

    const text =
      body !== null &&
      typeof body === "object" &&
      "text" in body &&
      typeof (body as { text: unknown }).text === "string"
        ? (body as { text: string }).text
        : null;

    if (text === null) {
      return NextResponse.json(
        { error: "Missing or invalid { text }" },
        { status: 500 },
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const prompt = `あなたはソフトウェア開発のレビュアーです。入力は、あるアプリ開発における「全体フロー」「作業ボックス」「タスク」「実装用プロンプトやメモ」などをまとめたテキストです。業種や製品の形態に依存せず、一般的なアプリ開発の観点で読んでください。

【重点的に見ること】
- 順番：手順の前後が妥当か、先に必要な作業が後ろに回っていないか
- 依存関係：タスク間・コンポーネント間の依存が明確か、逆依存や抜けがないか
- 前提不足：仕様・環境・権限・データ契約・外部サービスなどの前提が足りているか
- 用語のズレ：フロント/バックエンド/DB/外部APIなどレイヤーや用語の食い違い、曖昧さ
- 範囲の矛盾：スコープの重複・抜け、「やる/やらない」の矛盾

【出力形式】次の3行を本文の先頭付近に、この順番・番号・見出し文言どおり1行ずつ必ず書き、その直下に本文を書いてください（見出し行の直後は空行を1行入れてよい）。箇条書き中心・日本語。該当がなければ「特になし」と書いてください。前置きや結びの挨拶は不要です。

1. エラーになりそうな箇所
2. 修正点
3. 助言

【入力テキスト】
---
${text}
---`;

    const geminiResult = await model.generateContent(prompt);
    const output = geminiResult.response.text();

    return NextResponse.json({ result: output });
  } catch {
    return NextResponse.json(
      { error: "Failed to get diagnosis from Gemini" },
      { status: 500 },
    );
  }
}
