import { createOAuthClient, isOAuthSetupEnabled } from "../../../../../lib/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(body: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Google Drive</title><body style="font-family:sans-serif;max-width:720px;margin:40px auto">${body}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

const escape = (value: string) =>
  value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** GET /api/google/drive/callback: muestra el refresh token para copiarlo a GOOGLE_OAUTH_REFRESH_TOKEN. */
export async function GET(request: Request) {
  if (!isOAuthSetupEnabled()) return page("<p>Configuración deshabilitada.</p>", 404);

  const code = new URL(request.url).searchParams.get("code");
  if (!code) return page("<p>Google no devolvió el código de autorización.</p>", 400);

  try {
    const { tokens } = await createOAuthClient().getToken(code);
    if (!tokens.refresh_token) {
      return page(
        "<p>Google no entregó un refresh token. Revoque el acceso de la app en su cuenta de Google y vuelva a intentarlo.</p>",
        400,
      );
    }
    return page(`
      <h1>Google Drive autorizado</h1>
      <p>Copie este valor en la variable <code>GOOGLE_OAUTH_REFRESH_TOKEN</code> (en <code>.env.local</code> y en Netlify),
      luego ponga <code>GOOGLE_OAUTH_SETUP_ENABLED=false</code>.</p>
      <textarea readonly rows="4" style="width:100%">${escape(tokens.refresh_token)}</textarea>`);
  } catch (error) {
    return page(`<p>Error: ${escape(error instanceof Error ? error.message : "desconocido")}</p>`, 500);
  }
}
