import { PubSub } from "@google-cloud/pubsub";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}.`);
  }
  return value;
}

const pubsub = new PubSub({
  projectId: getRequiredEnv("GOOGLE_CLOUD_PROJECT_ID"),
});

export async function publishManifestJob(jobId: bigint): Promise<string> {
  const topicName = getRequiredEnv("PUBSUB_MANIFEST_TOPIC");
  const topic = pubsub.topic(topicName);

  const messageId = await topic.publishMessage({
    json: {
      jobId: jobId.toString(),
    },
  });

  return messageId;
}
