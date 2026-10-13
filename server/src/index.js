import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { createServer } from 'http'

import { config } from './config/env.js'
import { connectPrisma, disconnectPrisma } from './lib/prisma.js'
import { initWebSocket, closeWebSocket } from './websocket/index.js'
import { apiLimiter } from './middleware/rateLimiter.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { logger } from './utils/logger.js'
import { prisma } from './lib/prisma.js'
import { sessionService } from './services/SessionService.js'

import sessionsRouter from './routes/sessions.js'
import versionsRouter from './routes/versions.js'

const app = express()
app.set('trust proxy', 1)

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Disable CSP for API server
}))

// CORS
app.use(cors({
  origin: config.cors.origins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}))

// Body parsing
app.use(express.json({ limit: '10mb' }))

// Rate limiting
app.use('/api', apiLimiter)

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', database: 'ok', timestamp: new Date().toISOString() })
  } catch {
    res.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

// API routes
app.use('/api/sessions', sessionsRouter)
app.use('/api/sessions/:sessionId/versions', versionsRouter)

// 404 handler
app.use(notFoundHandler)

// Error handler
app.use(errorHandler)

// Create HTTP server
const server = createServer(app)

// Initialize WebSocket
initWebSocket(server)

let cleanupTimer = null

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`)

  closeWebSocket()
  if (cleanupTimer) clearInterval(cleanupTimer)
  await disconnectPrisma()

  server.close(() => {
    logger.info('Server closed')
    process.exit(0)
  })

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Start server
async function start() {
  try {
    // Connect to database
    await connectPrisma()

    // Start listening on all interfaces (0.0.0.0) for VM/container access
    await sessionService.cleanupInactive()
    cleanupTimer = setInterval(
      () => sessionService.cleanupInactive().catch(error => logger.error('Session cleanup failed', { error: error.message })),
      24 * 60 * 60 * 1000
    )
    cleanupTimer.unref()

    server.listen(config.port, config.host, () => {
      logger.info(`Server running on ${config.host}:${config.port}`)
      logger.info(`Environment: ${config.nodeEnv}`)
      logger.info(`CORS origins: ${config.cors.origins.join(', ')}`)
    })
  } catch (err) {
    logger.error('Failed to start server', { error: err.message })
    process.exit(1)
  }
}

start()
