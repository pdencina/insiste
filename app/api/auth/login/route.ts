/**
 * Inicia el flujo OAuth redirigiendo al usuario a Google.
 */

import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/gmail/client";

export async function GET() {
  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
