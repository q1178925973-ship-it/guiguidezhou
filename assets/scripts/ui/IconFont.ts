import { Color, Font, isValid, Label, Node, resources } from 'cc'
import { createNode, THEME } from './Theme'

/**
 * Font Awesome 6 Solid 图标字体（assets/resources/fonts/fa-solid.ttf）。
 * 字体加载失败时静默降级：图标保持空白，纯文字照常运行。
 */
export const ICON = {
  trophy: '', // 奖杯：结算横幅标题
  arrowRight: '', // 右箭头：结算明细行
  comment: '', // 气泡：聊天面板
  coins: '', // 金币堆：底池
}

let cached: Font | null = null
let pending: Promise<void> | null = null
/** 字体就绪前创建的图标：字体到位后统一补上字形 */
const waiting: { label: Label; char: string }[] = []

function applyFont(label: Label, char: string): void {
  label.useSystemFont = false
  label.font = cached
  label.string = char
}

/** 预加载图标字体（不抛错，失败仅告警） */
export function loadIconFont(): Promise<void> {
  if (cached) {
    return Promise.resolve()
  }
  if (pending) {
    return pending
  }
  pending = new Promise<void>((resolve) => {
    const done = (font: Font | null): void => {
      cached = font
      waiting.forEach(({ label, char }) => {
        if (font && isValid(label)) {
          applyFont(label, char)
        }
      })
      waiting.length = 0
      if (!font) {
        console.warn('[IconFont] fa-solid.ttf 加载失败，图标不显示（不影响游戏）')
      }
      resolve()
    }
    resources.load('fonts/fa-solid', Font, (err, font) => {
      if (!err && font) {
        done(font)
        return
      }
      // 兜底：尝试 ttf 的 font 子资源路径
      resources.load('fonts/fa-solid/font', Font, (err2, font2) =>
        done(!err2 && font2 ? font2 : null),
      )
    })
  })
  return pending
}

/**
 * 创建图标 Label。字体未就绪时先创建空 Label（不占视觉），
 * 就绪后自动补上字形，调用方无需关心加载时序。
 */
export function createIcon(parent: Node, char: string, size: number, color?: Color): Label {
  const node = createNode('icon', parent)
  const label = node.addComponent(Label)
  label.fontSize = size
  label.lineHeight = size + 4
  label.color = color ?? THEME.textBright
  if (cached) {
    applyFont(label, char)
  } else {
    label.string = ''
    waiting.push({ label, char })
  }
  return label
}
