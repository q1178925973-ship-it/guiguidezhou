import { ClientMsg, ServerMsg } from './Protocol'

/**
 * 联机客户端：封装 WebSocket 连接与 JSON 收发。
 * 仅面向 web 平台（联机模式本就为浏览器访问设计）。
 */

/** 服务器地址：URL 参数 server 优先，线上同源同端口，开发回落本地 8080 */
export function resolveServerUrl(): string {
  if (typeof location === 'undefined') {
    return 'ws://localhost:8080'
  }
  const custom = new URLSearchParams(location.search).get('server')
  if (custom) {
    return custom
  }
  if (location.protocol.startsWith('http')) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}`
  }
  return 'ws://localhost:8080'
}

/** 是否以联机模式打开（分享链接带 ?online=1） */
export function isOnlineMode(): boolean {
  if (typeof location === 'undefined') {
    return false
  }
  return new URLSearchParams(location.search).has('online')
}

export class NetClient {
  private ws: WebSocket | null = null
  private closedByUs = false
  /** 收到服务器消息 */
  onMessage: (msg: ServerMsg) => void = () => undefined
  /** 连接断开（掉线 / 服务器重启） */
  onClose: () => void = () => undefined
  /** 连接建立（此时应立刻发首条认证消息：join / register / login） */
  onOpen: () => void = () => undefined

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  connect(): void {
    this.closedByUs = false
    const url = resolveServerUrl()
    console.log(`[net] 连接 ${url}`)
    const ws = new WebSocket(url)
    this.ws = ws
    ws.onopen = () => {
      console.log('[net] 已连接，等待认证')
      this.onOpen()
    }
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)) as ServerMsg)
      } catch (err) {
        console.warn('[net] 无法解析服务器消息', err)
      }
    }
    ws.onclose = () => {
      console.warn('[net] 连接关闭')
      if (!this.closedByUs) {
        this.onClose()
      }
    }
    ws.onerror = () => undefined
  }

  /** 发送首条认证消息（连接建立前后都可调用，未连接时静默丢弃） */
  auth(msg: ClientMsg): void {
    this.send(msg)
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  close(): void {
    this.closedByUs = true
    this.ws?.close()
    this.ws = null
  }
}
