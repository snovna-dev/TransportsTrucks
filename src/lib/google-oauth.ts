import { google } from "googleapis";

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }
  return value;
}

/** Cliente OAuth 2.0 de la cuenta personal de Google (sin refresh token aún). */
export function createOAuthClient() {
  return new google.auth.OAuth2(
    getRequiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
    getRequiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    getRequiredEnv("GOOGLE_OAUTH_REDIRECT_URI"),
  );
}

/** Cliente OAuth listo para usar con el refresh token guardado en el entorno. */
export function getAuthorizedOAuthClient() {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: getRequiredEnv("GOOGLE_OAUTH_REFRESH_TOKEN") });
  return client;
}

export function isOAuthConfigured() {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
}

/** La pantalla de autorización solo se habilita mientras se configura Drive. */
export function isOAuthSetupEnabled() {
  return process.env.GOOGLE_OAUTH_SETUP_ENABLED === "true";
}
