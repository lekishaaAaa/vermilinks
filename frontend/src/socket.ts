import { io, ManagerOptions, Socket, SocketOptions } from 'socket.io-client';

let socketRef: Socket | null = null;

const inferDefaultUrl = (): string => {
  if (process.env.REACT_APP_WS_URL && process.env.REACT_APP_WS_URL.trim().length > 0) {
    return process.env.REACT_APP_WS_URL.trim();
  }
  if (process.env.REACT_APP_BACKEND_URL && process.env.REACT_APP_BACKEND_URL.trim().length > 0) {
    return process.env.REACT_APP_BACKEND_URL.trim();
  }
  if (typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin;
  }
  return 'https://vermilinks.onrender.com';
};

const defaultUrl = inferDefaultUrl();
export const SOCKET_URL = defaultUrl;

const baseOptions: Partial<ManagerOptions & SocketOptions> = {
  transports: ['websocket'],
  withCredentials: true,
  reconnection: true,
  reconnectionAttempts: 5,
  timeout: 20000,
};

export function createSocket(url: string = defaultUrl, options: Partial<ManagerOptions & SocketOptions> = {}) {
  if (socketRef && socketRef.connected) {
    return socketRef;
  }

  const mergedOptions = { ...baseOptions, ...options };
  socketRef = io(url, mergedOptions);
  return socketRef;
}

export function getSocket() {
  if (!socketRef) {
    return createSocket();
  }
  return socketRef;
}

export function disconnectSocket() {
  if (socketRef) {
    socketRef.disconnect();
    socketRef = null;
  }
}

export const socket = getSocket();
