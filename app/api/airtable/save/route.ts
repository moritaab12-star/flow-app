import { NextResponse } from "next/server";
import {
  saveProjectToAirtable,
  validateSaveBody,
} from "@/app/lib/airtable/sync";

export async function POST(request: Request) {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    return NextResponse.json(
      { error: "AIRTABLE_API_KEY or AIRTABLE_BASE_ID is not set" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = validateSaveBody(body);
  if (!parsed) {
    return NextResponse.json(
      { error: "Invalid body: require id (string) and optional project fields" },
      { status: 400 },
    );
  }

  try {
    await saveProjectToAirtable(baseId, apiKey, parsed);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Airtable save failed";
    console.error(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
