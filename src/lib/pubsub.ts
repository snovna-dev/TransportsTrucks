import type { PubSub } from "@google-cloud/pubsub";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }
  return value;
}

let client: PubSub | null = null;

/** Se crea en el primer uso: importar este módulo ya no exige las variables de Google. */
async function getPubSub(): Promise<PubSub> {
  if (!client) {
    const { PubSub } = await import("@google-cloud/pubsub");
    client = new PubSub({ projectId: getRequiredEnv("GOOGLE_CLOUD_PROJECT_ID") });
  }
  return client;
}

export async function publishManifestJob(jobId: bigint): Promise<string> {
  const topicName = getRequiredEnv("PUBSUB_MANIFEST_TOPIC");
  const pubsub = await getPubSub();

  return pubsub.topic(topicName).publishMessage({
    json: { jobId: jobId.toString() },
  });
}
