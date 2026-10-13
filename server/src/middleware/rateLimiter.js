import rateLimit from 'express-rate-limit'
import { RateLimitError } from '../utils/errors.js'
import { config } from '../config/env.js'

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    throw new RateLimitError('Too many requests, please try again later')
  }
})

// Session creation rate limiter (stricter)
export const sessionCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 sessions per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many sessions created, please try again later'
      }
    })
  }
})

// Version creation rate limiter
export const versionCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 versions per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many versions created, please try again later'
      }
    })
  }
})

// Session join rate limiter
export const sessionJoinLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 joins per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many join attempts, please try again later'
      }
    })
  }
})
