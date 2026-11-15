#!/usr/bin/env node
// check_cast.mjs — 角色一致性的静态检查。渲之前跑一遍，秒级，不碰浏览器：
//   在模板目录：node ../../scripts/check_cast.mjs
//   在仓库根：  node skills/painted-animation/scripts/check_cast.mjs
//   在复制出来的工程里（scripts/ 被一起复制时）：node scripts/check_cast.mjs
//
// ✗ 错误（这四类运行时 guard 也会拦，但静态查不用等渲染，还能给出行号）：
//   直接调 clawd(           绕过包装 → 没有配色、boilKey、配件，也没有 guard
//   { ...CAST.x } 整块 spread   会把 rig 带进 opts
//   emotions( 不带 base     换表情会退回默认赭色（场景里应走 xMood 包装）
//   props 里的键 CAST 没声明   打错字不会静默失效
// ⚠ 提醒（机器判不了对错，列出来人工过一遍）：
//   noLegs                  合法，但要确认腿是真在画框外/水里，不是图省事
//   命名像人体部件            palm / finger / eyelid / pupil …：变量名就是意图，多半在给角色加它没有的部件
//   角色调用的 u 超上限       推太近时框里只剩一块颜色，竖缝眼会被读成窗子
//   view 字面量清单          跨镜朝向变化必须走 turn() 接住，哪几处变了只有人能判

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let root = join(here, '..', 'template');                    // skill 仓库里：scripts/ 旁边是 template/
if (!existsSync(join(root, 'src'))) root = here;            // 复制进工程后：src/ 与脚本同级
if (!existsSync(join(root, 'src'))) {
  console.error(`找不到 src/（试过 ${join(here, '..', 'template')} 和 ${here}）`);
  process.exit(2);
}
const castSrc = readFileSync(join(root, 'src', 'cast.js'), 'utf8');
const sceneDir = join(root, 'src', 'scenes');
const scenes = existsSync(sceneDir) ? readdirSync(sceneDir).filter(f => f.endsWith('.js')) : [];
if (!scenes.length) { console.log('没有场景文件，没什么可查'); process.exit(0); }

// ---- 从 cast.js 提取每个角色的 props 键（括号配对，能扛 rig 的嵌套）----
const propKeys = new Set();
let castBlock = '';
{
  const i = castSrc.indexOf('const CAST');
  const start = castSrc.indexOf('{', i);
  let d = 0, end = start;
  for (; end < castSrc.length; end++) { if (castSrc[end] === '{') d++; else if (castSrc[end] === '}') { d--; if (!d) break; } }
  castBlock = castSrc.slice(start, end + 1);
  for (const m of castBlock.matchAll(/props:\s*\{([^}]*)\}/g))
    for (const k of m[1].matchAll(/(\w+)\s*:/g)) propKeys.add(k[1]);
}
// 角色名：CAST 表里的顶层键（两个空格缩进），用来只检查角色调用的第 3 个参数，不误伤别的画图函数
const castNames = [...new Set([...castBlock.matchAll(/^ {2}(\w+)\s*:\s*\{/gm)].map(m => m[1]))];
const FRAME_H = 1080, HEAD_U = 6;
const U_MAX = Math.round(FRAME_H / HEAD_U * .78);   // ≈140：再往上头部顶住画框，框里只剩一块颜色

// ---- 找一个调用的完整文本（配平括号），回 call(start, end) ----
function eachCall(src, name, call) {
  let i = 0;
  while ((i = src.indexOf(name + '(', i)) !== -1) {
    if (i && /[\w$.]/.test(src[i - 1]) && !(src.slice(i - 1, i) === '.' && false)) { i += name.length; continue; }
    let d = 0, j = i + name.length;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === '(') d++;
      else if (c === ')') { d--; if (!d) break; }
      else if (c === '"' || c === "'" || c === '`') { const q = c; j++; while (j < src.length && src[j] !== q) { if (src[j] === '\\') j++; j++; } }
    }
    call(i, j + 1, src.slice(i, j + 1));
    i = j + 1;
  }
}
const lineOf = (src, off) => src.slice(0, off).split('\n').length;
const topArgs = t => {   // 顶层逗号切参数（跳过字符串与嵌套括号）
  const out = []; let d = 0, cur = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '(' || c === '[' || c === '{') d++;
    else if (c === ')' || c === ']' || c === '}') d--;
    else if (c === ',' && !d) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
};

const errors = [], warns = [];
for (const f of scenes) {
  const path = join(sceneDir, f), src = readFileSync(path, 'utf8');
  // 去掉注释再匹配（行注释与块注释），避免把说明文字当代码
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  eachCall(code, 'clawd', (a, b) => errors.push([f, lineOf(src, a), '直接调 clawd( —— 绕过包装：没有配色、boilKey、配件，也没有 guard。改走 CAST 生成的角色函数']));
  for (const m of code.matchAll(/\{\s*\.\.\.\s*CAST[\s.]}|\{\s*\.\.\.\s*CAST\.\w+/g))
    errors.push([f, lineOf(src, m.index), '{ ...CAST.x } 整块 spread 会把 rig 带进 opts —— 只传需要的东西']);
  eachCall(code, 'emotions', (a, b, t) => {
    const args = topArgs(t.slice('emotions('.length, -1));
    const hasBase = args.length >= 3 && /base\s*:/.test(args[2]);
    if (!hasBase) errors.push([f, lineOf(src, a), 'emotions( 不带 base —— 换表情会退回默认赭色。用 cast.js 生成的 xMood 包装']);
  });
  for (const m of code.matchAll(/props\s*:\s*\{([^}]*)\}/g))
    for (const k of m[1].matchAll(/(\w+)\s*:/g))
      if (!propKeys.has(k[1])) errors.push([f, lineOf(src, m.index), `props 里的 "${k[1]}" 没在 cast.js 的 CAST 里声明 —— 打错字不会静默失效，先去 CAST 加或改对名字`]);
  for (const m of code.matchAll(/\bnoLegs\b/g))
    warns.push([f, lineOf(src, m.index), 'noLegs —— 合法，但确认腿是真在画框外/水里，不是图省事']);
  // 多角色同框：归属错误（歌词里该 B 做的事画成了 A 做、B 的东西挂到 A 身上）发生在写代码的时刻，
  // 机器判不了对错，但能把"这个文件里有几个人"顶到眼前，逼着人对着分镜的"谁"列逐镜核对。
  {
    const who = new Map();
    for (const n of castNames) eachCall(code, n, (a) => { if (!who.has(n)) who.set(n, lineOf(src, a)); });
    if (who.size >= 2) {
      const list = [...who].map(([n, ln]) => `${n}@L${ln}`).join(' / ');
      warns.push([f, Math.min(...who.values()),
        `多角色同框（${list}）—— 逐镜核对两件事：动作的主语是不是分镜"谁"列里写的那个；配件在谁身上（node render.mjs --cast 出的表，格底标签就是每镜实际戴的配件）。歌词的道具转移（摘帽递给对方）要写成两段，前段挂 A、后段挂 B`]);
    }
  }
  // 命名里的错误意图：你给一个变量起名叫 palm，那多半就是在画手掌。
  // 抓不到任意绘制，但变量名是最诚实的意图记录。也可能是棕榈树，所以只提醒、不报错。
  // 注意 iris 不在名单里：它是引擎的圆形遮罩转场（iris / irisShape），不是虹膜。
  const HUMAN_PART = /\b(palms?|fingers?|thumbs?|knuckles?|wrists?|elbows?|eyelids?|lash(?:es)?|eyelash(?:es)?|pupils?|sclera|nostrils?|toes?|knees?)\b/gi;
  const seen = new Set();
  for (const m of code.matchAll(HUMAN_PART)) {
    const ln = lineOf(src, m.index), id = `${ln}:${m[1].toLowerCase()}`;
    if (seen.has(id)) continue;                 // 同一行同一个词只报一次
    seen.add(id);
    warns.push([f, ln, `命名里有 "${m[1]}" —— 若在画人体部件就停手：角色的部件清单里没有它（见 GUIDE「部件清单」）。画的是棕榈树之类就忽略`]);
  }
  const views = [...code.matchAll(/view\s*:\s*['"](\w+)['"]/g)].map(m => m[1]);
  if (new Set(views).size > 1)
    warns.push([f, lineOf(src, code.indexOf(views[1])), `朝向字面量有 ${[...new Set(views)].join(' / ')} —— 跨镜的变化每一处都要 turn() 接住，机器判不了，人工过一遍`]);

  // ---- 推太近：u 超过上限时头会顶住/顶出画框，框里只剩一块颜色和一个形状（竖缝眼读成窗子）----
  for (const nm of castNames) eachCall(code, nm, (a, b, t) => {
    const u = parseFloat(topArgs(t.slice(nm.length + 1, -1))[2]);
    if (Number.isFinite(u) && u > U_MAX)
      warns.push([f, lineOf(src, a), `${nm}() 的 u=${u} > ${U_MAX}：头高 ${HEAD_U}u、画框高 ${FRAME_H}，u≈${FRAME_H / HEAD_U} 时头就顶满画框，再往上框里只剩一块颜色——竖缝眼会被读成窗子。确认框里还有第二样东西（另一条眼缝 / 脸颊的边 / 腮红 / 帽檐）`]);
  });
}

for (const [f, l, msg] of errors) console.log(`✗ ${f}:${l}  ${msg}`);
for (const [f, l, msg] of warns) console.log(`⚠ ${f}:${l}  ${msg}`);
if (!errors.length && !warns.length) console.log(`角色一致性检查通过（${scenes.length} 个场景文件，CAST 配件键：${[...propKeys].join(' / ') || '无'}）`);
else console.log(`—— ${errors.length} 错误 / ${warns.length} 提醒${errors.length ? '：修完错误再渲' : '：提醒逐条过一遍'}`);
process.exit(errors.length ? 1 : 0);
