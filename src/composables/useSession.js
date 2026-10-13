// src/composables/useSession.js
// HTTP API + singleton WebSocket integration for collaboration sessions.
import { ref, computed } from 'vue'
import { sessionsApi, getSessionAccessToken, storeSessionAccessToken } from '../services/api'
import { useWebSocket } from './useWebSocket'

// ---------- UUID helper ------------------------------------------------------
function uuidv4() {
  const cryptoApi = typeof window !== 'undefined' ? window.crypto : null
  const bytes = new Uint8Array(16)
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ---------- singleton state --------------------------------------------------
const sessionId        = ref(null)
const sessionData      = ref(null)
const isLoading        = ref(false)
const error            = ref(null)
const localParticipant = ref(null)
const annotations      = ref({})
const accessToken      = ref(null)

// ---------- composable -------------------------------------------------------
export function useSession() {
  const ws = useWebSocket()

  // ---- computed ---------------------------------------------------------
  const isInSession = computed(() => !!sessionId.value)

  const shareUrl = computed(() => {
    if (!sessionId.value) return ''
    const origin =
      typeof window !== 'undefined' && window.location
        ? window.location.origin
        : ''
    const token = accessToken.value || getSessionAccessToken(sessionId.value)
    return token
      ? `${origin}/session/${sessionId.value}#access_token=${encodeURIComponent(token)}`
      : ''
  })

  // ---- device / participant ids -----------------------------------------
  const getDeviceId = () => {
    const key = 'quillapp_device_id'
    let id = localStorage.getItem(key)
    if (!id) { id = uuidv4(); localStorage.setItem(key, id) }
    return id
  }

  const getParticipantId = () => {
    const key = 'quillapp_participant_id'
    let id = localStorage.getItem(key)
    if (!id) { id = uuidv4(); localStorage.setItem(key, id) }
    return id
  }

  // ---- WebSocket connect + join message ---------------------------------
  const connectWebSocket = async (sid, displayName) => {
    try {
      await ws.connect(sid)

      // Listen for the server's "joined" confirmation (sets localParticipant)
      ws.on('joined', (payload) => {
        localParticipant.value = {
          id: payload.participantId,
          displayName: payload.displayName,
          color: payload.color
        }
      })

      // Send the join message the server expects
      ws.send('join', {
        sessionId: sid,
        accessToken: accessToken.value || getSessionAccessToken(sid),
        displayName: displayName || 'Anonymous',
        participantId: getParticipantId()
      })
    } catch (err) {
      console.warn('[useSession] WebSocket connection failed (non-fatal):', err)
    }
  }

  // ---- HTTP: create session ---------------------------------------------
  const createSession = async (iiifManifest, documentName, ann) => {
    try {
      isLoading.value = true
      error.value = null

      const response = await sessionsApi.createSession({
        iiifManifest,
        documentName,
        annotations: ann || {},
        deviceId: getDeviceId(),
        participantId: getParticipantId(),
        metadata: { createdAt: new Date().toISOString(), userAgent: navigator.userAgent }
      })

      sessionId.value   = response.id
      accessToken.value = response.accessToken
      storeSessionAccessToken(response.id, response.accessToken)
      sessionData.value  = response
      annotations.value  = ann || {}

      return response
    } catch (err) {
      error.value = err
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // ---- HTTP + WS: join session ------------------------------------------
  const joinSession = async (id, displayName) => {
    try {
      isLoading.value = true
      error.value = null
      accessToken.value = getSessionAccessToken(id)
      if (!accessToken.value) {
        throw new Error('This session link is missing its access token.')
      }

      // HTTP join (hits /api/sessions/:id/join — server returns session data)
      let response
      try {
        response = await sessionsApi.joinSession(id, {
          deviceId: getDeviceId(),
          participantId: getParticipantId(),
          displayName: displayName || undefined,
          metadata: { joinedAt: new Date().toISOString(), userAgent: navigator.userAgent }
        })
      } catch (_) {
        // Fall back to GET if /join route missing
        response = await sessionsApi.getSession(id)
      }

      sessionId.value  = id
      sessionData.value = response

      // Load annotations from server response
      if (response.annotations) {
        annotations.value = response.annotations
      }

      // Open WebSocket and send join
      await connectWebSocket(id, displayName)

      return response
    } catch (err) {
      error.value = err
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // ---- leave ------------------------------------------------------------
  const leaveSession = async () => {
    ws.disconnect()
    sessionId.value        = null
    sessionData.value      = null
    localParticipant.value = null
    annotations.value      = {}
    error.value            = null
    accessToken.value      = null
  }

  // ---- HTTP: bulk annotation save (for version snapshots etc.) ----------
  const updateAnnotations = async (ann) => {
    if (!sessionId.value) throw new Error('Not in a session')
    try {
      await sessionsApi.updateAnnotations(sessionId.value, {
        deviceId: getDeviceId(),
        annotations: ann
      })
      if (ws.isConnected.value) {
        ws.send('annotations:replace', { annotations: ann })
      }
    } catch (err) {
      error.value = err
      throw err
    }
  }

  // ---- HTTP: fetch session data -----------------------------------------
  const fetchSession = async (id) => {
    try {
      isLoading.value = true
      error.value     = null
      const response = await sessionsApi.getSession(id)
      accessToken.value = getSessionAccessToken(id)
      sessionData.value = response
      return response
    } catch (err) {
      error.value = err
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // ---- WS: annotation operations (real-time sync) -----------------------
  const addAnnotation = (annotationType, annotation) => {
    ws.send('annotation:add', { annotationType, annotation })
  }

  const updateAnnotation = (annotationType, annotationId, updates, pageIndex) => {
    ws.send('annotation:update', { annotationType, annotationId, updates, pageIndex })
  }

  const deleteAnnotation = (annotationType, annotationId, pageIndex) => {
    ws.send('annotation:delete', { annotationType, annotationId, pageIndex })
  }

  const updateSettings = (settings) => {
    ws.send('settings:update', { settings })
  }

  // ---- WS: generic message subscription ---------------------------------
  const onMessage = (type, callback) => ws.on(type, callback)

  // ---- public API -------------------------------------------------------
  return {
    // state
    sessionId,
    sessionData,
    isLoading,
    error,
    isInSession,
    isConnected: ws.isConnected,
    shareUrl,
    localParticipant,
    annotations,
    accessToken,
    // HTTP
    createSession,
    joinSession,
    leaveSession,
    updateAnnotations,
    fetchSession,
    // WS real-time
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    updateSettings,
    onMessage,
    send: ws.send,
    on: ws.on
  }
}
