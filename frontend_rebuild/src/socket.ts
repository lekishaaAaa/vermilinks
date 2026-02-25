import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

const resolveBaseUrl = () => {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (raw && raw.trim().length > 0) {
    return raw.trim()
  }
  return window.location.origin
}

export const getSocket = () => {
  if (socket) {
    return socket
  }

  socket = io(resolveBaseUrl(), {
    transports: ['websocket'],
  })

  return socket
}