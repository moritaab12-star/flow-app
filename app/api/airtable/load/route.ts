import { NextResponse } from "next/server";
import { loadProjectFromAirtable } from "@/app/lib/airtable/sync";

export async function GET(request: Request) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    return NextResponse.json(
      { error: "AIRTABLE_API_KEY or AIRTABLE_BASE_ID is not set" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json(
      { error: "Missing projectId query parameter" },
      { status: 400 },
    );
  }

  const createdAt = searchParams.get("createdAt") ?? "";
  const updatedAt = searchParams.get("updatedAt") ?? "";

  try {
    const project = await loadProjectFromAirtable(baseId, apiKey, projectId, {
      createdAt:
        createdAt || new Date().toISOString(),
      updatedAt: updatedAt || new Date().toISOString(),
    });
    return NextResponse.json({ project });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Airtable load failed";
    console.error(e);
    const status = msg.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
