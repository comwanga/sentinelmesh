// Validates all required env vars at startup so the service fails fast
// instead of crashing mid-request when a var is missing.

function require_env(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing required env var: ${key}`)
  return val
}

export const config = {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  databaseUrl: require_env('DATABASE_URL'),
  redisUrl: require_env('REDIS_URL'),
  jwtSecret: require_env('JWT_SECRET'),
  internalSecret: require_env('INTERNAL_SERVICE_SECRET'),
  zapWebhookSecret: require_env('ZAP_WEBHOOK_SECRET'),
} as const
