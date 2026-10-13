// src/composables/useWebSocket.js
// Singleton WebSocket connection with typed event bus.
//
// Usage:
//   const { connect, send, on, disconnect, isConnected } = useWebSocket()
//   await connect('session-uuid')
//   const unsub = on('joined', payload => { ... })
//   send('cursor:move', { x, y, pageIndex: 0 })

import { ref } from 'vue'

// ---- helpers ----------------------------------------------------------------
function normalizeWsBase(raw) {
  let u = (raw || '').trim()
  if (!u) {
    if (typeof window !== 'undefined' && window.location) {
      u = window.location.origin
    } else {
      u = 'http://localhost:3001'
    }
  }
  u = u.replace(/\/+$/, '').replace(/\/ws$/, '')
  if (u.startsWith('http://'))  u = 'ws://'  + u.slice('http://'.length)
  if (u.startsWith('https://')) u = 'wss://' + u.slice('https://'.length)
  return u
}

// ---- singleton state --------------------------------------------------------
const socket          = ref(null)
const isConnected     = ref(false)
const connectionError = ref(null)

// Event listeners: Map<messageType, Set<callback>>
const listeners = new Map()

let reconnectTimer  = null
let reconnectTarget = null
let lastJoinMessage = null
const RECONNECT_DELAY = 3000

// ---- internal ---------------------------------------------------------------
function dispatch(type, payload) {
  const cbs = listeners.get(type)
  if (cbs) {
    cbs.forEach(cb => {
      try { cb(payload) } catch (e) { console.error('[WS] listener error:', e) }
    })
  }
}

function onRawMessage(event) {
  try {
    const data = JSON.parse(event.data)
    dispatch(data.type, data.payload)
  } catch (_) { /* ignore */ }
}

function scheduleReconnect() {
  if (reconnectTimer || !reconnectTarget) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (!isConnected.value && reconnectTarget) {
      rawConnect(reconnectTarget.url).catch(() => scheduleReconnect())
    }
  }, RECONNECT_DELAY)
}

function rawConnect(url) {
  return new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(url)
      ws.onopen = () => {
        socket.value    = ws
        isConnected.value = true
        connectionError.value = null
        if (lastJoinMessage) ws.send(lastJoinMessage)
        resolve()
      }
      ws.onmessage = onRawMessage
      ws.onclose = () => {
        isConnected.value = false
        socket.value = null
        scheduleReconnect()
      }
      ws.onerror = (err) => {
        connectionError.value = err
        isConnected.value = false
        socket.value = null
        reject(err)
      }
    } catch (err) {
      connectionError.value = err
      reject(err)
    }
  })
}

// ---- public API (singleton) -------------------------------------------------
export function useWebSocket() {
  /** Open (or re-open) a WebSocket connection. */
  const connect = (sessionId) => {
    if (socket.value) {
      try { socket.value.close() } catch (_) { /* */ }
      socket.value = null
      isConnected.value = false
    }
    lastJoinMessage = null
    const WS_BASE = normalizeWsBase(
      (typeof process !== 'undefined' && process.env && process.env.VUE_APP_WS_URL) || ''
    )
    const url = sessionId
      ? `${WS_BASE}/ws?sessionId=${encodeURIComponent(sessionId)}`
      : `${WS_BASE}/ws`
    reconnectTarget = { url }
    return rawConnect(url)
  }

  /** Send a typed message: { type, payload } → JSON */
  const send = (type, payload) => {
    if (type === 'join') lastJoinMessage = JSON.stringify({ type, payload })
    if (socket.value && isConnected.value) {
      socket.value.send(type === 'join' ? lastJoinMessage : JSON.stringify({ type, payload }))
    }
  }

  /** Subscribe to a message type. Returns an unsubscribe function. */
  const on = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(callback)
    return () => {
      const set = listeners.get(type)
      if (set) {
        set.delete(callback)
        if (set.size === 0) listeners.delete(type)
      }
    }
  }

  /** Disconnect and stop auto-reconnect. */
  const disconnect = () => {
    reconnectTarget = null
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    if (socket.value) { try { socket.value.close() } catch (_) { /* */ } }
    socket.value = null
    isConnected.value = false
    listeners.clear()
    lastJoinMessage = null
  }

  return { socket, isConnected, connectionError, connect, send, on, disconnect }
}
