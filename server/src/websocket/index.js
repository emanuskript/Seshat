import { WebSocketServer } from 'ws'
import { handleMessage, handleClose } from './handlers.js'
import { logger } from '../utils/logger.js'
import { config } from '../config/env.js'

let wss = null

/**
 * Initialize WebSocket server attached to HTTP server
 */
export function initWebSocket(server) {
  wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 6 * 1024 * 1024,
    verifyClient: ({ origin }, done) => {
      done(Boolean(origin && config.cors.origins.includes(origin)), 403, 'Origin not allowed')
    }
  })

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress
    logger.debug('WebSocket connection established', { clientIp })

    // Connection context (will be populated on join)
    const context = {
      sessionId: null,
      participantId: null
    }
    let windowStartedAt = Date.now()
    let messagesInWindow = 0
    ws.isAlive = true

    ws.on('pong', () => {
      ws.isAlive = true
    })

    ws.on('message', async (message) => {
      try {
        const now = Date.now()
        if (now - windowStartedAt >= 60000) {
          windowStartedAt = now
          messagesInWindow = 0
        }
        messagesInWindow += 1
        if (messagesInWindow > 300) {
          ws.close(1008, 'Message rate exceeded')
          return
        }
        await handleMessage(ws, message.toString(), context)
      } catch (err) {
        logger.error('WebSocket message handler error', { error: err.message })
        ws.send(JSON.stringify({
          type: 'error',
          payload: { code: 'INTERNAL_ERROR', message: 'An error occurred' }
        }))
      }
    })

    ws.on('close', () => {
      handleClose(context)
    })

    ws.on('error', (err) => {
      logger.error('WebSocket error', { error: err.message })
      handleClose(context)
    })

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      payload: { message: 'Connected to Seshat collaboration server' }
    }))
  })

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate()
        continue
      }
      ws.isAlive = false
      ws.ping()
    }
  }, 30000)
  heartbeat.unref()
  wss.on('close', () => clearInterval(heartbeat))

  logger.info('WebSocket server initialized')
  return wss
}

/**
 * Get WebSocket server instance
 */
export function getWebSocketServer() {
  return wss
}

/**
 * Close WebSocket server
 */
export function closeWebSocket() {
  if (wss) {
    wss.close()
    logger.info('WebSocket server closed')
  }
}
