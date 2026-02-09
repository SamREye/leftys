import { NextResponse } from "next/server";
import { getGraffiti } from "@/lib/graffiti";

export async function GET() {
  const items = await getGraffiti();
  return NextResponse.json(items);
}
