import { NextResponse } from "next/server";
import { createOAuthClient, DRIVE_SCOPES, isOAuthSetupEnabled } from "../../../../../lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/google/drive/authorize: inicia el consentimiento OAuth con la cuenta
 * personal de Google para obtener el refresh token. Solo funciona con
 * GOOGLE_OAUTH_SETUP_ENABLED=true; desactívelo después de configurarlo.
 */
export async function GET() {
  if (!isOAuthSetupEnabled()) {
    return NextResponse.json({ error: "La configuración de Google Drive está deshabilitada." }, { status: 404 });
  }
  const url = createOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DRIVE_SCOPES,
  });
  return NextResponse.redirect(url);
}
