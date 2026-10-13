// src/services/api.js

const RAW_BASE =
  (typeof process !== 'undefined' && process.env && process.env.VUE_APP_API_URL) ||
  (typeof window !== 'undefined' && window.location && window.location.origin) ||
  'http://localhost:3001'

// Normalize: trim trailing slashes, and if someone sets ".../api" avoid "/api/api/..."
const API_URL = RAW_BASE.replace(/\/+$/, '').replace(/\/api$/, '')

const tokenKey = (sessionId) => `seshat_session_token_${sessionId}`

export function storeSessionAccessToken(sessionId, token) {
  if (typeof localStorage !== 'undefined' && sessionId && token) {
    localStorage.setItem(tokenKey(sessionId), token)
  }
}

export function getSessionAccessToken(sessionId) {
  if (!sessionId) return ''
  if (typeof window !== 'undefined') {
    const routeMatch = window.location.pathname.match(/\/session\/([0-9a-f-]+)$/i)
    const fragmentToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('access_token')
    if (routeMatch?.[1] === sessionId && fragmentToken) {
      storeSessionAccessToken(sessionId, fragmentToken)
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      fragment.delete('access_token')
      const suffix = fragment.toString() ? `#${fragment}` : ''
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${suffix}`)
      return fragmentToken
    }
  }
  return typeof localStorage !== 'undefined'
    ? localStorage.getItem(tokenKey(sessionId)) || ''
    : ''
}

function sessionIdFromEndpoint(endpoint) {
  return endpoint.match(/^\/api\/sessions\/([0-9a-f-]+)(?:\/|$)/i)?.[1] || ''
}

class ApiError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request(endpoint, options = {}) {
  const url = `${API_URL}${endpoint}`
  const config = { ...options }
  const sessionId = sessionIdFromEndpoint(endpoint)
  const accessToken = getSessionAccessToken(sessionId)
  if (sessionId && accessToken) {
    config.headers = { ...(config.headers || {}), Authorization: `Bearer ${accessToken}` }
  }

  // Only set JSON content-type when sending JSON
  if (config.body !== undefined) {
    if (config.body instanceof FormData) {
      // Let browser set multipart boundary
    } else if (typeof config.body === 'object') {
      config.headers = { 'Content-Type': 'application/json', ...(config.headers || {}) }
      config.body = JSON.stringify(config.body)
    }
  }

  const response = await fetch(url, config)

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new ApiError(
      error.error?.message || `Request failed: ${response.status}`,
      response.status,
      error.error?.code || 'UNKNOWN_ERROR'
    )
  }

  if (response.status === 204) return null
  return response.json()
}

export const sessionsApi = {
  createSession: (data) =>
    request('/api/sessions', {
      method: 'POST',
      body: data
    }),

  joinSession: (sessionId, data) =>
    request(`/api/sessions/${sessionId}/join`, {
      method: 'POST',
      body: data
    }),

  getSession: (sessionId) => request(`/api/sessions/${sessionId}`),

  updateAnnotations: (sessionId, data) =>
    request(`/api/sessions/${sessionId}/annotations`, {
      method: 'PUT',
      body: data
    }),

  getSessionVersions: (sessionId) => request(`/api/sessions/${sessionId}/versions`)
}

export const versionsApi = {
  list: (sessionId) =>
    request(`/api/sessions/${sessionId}/versions`),

  get: (sessionId, versionId) =>
    request(`/api/sessions/${sessionId}/versions/${versionId}`),

  checkUnsaved: (sessionId) =>
    request(`/api/sessions/${sessionId}/versions/check-unsaved`),

  createVersion: (sessionId, data) =>
    request(`/api/sessions/${sessionId}/versions`, {
      method: 'POST',
      body: data
    }),

  restoreVersion: (sessionId, versionId, data) =>
    request(`/api/sessions/${sessionId}/versions/${versionId}/restore`, {
      method: 'POST',
      body: data
    }),

  deleteVersion: (sessionId, versionId) =>
    request(`/api/sessions/${sessionId}/versions/${versionId}`, {
      method: 'DELETE'
    })
}

export { ApiError }
