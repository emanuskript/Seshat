import 'dotenv/config'

const nodeEnv = process.env.NODE_ENV || 'development'
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:8081')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)

function isValidOrigin(value) {
  try {
    const parsed = new URL(value)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === value.replace(/\/$/, '')
  } catch {
    return false
  }
}

if (nodeEnv === 'production') {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required in production')
  if (!process.env.CORS_ORIGIN || corsOrigins.includes('*') || corsOrigins.some(origin => !isValidOrigin(origin))) {
    throw new Error('CORS_ORIGIN must list valid explicit origins in production')
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv,
  isDev: nodeEnv !== 'production',

  cors: {
    origins: corsOrigins
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
  },

  session: {
    maxAnnotationsSize: 5 * 1024 * 1024, // 5MB
    maxVersionsPerSession: 100,
    inactiveCleanupDays: parseInt(process.env.SESSION_RETENTION_DAYS || '90', 10)
  }
}
