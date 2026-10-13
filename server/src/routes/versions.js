import { Router } from 'express'
import { versionService } from '../services/VersionService.js'
import { presenceService } from '../services/PresenceService.js'
import { versionCreateLimiter } from '../middleware/rateLimiter.js'
import { sanitizeBody } from '../middleware/sanitize.js'
import { requireSessionAccess } from '../middleware/sessionAuth.js'
import { validateVersionCreate, validateUUID } from '../utils/validators.js'

const router = Router({ mergeParams: true })

router.use(requireSessionAccess('sessionId'))

/**
 * POST /api/sessions/:sessionId/versions
 * Create a new version checkpoint
 */
router.post('/', versionCreateLimiter, sanitizeBody, async (req, res, next) => {
  try {
    validateUUID(req.params.sessionId, 'sessionId')
    const data = validateVersionCreate(req.body)
    const version = await versionService.create(req.params.sessionId, data)

    res.status(201).json({
      id: version.id,
      name: version.name,
      description: version.description,
      createdBy: version.createdBy,
      versionNumber: version.versionNumber,
      createdAt: version.createdAt
    })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/sessions/:sessionId/versions
 * List all versions for a session
 */
router.get('/', async (req, res, next) => {
  try {
    validateUUID(req.params.sessionId, 'sessionId')
    const versions = await versionService.listBySession(req.params.sessionId)

    res.json({ versions })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/sessions/:sessionId/versions/check-unsaved
 * Check if there are unsaved changes since last checkpoint
 */
router.get('/check-unsaved', async (req, res, next) => {
  try {
    validateUUID(req.params.sessionId, 'sessionId')
    const result = await versionService.checkUnsavedChanges(req.params.sessionId)

    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/sessions/:sessionId/versions/:versionId
 * Get a specific version with full annotations
 */
router.get('/:versionId', async (req, res, next) => {
  try {
    validateUUID(req.params.sessionId, 'sessionId')
    validateUUID(req.params.versionId, 'versionId')
    const version = await versionService.getById(req.params.sessionId, req.params.versionId)

    res.json(version)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /api/sessions/:sessionId/versions/:versionId/restore
 * Restore session to a previous version
 */
router.post('/:versionId/restore', sanitizeBody, async (req, res, next) => {
  try {
    validateUUID(req.params.sessionId, 'sessionId')
    validateUUID(req.params.versionId, 'versionId')

    const result = await versionService.restore(
      req.params.sessionId,
      req.params.versionId
    )

    // Broadcast restored annotations to all connected participants
    presenceService.broadcastAll(req.params.sessionId, {
      type: 'version:restored',
      payload: {
        annotations: result.session.annotations,
        restoredFrom: {
          id: result.restoredFrom.id,
          name: result.restoredFrom.name,
          versionNumber: result.restoredFrom.versionNumber
        },
        newVersion: {
          id: result.newVersion.id,
          name: result.newVersion.name,
          versionNumber: result.newVersion.versionNumber
        }
      }
    })

    res.json({
      message: 'Version restored successfully',
      restoredFrom: {
        id: result.restoredFrom.id,
        name: result.restoredFrom.name,
        versionNumber: result.restoredFrom.versionNumber
      },
      newVersion: {
        id: result.newVersion.id,
        name: result.newVersion.name,
        versionNumber: result.newVersion.versionNumber
      },
      annotations: result.session.annotations
    })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /api/sessions/:sessionId/versions/:versionId
 * Delete a specific version
 */
router.delete('/:versionId', async (req, res, next) => {
  try {
    validateUUID(req.params.sessionId, 'sessionId')
    validateUUID(req.params.versionId, 'versionId')
    await versionService.delete(req.params.sessionId, req.params.versionId)

    res.status(204).send()
  } catch (err) {
    next(err)
  }
})

export default router
