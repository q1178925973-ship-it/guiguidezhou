import { createServer, IncomingMessage, ServerResponse } from 'http'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { extname, join, normalize, resolve } from 'path'
import { brotliCompressSync, gzipSync } from 'zlib'
import { WebSocket, WebSocketServer } from 'ws'
import { AccountStore } from './AccountStore'
import { RoomManager } from './RoomManager'
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
  '.webp': 'image/webp',
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

/** 可压缩的文本类资源（png / webp / wasm 本身已是压缩格式，跳过） */
const GZIP_EXTS = new Set(['.html', '.js', '.css', '.json', '.svg', '.ttf', '.ico'])

/** 压缩结果缓存（键：编码:路径 + mtime），避免每次请求重复压缩 */
const zipCache = new Map<string, { mtime: number; data: Buffer }>()

/** 二进制资源缓存 7 天；文本类（文件名不带 hash）只缓存 10 分钟保证发版及时生效 */
const LONG_CACHE = new Set(['.png', '.webp', '.jpg', '.jpeg', '.svg', '.ico', '.ttf', '.woff', '.woff2', '.wasm', '.bin', '.mp3', '.ogg', '.wav'])

/** md5Cache 构建的文件名自带内容哈希（Cocos 默认 5 位 hex，点或短横线分隔，如 xxx.30235.js / _virtual_cc-5d09224f.js）：内容永不变，可缓存一年 */
const HASHED_NAME = /[-.][0-9a-f]{5,10}\.[a-z0-9]+$/

/**
 * 伺服静态文件：文本类按 Accept-Encoding 回 brotli（更小）或 gzip；
 * index.html 走 no-cache，带哈希文件名缓存一年（immutable），二进制长缓存，其余短缓存。
 */
function serveFile(req: IncomingMessage, res: ServerResponse, filePath: string): void {
  const ext = extname(filePath).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'
  try {
    const stat = statSync(filePath)
    const data = readFileSync(filePath)
    const accept = req.headers['accept-encoding'] ?? ''
    const enc = GZIP_EXTS.has(ext)
      ? accept.includes('br')
        ? 'br'
        : accept.includes('gzip')
          ? 'gzip'
          : ''
      : ''
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Cache-Control':
        ext === '.html'
          ? 'no-cache'
          : HASHED_NAME.test(filePath)
            ? 'public, max-age=31536000, immutable'
            : LONG_CACHE.has(ext)
              ? 'public, max-age=604800'
              : 'public, max-age=600',
    }
    if (enc) {
      const key = `${enc}:${filePath}`
      let hit = zipCache.get(key)
      if (!hit || hit.mtime !== stat.mtimeMs) {
        hit = { mtime: stat.mtimeMs, data: enc === 'br' ? brotliCompressSync(data) : gzipSync(data, { level: 6 }) }
        zipCache.set(key, hit)
      }
      headers['Content-Encoding'] = enc
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
  // 引擎减负：本项目零物理、零 spine，用合法的空 SystemJS 模块顶替引擎启动期
  // 预载的这两类 wasm/asm 模块（首屏省约 2.3MB）。引擎侧拿到空导出会走各自的
  // 失败 catch，只在控制台留一两行无害提示，游戏完全不受影响。
  if (/^\/cocos-js\/(assets\/)?(bullet|spine)/.test(url.pathname)) {
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    res.end('System.register([],(function(){"use strict";return{execute:function(){}}}))')
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
    // md5Cache 构建会把文件重命名为带哈希（xxx.30235.js），但自定义 index.html 模板里
    // 写的是不带哈希的固定名（src/polyfills.bundle.js 等）：无哈希请求重定向到带哈希文件，
    // 浏览器随后的缓存命中走 immutable 一年强缓存
    const hashed = findHashedFile(filePath)
    if (hashed) {
      const rel = hashed.slice(WEB_DIR.length).split('\\').join('/')
      res.writeHead(307, { Location: encodeURI(rel), 'Cache-Control': 'no-cache' })
      res.end()
      return
    }
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

/** 无哈希路径 → 带哈希文件 的映射表（启动时扫一遍 web/，重部署后随服务重启重建） */
let hashedFileMap: Map<string, string> | null = null
function findHashedFile(filePath: string): string | null {
  if (!hashedFileMap) {
    hashedFileMap = new Map()
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        const m = name.match(/^(.+?)[-.]([0-9a-f]{5,10})(\.[a-z0-9]+)$/)
        if (m) {
          hashedFileMap.set(normalize(join(dir, `${m[1]}${m[3]}`)), full)
        }
      }
    }
    try {
      walk(WEB_DIR)
    } catch {
      /* 目录异常时保持空表，走原回退逻辑 */
    }
  }
  return hashedFileMap.get(filePath) ?? null
}

const wss = new WebSocketServer({ server })
// 账号库：默认落在 data/accounts.db；自检用 TEXAS_DB=:memory: 隔离
const store = new AccountStore(process.env.TEXAS_DB ?? join(__dirname, 'data', 'accounts.db'))
// 多房间：认证后进大厅，createRoom / joinRoom 入房（连接状态机 idle → 大厅 ⇄ 房间）
const rooms = new RoomManager(store)

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
      rooms.attach(ws, r.account.name, r.account.name)
      return
    }
    if (msg.t === 'join') {
      if (!joined) {
        joined = true
        rooms.attach(ws, String(msg.name ?? ''), null)
      }
      return
    }
    if (!joined) {
      return
    }
    // 房间命令（任意态）：listRooms / createRoom / joinRoom / leaveRoom
    if (rooms.handleCommand(ws, msg)) {
      return
    }
    // 牌桌内消息：act / chat / voteReset / showCards / getHistory（大厅态静默丢弃）
    rooms.forward(ws, msg)
  })
  ws.on('close', () => rooms.handleClose(ws))
  ws.on('error', () => undefined)
})

// 心跳：清掉死连接，防代理层断链
setInterval(() => {
  wss.clients.forEach((ws) => ws.ping())
}, 30000)

server.listen(PORT, () => {
  console.log(`[texas-server] http/ws 服务已启动：端口 ${PORT}，静态目录 ${WEB_DIR}`)
})
