import { NextRequest, NextResponse } from "next/server";

/**
 * Server-side proxy to gates.alwayshave.fun/api/unlock so the messaging
 * app can call gate buttons without CORS / cross-origin pain. The gate
 * app already holds the Brivo credentials in its own Cloudflare env;
 * this proxy just forwards the request from same-origin.
 *
 * POST /api/gates/unlock
 * Body: { "gate": "jones" } | { "gate": "reno" }
 */

const GATE_IDS: Record<string, number> = {
  jones: 67999408,
  reno: 72767197,
};

const UPSTREAM = "https://gates.alwayshave.fun/api/unlock";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const gate = (body as { gate?: string } | undefined)?.gate;
  if (!gate || !(gate in GATE_IDS)) {
    return NextResponse.json(
      { error: `unknown gate "${gate}". expected one of: ${Object.keys(GATE_IDS).join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gateIds: [GATE_IDS[gate]] }),
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "upstream gate request failed", detail: String(e) },
      { status: 502 },
    );
  }
}
