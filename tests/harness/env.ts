export const adminDatabaseUrl =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://plumb:plumb@localhost:5433/postgres";
export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://plumb:plumb@localhost:5433/plumb";
export const testRedisUrl = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
export const testWebhookSecret = "plumb_test_webhook_secret";

export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}
