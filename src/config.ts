export type AppConfig = {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  redisPrefix: string;
  webhookSecrets: readonly string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const webhookSecrets = (env.WEBHOOK_SECRETS ?? "")
    .split(",")
    .map((secret) => secret.trim())
    .filter((secret) => secret.length > 0);
  if (webhookSecrets.length === 0) {
    throw new Error("WEBHOOK_SECRETS must contain at least one secret");
  }

  return {
    port,
    databaseUrl: required(env, "DATABASE_URL"),
    redisUrl: required(env, "REDIS_URL"),
    redisPrefix: env.REDIS_PREFIX?.trim() || "plumb",
    webhookSecrets,
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}
