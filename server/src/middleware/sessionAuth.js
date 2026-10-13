import { sessionService } from '../services/SessionService.js'
import { UnauthorizedError } from '../utils/errors.js'

export function bearerToken(req) {
  const header = req.get('authorization') || ''
  const match = header.match(/^Bearer\s+([^\s]+)$/i)
  if (!match) throw new UnauthorizedError()
  return match[1]
}

export function requireSessionAccess(paramName) {
  return async (req, _res, next) => {
    try {
      await sessionService.verifyAccess(req.params[paramName], bearerToken(req))
      next()
    } catch (error) {
      next(error)
    }
  }
}
