#!/usr/bin/env node
// 文档体检：体积预算 / 跨文档逐字重复 / 每节长度排行
// 用法：node scripts/check_docs.mjs          （在哪个目录跑都行，自己找 skill 根）
// 与 check_cast.mjs 的区别：那个查工程里的角色调用，这个查 skill 自己的文档。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// 预算是死的，涨了必须显式改这里 —— 改这个数字就是在承认"文档又长胖了"。
// 上限设成当前行数 + 一小段余量，所以正常改动都会先撞到它，逼你先删再加。
// 调高预算的规矩：必须在工作日志里写一句"这次加的是什么新东西"。
// 说不出来、或者说出来是"把别处的话又说了一遍"，就是该删，不该调。
const BUDGET = {
  // 2026-11-16 ↑427→462：新增 §0.38 故事契约 + §3.5 对词审计闸门（一支 56 秒片子的两个硬伤
  // ——"你对我说的情话"画成他说、罐子留在门口又回到手上——换来的两道锁）。同时合并了
  // 工作流表里重复的第 2、3 步（说的都是"一镜一镜磨到能出片"）。
  'SKILL.md': 462,
  'references/design-first.md': 550,
  'references/checklist.md': 138,
  'references/music-video.md': 80,
  'template/ANIMATION_GUIDE.md': 572,
}

// 逐字重复只在 ≥ 这个汉字数时才报。同义改写抓不到，那是另一道防线（见文末）。
const DUP_MIN = 16

const strip = (t) => t.replace(/```[\s\S]*?```/g, '')

let fails = 0
let warns = 0
const warn = (m) => { warns++; console.log('  ⚠ ' + m) }
const fail = (m) => { fails++; console.log('  ✗ ' + m) }

const texts = {}
for (const f of Object.keys(BUDGET)) {
  const p = join(ROOT, f)
  if (!existsSync(p)) { fail(`缺文件 ${f}`); continue }
  texts[f] = readFileSync(p, 'utf8')
}

console.log('\n[1] 体积预算')
for (const [f, budget] of Object.entries(BUDGET)) {
  if (!(f in texts)) continue
  const n = texts[f].split('\n').length
  const pct = ((n / budget - 1) * 100).toFixed(0)
  if (n > budget * 1.1) fail(`${f} ${n} 行 / 预算 ${budget}（+${pct}%）—— 先删后加`)
  else if (n > budget) warn(`${f} ${n} 行 / 预算 ${budget}（+${pct}%）—— 下次改动请先删`)
  else console.log(`  ✓ ${f} ${n} / ${budget}`)
}

console.log('\n[2] 跨文档逐字重复（≥' + DUP_MIN + ' 汉字）')
const sents = new Map()
for (const [f, raw] of Object.entries(texts)) {
  const bodies = strip(raw).split('\n').filter((l) => !l.trim().startsWith('|'))
  for (const seg of bodies.join('\n').split(/[。！？\n]/)) {
    const s = seg.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*>\-\s]/g, '').trim()
    if ((s.match(/[\u4e00-\u9fff]/g) || []).length < DUP_MIN) continue
    if (!sents.has(s)) sents.set(s, new Set())
    sents.get(s).add(f)
  }
}
let dup = 0
for (const [s, files] of sents) {
  if (files.size > 1) { dup++; fail(`重复：${[...files].join(' / ')} → ${s.slice(0, 40)}…`) }
}
if (!dup) console.log('  ✓ 0 处')

console.log('\n[3] SKILL.md 各节长度（前 5，纯参考不判定）')
const lines = texts['SKILL.md'] ? texts['SKILL.md'].split('\n') : []
const secs = []
const isH = (l, n) => new RegExp('^#{1,' + n + '}\\s').test(l)
for (let i = 0; i < lines.length; i++) {
  const m = /^(##)\s+(.+)/.exec(lines[i])
  if (!m) continue
  let j = i + 1
  while (j < lines.length && !isH(lines[j], 2)) j++
  const kids = []
  for (let k = i + 1; k < j; k++) {
    const h = /^###\s+(.+)/.exec(lines[k])
    if (h) kids.push({ name: h[1].trim(), at: k + 1, start: k })
  }
  if (!kids.length) { secs.push({ name: m[2].trim(), n: j - i, at: i + 1 }); continue }
  for (let x = 0; x < kids.length; x++) {
    const end = x + 1 < kids.length ? kids[x + 1].start : j
    secs.push({ name: kids[x].name, n: end - kids[x].start, at: kids[x].at })
  }
}
secs.sort((a, b) => b.n - a.n)
for (const s of secs.slice(0, 5)) console.log(`  ${String(s.n).padStart(3)} 行 · L${s.at} · ${s.name}`)
console.log('  → 编排层一节超过 ~25 行，通常是在抄判据层的表格，挪回去只留指向。')

// ── 下限护栏：拦住"内容静默消失" ──────────────────────────────────────
// 预算是上限，只拦得住"加太多"。删太多没有任何人拦：一次 Edit 把要保留的整行
// 当成 old_string、new_string 里又忘了原样带上它，那行就凭空没了，退出码照样是 0，
// 而且残骸看上去还挺通顺，肉眼扫过去不觉得缺什么。所以补一道下限：
// 每个小节标题、每条清单条目的首句存成快照，少了就报错。
// 真要删，跑 --save 重记一遍 —— 那一步就是书面承认"这批内容是我删的"。
const MANIFEST = join(ROOT, 'scripts/doc_anchors.json')

function anchors(text) {
  const out = { h: [], i: [] }
  let fence = false
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; continue }
    if (fence) continue
    const h = /^#{2,4}\s+(.+)$/.exec(line)
    if (h) { out.h.push(h[1].trim()); continue }
    const it = /^\s*-\s+\[[ x]\]\s*(.+)$/.exec(line)
    if (it) out.i.push(it[1].replace(/[*`]/g, '').trim().slice(0, 12))
  }
  return out
}

const cur = {}
for (const [f, t] of Object.entries(texts)) cur[f] = anchors(t)

if (process.argv.includes('--save')) {
  writeFileSync(MANIFEST, JSON.stringify(cur, null, 1) + '\n')
  const n = Object.values(cur).reduce((a, v) => a + v.h.length + v.i.length, 0)
  console.log(`\n已重记锚点 ${n} 条 → scripts/doc_anchors.json`)
  process.exit(0)
}

console.log('\n[4] 内容没有静默消失（锚点对比）')
if (!existsSync(MANIFEST)) {
  writeFileSync(MANIFEST, JSON.stringify(cur, null, 1) + '\n')
  console.log('  · 首次生成锚点快照')
} else {
  const old = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  let lost = 0
  for (const [f, v] of Object.entries(old)) {
    if (!cur[f]) { fail(`整份文件不见了：${f}`); lost++; continue }
    for (const k of ['h', 'i']) {
      const now = new Set(cur[f][k])
      for (const a of v[k]) {
        if (now.has(a)) continue
        lost++
        fail(`${f} 少了${k === 'h' ? '小节' : '清单条目'}：「${a}」`)
      }
    }
  }
  if (!lost) console.log('  ✓ 全部还在')
  else console.log('  → 误删就补回来；真要删，跑 `node scripts/check_docs.mjs --save` 重记一遍。')
}

console.log(`\n${fails ? '✗' : '✓'} ${fails} 错误 / ${warns} 提醒`)
console.log('注意：[2] 抓不到"同义改写"，[4] 只抓得到"整条消失"、抓不到"改坏了但还在"。')
console.log('     改一段之前先看一眼 old_string：它必须是**短锚点**，且 new_string 里原样带上了它。')
console.log('     拿要保留的整行当 old_string，是最容易把内容吃掉的一种改法。\n')
process.exit(fails ? 1 : 0)
