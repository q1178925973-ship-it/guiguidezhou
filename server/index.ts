import { createServer, IncomingMessage, ServerResponse } from 'http'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname, join, normalize, resolve } from 'path'
import { gzipSync } from 'zlib'
import { WebSocket, WebSocketServer } from 'ws'
import { AccountStore } from './AccountStore'
import { Table } from './Table'
import { ClientMsg, ServerMsg } from '../assets/scripts/net/Protocol'

/**
 * 联机服务器入口：
 * - HTTP 伺服同目录下 web/ 内的 Cocos web 构建产物（朋友访问链接即玩）
 * - 同端口挂 WebSocket（游戏通信），部署只需开一个端口
 */

const PORT = Number(process.env.PORT || 8080)
const WEB_DIR = resolve(__dirname, 'web')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
}

/** 可 gzip 的文本类资源（png / wasm 本身已是压缩格式，跳过） */
const GZIP_EXTS = new Set(['.html', '.js', '.css', '.json', '.svg', '.ttf', '.ico'])

/** gzip 结果缓存（键：路径 + mtime），避免每次请求重复压缩 */
const gzipCache = new Map<string, { mtime: number; data: Buffer }>()

/** 二进制资源缓存 7 天；文本类（文件名不带 hash）只缓存 10 分钟保证发版及时生效 */
const LONG_CACHE = new Set(['.png', '.jpg', '.jpeg', '.svg', '.ico', '.ttf', '.woff', '.woff2', '.wasm', '.bin', '.mp3', '.ogg', '.wav'])

/**
 * 伺服静态文件：文本类按 Accept-Encoding 回 gzip；
 * index.html 走 no-cache，二进制长缓存，其余短缓存。
 */
function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  const ext = extname(filePath).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'
  try {
    const stat = statSync(filePath)
    const data = readFileSync(filePath)
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Cache-Control':
        ext === '.html'
          ? 'no-cache'
          : LONG_CACHE.has(ext)
            ? 'public, max-age=604800'
            : 'public, max-age=600',
    }
    if ((req.headers['accept-encoding'] ?? '').includes('gzip') && GZIP_EXTS.has(ext)) {
      let hit = gzipCache.get(filePath)
      if (!hit || hit.mtime !== stat.mtimeMs) {
        hit = { mtime: stat.mtimeMs, data: gzipSync(data, { level: 6 }) }
        gzipCache.set(filePath, hit)
      }
      headers['Content-Encoding'] = 'gzip'
      headers['Content-Length'] = String(hit.data.length)
      res.writeHead(200, headers)
      res.end(hit.data)
      return
    }
    headers['Content-Length'] = String(data.length)
    res.writeHead(200, headers)
    res.end(data)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  }
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`ok players-table running`)
    return
  }
  if (!existsSync(WEB_DIR)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('德州扑克服务器运行中：web/ 目录还没有构建产物，请上传 Cocos web 构建输出')
    return
  }
  // 路径穿越防护：解析后必须仍在 WEB_DIR 内
  let filePath = normalize(join(WEB_DIR, decodeURIComponent(url.pathname)))
  if (!filePath.startsWith(WEB_DIR)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html')
  }
  if (!existsSync(filePath)) {
    // 单页回退：带查询参数的未知路径也回首页（?online=1 等由前端解析）
    filePath = join(WEB_DIR, 'index.html')
    if (!existsSync(filePath)) {
      res.writeHead(404)
      res.end('Not Found')
      return
    }
  }
  serveFile(req, res, filePath)
})

const wss = new WebSocketServer({ server })
// 账号库：默认落在 data/accounts.db；自检用 TEXAS_DB=:memory: 隔离
const store = new AccountStore(process.env.TEXAS_DB ?? join(__dirname, 'data', 'accounts.db'))
const table = new Table(store)

wss.on('connection', (ws: WebSocket) => {
  let joined = false
  const reply = (msg: ServerMsg): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }
  ws.on('message', (raw) => {
    let msg: ClientMsg
    try {
      msg = JSON.parse(String(raw)) as ClientMsg
    } catch {
      return
    }
    // 首条消息三选一：游客 join / 注册 register / 登录 login（账密或 token）。
    // 认证失败不占用连接，可换凭据在同一条连接上重试。
    if (!joined && (msg.t === 'register' || msg.t === 'login')) {
      const r =
        msg.t === 'register'
          ? store.register(String(msg.name ?? ''), String(msg.pass ?? ''))
          : msg.token
            ? store.loginByToken(String(msg.token))
            : store.login(String(msg.name ?? ''), String(msg.pass ?? ''))
      if (!r.ok) {
        reply({ t: 'auth-err', msg: r.msg })
        return
      }
      reply({
        t: 'auth-ok',
        token: r.token,
        name: r.account.name,
        won: r.account.won,
        played: r.account.played,
      })
      joined = true
      table.join(ws, r.account.name, r.account.name)
      return
    }
    if (msg.t === 'join') {
      if (!joined) {
        joined = true
        table.join(ws, msg.name, null)
      }
      return
    }
    if (joined) {
      table.onMessage(ws, msg)
    }
  })
  ws.on('close', () => table.leave(ws))
  ws.on('error', () => undefined)
})

// 心跳：清掉死连接，防代理层断链
setInterval(() => {
  wss.clients.forEach((ws) => ws.ping())
}, 30000)

server.listen(PORT, () => {
  console.log(`[texas-server] http/ws 服务已启动：端口 ${PORT}，静态目录 ${WEB_DIR}`)
})
