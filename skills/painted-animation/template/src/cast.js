// cast.js — 本片角色的定义处。每个角色一行：颜色 + 默认视角装饰。
// col/dk/lt 是身体三色（本体/暗部/亮部），hat 是帽子或 'bow' / 'beanie' / 'mask' 等。
// 两个角色都写 boilKey，同框时各自的沸腾流才不会互相串。
const CAST = {
  lan: { col: '#F2A0B4', dk: '#CE6A85', lt: '#FBCBD7', hat: 'bow' },   // 示例：粉色角色
  man: { col: PAL.clay, dk: PAL.clayDk, lt: '#F5B394' },               // 示例：默认色角色
};

// 画角色走这两个包装：boilKey 和配色自动带上，场景里不用重复写。
function lan(x, y, u, o = {}) { return clawd(x, y, u, { ...CAST.lan, boilKey: 'lan', ...o }); }
function man(x, y, u, o = {}) { return clawd(x, y, u, { ...CAST.man, boilKey: 'man', ...o }); }

// 表情必须走这两个：emotions 要给 base，否则换表情时颜色会退回默认赭色（粉色角色变橙）。
// 不要直接 emotions(t, keys) 再 spread 给 lan() —— spread 顺序会让 emotion 算出的颜色盖掉角色配色。
const lanMood = (t, keys) => emotions(t, keys, { base: CAST.lan });
const manMood = (t, keys) => emotions(t, keys, { base: CAST.man });

// 场景里的用法：
//   const mood = lanMood(t, [[0, 'neutral'], [1.5, 'hopeful'], [3.4, 'neutral']]);
//   lan(700, FLOOR_Y, 26, { ...mood, view: 'q', walk: walkPhase });
// 挂件（围巾/背包/挂牌）的位置一律读 CLAWD_ANCHORS，不许手写 y —— 见 SKILL.md「引擎的坑」。
// 改完挂件先渲一帧核对：node render.mjs --sheet=1.0 --anchors --crop=... --out=out/check/anchors.jpg
