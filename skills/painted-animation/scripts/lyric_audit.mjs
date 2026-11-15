#!/usr/bin/env node
// 对词审计：把 story.json 的「意图」和 src/ 里的「事实」对账，逐行查谁对谁、道具断没断。
// 用法：node scripts/lyric_audit.mjs [--quiet]
//   在工程目录跑。真值来源：src/karaoke.js 的 LY（歌词行与时间）、src/scenes/*.js 的 shots()（切点）。
//   产出 AUDIT.md；有 ❌ 时退出码 1 —— 4a 静帧审片之前必须先清零。
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const QUIET = process.argv.includes('--quiet')
const CWD = process.cwd()
const say = (...a) => { if (!QUIET) console.log(...a) }

// ---------- 读事实 ----------
const need = (p, hint) => {
  if (!existsSync(join(CWD, p))) { console.error(`✗ 找不到 ${p}${hint ? ' —— ' + hint : ''}`); process.exit(2) }
  return readFileSync(join(CWD, p), 'utf8')
}

const karaoke = need('src/karaoke.js', '歌词表不在，先做 LRC 对齐')
const lyBlock = karaoke.match(/const\s+LY\s*=\s*\[([\s\S]*?)\n\];/)
if (!lyBlock) { console.error('✗ src/karaoke.js 里没找到 const LY = [...]'); process.exit(2) }
const LINES = [...lyBlock[1].matchAll(/\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*'([^']*)'/g)]
  .map((m, k) => ({ i: k + 1, t0: +m[1], t1: +m[2], text: m[3] }))
if (!LINES.length) { console.error('✗ LY 解析出来是空的'); process.exit(2) }

const SHOTS = []
for (const f of readdirSync(join(CWD, 'src/scenes')).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(join(CWD, 'src/scenes', f), 'utf8')
  for (const blk of src.matchAll(/shots\(\s*\[([\s\S]*?)\]\s*\)/g)) {
    for (const m of blk[1].matchAll(/\[\s*([\d.]+)\s*,\s*[A-Za-z_$][\w$.]*\s*,\s*'([^']+)'\s*\]/g)) {
      SHOTS.push({ t0: +m[1], id: m[2], file: f })
    }
  }
}
SHOTS.sort((a, b) => a.t0 - b.t0)
if (SHOTS.length < 2) { console.error('✗ 没解析到 shots()——检查 src/scenes/*.js 的注册写法'); process.exit(2) }

let DUR = 0
const cfg = existsSync(join(CWD, 'src/config.js')) ? readFileSync(join(CWD, 'src/config.js'), 'utf8') : ''
DUR = +(cfg.match(/duration\s*:\s*([\d.]+)/) || [])[1] || LINES[LINES.length - 1].t1
SHOTS.forEach((s, k) => { s.t1 = k + 1 < SHOTS.length ? SHOTS[k + 1].t0 : DUR })
const shotIdx = new Map(SHOTS.map((s, k) => [s.id, { ...s, k }]))

// ---------- 读意图 ----------
if (!existsSync(join(CWD, 'story.json'))) {
  console.error('✗ 没有 story.json —— 先按 references/story-contract.md 把 0.35 的解读落成契约')
  process.exit(2)
}
const story = JSON.parse(readFileSync(join(CWD, 'story.json'), 'utf8'))
const SL = new Map((story.lines || []).map((l) => [l.i, l]))
const SH = new Map((story.shots || []).map((s) => [s.id, s]))
const PROPS = story.props || []

// ---------- 审计 ----------
const bad = [], warn = []
const rows = []

for (const l of LINES) {
  const sl = SL.get(l.i)
  const cover = SHOTS.filter((s) => Math.min(l.t1, s.t1) - Math.max(l.t0, s.t0) > 0.05)
  const primary = cover.slice().sort((a, b) =>
    (Math.min(l.t1, b.t1) - Math.max(l.t0, b.t0)) - (Math.min(l.t1, a.t1) - Math.max(l.t0, a.t0)))[0]
  const st = SH.get(primary?.id) || {}
  const judge = []

  if (!cover.length) { bad.push(`C1 第 ${l.i} 行「${l.text}」没有任何镜头覆盖（${l.t0}–${l.t1}s）`); judge.push('❌ 空档') }
  if (!sl) warn.push(`C7 第 ${l.i} 行「${l.text}」契约里没写（说话人/动作缺失）`)
  if (cover.length > 3) { warn.push(`C6 第 ${l.i} 行被 ${cover.length} 镜覆盖：${cover.map((c) => c.id).join('/')}`); judge.push('⚠ 偏碎') }

  if (sl && sl.speaker && sl.speaker !== 'none' && st.speaker && st.speaker !== sl.speaker) {
    bad.push(`C2 第 ${l.i} 行「${l.text}」说话人是 ${sl.speaker}，但 ${primary.id} 里说话的是 ${st.speaker}`)
    judge.push('❌ 说话人反了')
  }
  // C3 查的是「这行的画面主体在不在」，不是「唱的人在不在」——MV 里唱的人可以不在画上（视角镜）。
  if (sl?.about && st.cast && !st.cast.includes(sl.about)) {
    bad.push(`C3 第 ${l.i} 行「${l.text}」的画面主体 ${sl.about} 不在 ${primary.id} 里（cast: ${st.cast.join('/')}）`)
    judge.push('❌ 主体缺席')
  }
  if (sl?.key?.shot) {
    const ks = shotIdx.get(sl.key.shot)
    if (!ks) warn.push(`C4 第 ${l.i} 行的关键镜 ${sl.key.shot} 不存在`)
    else {
      // 判据：关键动作应该落在这行词的时间窗里（容许早 1.2s 做预备）。
      // 早于窗口 = 观众还没听到词就先看到动作；晚于窗口尾 = 词唱完了动作才来。
      const early = +(l.t0 - ks.t0).toFixed(2)
      const late = +(ks.t0 - l.t1).toFixed(2)
      if (early > 1.2 || late > -0.5) {
        warn.push(`C4 第 ${l.i} 行「${l.text}」的关键动作（${sl.key.what || ''}）在 ${sl.key.shot}（${ks.t0}s），` +
          (early > 1.2 ? `比这行早 ${early}s` : `贴着这行结尾（晚 ${Math.max(0, late)}s）`))
        judge.push(early > 1.2 ? '⚠ 动作早一拍' : '⚠ 动作贴尾')
      }
    }
  }
  rows.push({ ...l, sl, cover, primary, judge })
}

for (const p of PROPS) {
  const chain = (p.states || []).filter(([id]) => shotIdx.has(id))
  const term = new Set(p.terminal || [])
  let dead = null
  for (const [id, state] of chain) {
    if (dead && !term.has(state)) {
      bad.push(`C5 道具「${p.name}」在 ${dead[0]} 已经是「${dead[1]}」（终态），到 ${id} 又变成「${state}」——复活了`)
      break
    }
    if (!dead && term.has(state)) dead = [id, state]
  }
  for (const [id] of p.states || []) if (!shotIdx.has(id)) warn.push(`C5 道具「${p.name}」引用了不存在的镜 ${id}`)
}

// ---------- 报告 ----------
const f2 = (x) => x.toFixed(2)
const md = []
md.push(`# 对词审计 · ${new Date().toISOString().slice(0, 10)}`)
md.push('')
md.push(`歌 ${DUR}s ／ 歌词 ${LINES.length} 行 ／ 镜头 ${SHOTS.length} 个 ／ 道具 ${PROPS.length} 件`)
md.push('')
md.push(bad.length ? `## 结论：❌ ${bad.length} 错 ${warn.length} 提醒 —— 不许发关键帧` : `## 结论：✅ 0 错 ${warn.length} 提醒`)
md.push('')
if (bad.length) { md.push('### 必须先修'); bad.forEach((b) => md.push(`- ${b}`)); md.push('') }
if (warn.length) { md.push('### 提醒'); warn.forEach((w) => md.push(`- ${w}`)); md.push('') }
md.push('## 逐行')
md.push('')
md.push('| # | 秒 | 歌词 | 说话人 | 覆盖镜 | 判定 |')
md.push('|---|---|---|---|---|---|')
for (const r of rows) {
  md.push(`| ${r.i} | ${f2(r.t0)}–${f2(r.t1)} | ${r.text} | ${r.sl?.speaker ?? '—'} | ${r.cover.map((c) => c.id).join(' ') || '—'} | ${r.judge.join(' ') || '✓'} |`)
}
md.push('')
if (PROPS.length) {
  md.push('## 道具')
  md.push('')
  md.push('| 道具 | 状态链 | 判定 |')
  md.push('|---|---|---|')
  for (const p of PROPS) {
    md.push(`| ${p.name} | ${(p.states || []).map(([i, s]) => `${i}:${s}`).join(' → ')} | ${bad.some((b) => b.includes(p.name)) ? '❌' : '✓'} |`)
  }
  md.push('')
}
writeFileSync(join(CWD, 'AUDIT.md'), md.join('\n'))

say(md.slice(0, 6).join('\n'))
say('\n逐行：')
for (const r of rows) say(`  ${String(r.i).padStart(2)} ${f2(r.t0).padStart(6)} ${r.text.padEnd(18, '　').slice(0, 18)} ${(r.judge.join(' ') || '✓')}`)
say(`\n→ AUDIT.md 已写。${bad.length ? `❌ ${bad.length} 处必须先修，不许发关键帧。` : `✅ 通过${warn.length ? `（${warn.length} 条提醒）` : ''}。`}`)
process.exit(bad.length ? 1 : 0)
