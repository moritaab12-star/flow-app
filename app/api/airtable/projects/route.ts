import { NextResponse } from "next/server";
import { listAirtableProjectSummaries } from "@/app/lib/airtable/sync";

export async function GET() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    return NextResponse.json(
      { error: "AIRTABLE_API_KEY or AIRTABLE_BASE_ID is not set" },
      { status: 500 },
    );
  }

  try {
    const projects = await listAirtableProjectSummaries(baseId, apiKey);
    return NextResponse.json({ projects });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to list projects";
    console.error(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
