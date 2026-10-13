import { Router } from 'express'
import { sessionService } from '../services/SessionService.js'
import { sessionCreateLimiter, sessionJoinLimiter } from '../middleware/rateLimiter.js'
import { sanitizeBody } from '../middleware/sanitize.js'
import { requireSessionAccess } from '../middleware/sessionAuth.js'
import { validateSessionCreate, validateUUID } from '../utils/validators.js'

const router = Router()

/**
 * POST /api/sessions
 * Create a new session
 */
router.post('/', sessionCreateLimiter, sanitizeBody, async (req, res, next) => {
  try {
    const data = validateSessionCreate(req.body)
    const session = await sessionService.create(data)

    res.status(201).json({
      id: session.id,
      iiifManifest: session.iiifManifest,
      documentName: session.documentName,
      annotations: session.annotations,
      accessToken: session.accessToken,
      createdAt: session.createdAt
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/sessions/:id
 * Get session by ID
 */
router.get('/:id', sessionJoinLimiter, requireSessionAccess('id'), async (req, res, next) => {
  try {
    validateUUID(req.params.id, 'sessionId')
    const session = await sessionService.getById(req.params.id)

    res.json({
      id: session.id,
      iiifManifest: session.iiifManifest,
      documentName: session.documentName,
      annotations: session.annotations,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/sessions/:id/join
 * Join an existing session (returns session data, records participant)
 */
router.post('/:id/join', sessionJoinLimiter, requireSessionAccess('id'), sanitizeBody, async (req, res, next) => {
  try {
    validateUUID(req.params.id, 'sessionId')
    const session = await sessionService.getById(req.params.id)

    res.json({
      id: session.id,
      iiifManifest: session.iiifManifest,
      documentName: session.documentName,
      annotations: session.annotations,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    })
  } catch (err) {
    next(err)
  }
})

/**
 * PUT /api/sessions/:id/annotations
 * Update session annotations
 */
router.put('/:id/annotations', requireSessionAccess('id'), sanitizeBody, async (req, res, next) => {
  try {
    validateUUID(req.params.id, 'sessionId')
    const session = await sessionService.updateAnnotations(req.params.id, req.body.annotations || {})

    res.json({
      id: session.id,
      annotations: session.annotations,
      updatedAt: session.updatedAt
    })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/sessions/:id
 * Delete a session
 */
router.delete('/:id', requireSessionAccess('id'), async (req, res, next) => {
  try {
    validateUUID(req.params.id, 'sessionId')
    await sessionService.delete(req.params.id)

    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
