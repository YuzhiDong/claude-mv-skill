// cast.js — 本片角色的唯一定义处：颜色 + 规格(rig) + 常驻配件(props)。
//
// 角色一致性靠三道硬规则，全在这个文件里，不在文档里——文档会被忘，代码不会：
//   1. 规格 rig 只写在这里。腿几条、手臂几条、什么头型，场景代码碰不到。
//   2. 配件 props 默认在场。忘了写就是还在；要拿掉必须显式写 'off'，让"缺席"在代码里看得出来。
//   3. 画角色只能走下面自动生成的包装（lan / man / …）。直接调 clawd() 会绕过配色、boilKey 和配件。
//
// guard() 对违规当场抛错，而不是渲出来才发现。加一个角色只改 CAST 表，防线自动覆盖到它。

const CAST = {
  lan: {
    col: '#F2A0B4', dk: '#CE6A85', lt: '#FBCBD7',
    // 规格：场景改不动，改了是全片生效。rig 不只记数量，也记"它长什么样"——
    // 场景里多画一根手指、把竖缝眼画成人眼，都要在契约表这一行底下对不出来。
    // 注意形态字段叫 eye（单数）而不是 eyes：eyes 是脸部参数（eyes:'happy'），两者不能同名。
    rig: { legs: 4, arms: 2, arm: 'stub', fingers: 0, eye: 'slit', head: 'block' },
    props: { hat: 'bow' },                      // 全程在场；要拿掉写 props: { hat: 'off' }
  },
  man: {
    col: PAL.clay, dk: PAL.clayDk, lt: '#F5B394',
    rig: { legs: 4, arms: 2, arm: 'stub', fingers: 0, eye: 'slit', head: 'block' },
    props: {},
  },
};

// 规格专属的键：场景的 opts 里出现任何一个都算违规，它们只属于 CAST。
// eyes **不在**这里：它是合法的脸部参数（eyes:'happy'），拦了会把所有正常表情误杀。
const CAST_LOCKED = ['rig', 'legs', 'arms', 'arm', 'fingers', 'eye', 'head', 'noLegs'];

// rig 翻成人话，给契约表左边那一行用（core.js 的 renderCastSheet 调它，别两处各写一遍）。
// 认不出来的键**照样打印**——以后往 rig 里加部件，不会静默地从清单上消失。
const RIG_WORD = {
  arm:  { stub: '臂桩', mitten: '圆手', hand: '手掌' },
  eye:  { slit: '竖缝眼', round: '圆眼', dot: '点眼', none: '无眼' },
  head: { block: '方块头', round: '圆头' },
};
const RIG_ORDER = ['legs', 'arms', 'arm', 'fingers', 'eye', 'head'];
function rigText(rig = {}) {
  const w = (k, v) => (RIG_WORD[k] && RIG_WORD[k][v]) || v, p = [];
  if ('legs' in rig) p.push(`${rig.legs} 腿`);
  if ('arms' in rig) p.push(`${rig.arms} ${w('arm', rig.arm) || '臂'}`);
  else if ('arm' in rig) p.push(w('arm', rig.arm));
  if ('fingers' in rig) p.push(rig.fingers ? `${rig.fingers} 指` : '无手指');
  if ('eye' in rig) p.push(w('eye', rig.eye));
  if ('head' in rig) p.push(w('head', rig.head));
  for (const k of Object.keys(rig)) if (!RIG_ORDER.includes(k)) p.push(`${k} ${rig[k]}`);
  return p.join(' · ');
}
window.rigText = rigText;

function castGuard(name, o) {
  const spec = CAST[name], known = Object.keys(spec.props || {});
  const locked = CAST_LOCKED.filter(k => k in o);
  if (locked.length) throw new Error(
    `[cast] ${name}() 收到 ${locked.join(' / ')}：角色规格不许在场景里改。` +
    ` 身体规格写在 CAST.${name}.rig，配件加在 CAST.${name}.props——改那里才是全片生效的。` +
    ` 也检查一下有没有整块 spread { ...CAST.${name} }，那样会把 rig 一起带进来。`);
  const direct = known.filter(k => k in o);
  if (direct.length) throw new Error(
    `[cast] ${name}() 直接收到 ${direct.join(' / ')}：配件要写在 props 里，` +
    ` 例如 { props: { ${direct[0]}: ... } }。直接传会绕过"默认在场"，那一镜就成了漏传即消失。`);
  for (const [k, v] of Object.entries(o.props || {})) {
    if (!known.includes(k)) throw new Error(
      `[cast] ${name}() 没有叫 "${k}" 的配件（CAST.${name}.props 里只有 ${known.join(' / ') || '（空）'}）。` +
      ` 打错字不会静默失效——先把它加进 CAST，或者改对名字。`);
    if (v === null || v === undefined) throw new Error(
      `[cast] ${name}() 的 props.${k} 是 null：要拿掉请写 'off'。` +
      ` null 和"忘了写"在代码里长得一样，而这条规则存在的意义就是让它们长得不一样。`);
  }
}

// 默认在场：CAST 里声明的全部带上，场景的 props 逐键覆盖，只有 'off' 才算拿掉。
function castProps(name, o) {
  const base = CAST[name].props || {}, over = o.props || {}, out = {};
  for (const k of Object.keys({ ...base, ...over })) {
    const v = k in over ? over[k] : base[k];
    if (v !== 'off') out[k] = v;
  }
  return out;
}

// 从 CAST 自动生成包装：加一个角色只改上面的表，不用动这里。
for (const name of Object.keys(CAST)) {
  const spec = CAST[name];
  window[name] = (x, y, u, o = {}) => {
    castGuard(name, o);
    const { props, ...rest } = o;   // props 已由 castProps 展开，别让它再漏进 clawd
    // 顺手把"这一帧这个角色实际戴着什么"登记出来，契约表按它画标签——
    // 两人同框时"帽子在谁头上"不用回代码翻，看表就知道。
    (window.__CAST_PROPS_BY_KEY = window.__CAST_PROPS_BY_KEY || {})[name] = castProps(name, o);
    return clawd(x, y, u, { col: spec.col, dk: spec.dk, lt: spec.lt, ...castProps(name, o), boilKey: name, ...rest });
  };
  // 表情走这个：把角色自己的颜色作为 base 传进去，否则换表情会退回默认赭色。
  window[name + 'Mood'] = (t, keys, mood = {}) => emotions(t, keys, { base: spec, ...mood });
}

// 场景里的写法：
//   const mood = lanMood(t, [[0, 'neutral'], [1.5, 'hopeful'], [3.4, 'neutral']]);
//   lan(700, FLOOR_Y, 26, { ...mood, view: 'q', walk: walkPhase });
//   lan(700, FLOOR_Y, 26, { props: { hat: 'off' } });     // 这一镜摘帽子（剧情需要，显式）
// 挂件（围巾/背包/挂牌）的位置一律读 CLAWD_ANCHORS，不许手写 y。写完渲一帧核对：
//   node render.mjs --sheet=1.0 --anchors --out=out/check/anchors.jpg
// 出片前跑跨镜检查：node ../../scripts/check_cast.mjs
