// render.mjs: renders studio.html in headless Chrome. Length and fps come from the page (PROJECT in src/config.js).
//
//   Look at it (open the images with your image viewer / Read tool):
//     node render.mjs --sheet=0.5,1,1.5,2 [--cols=4] [--w=480] --out=out/check/a.jpg        contact sheet of chosen times
//     node render.mjs --strip=2.0:2.5 [--cols=6] [--w=320] --out=out/check/strip.jpg        EVERY frame in a stretch (motion)
//     node render.mjs --sheet=2.1,2.2 --crop=760,300,400,400 --w=600 --out=out/check/face.jpg full-res crops (details)
//     node render.mjs --strip=2.0:2.5 --crop-at=960,780,500,400 --out=out/check/feet.jpg       crops that follow a WORLD point
//         (x,y in world px, may be page expressions like PLK.MX(1.38); w,h in screen px) through each frame's camera
//     node render.mjs --stills=1.2,3.4 --out=out/stills                                     full-res PNGs
//   Before rendering, look at the whole thing (nothing is written to out/frames):
//     node render.mjs --sheet=1,3,5,...,55 --cols=4 --w=480 --out=out/overview.jpg   # whole film in one image
//     node render.mjs --cast [--at=1,3] [--w=250] --out=out/cast.jpg                 # one row per character, one column per shot
//     node render.mjs --animatic [--step=4] --out=out/animatic.mp4                   # low-fps whole film with sound
//   Make the video:
//     node render.mjs --clip [--range=0:4] --out=out/video.mp4                               straight to MP4 (one worker)
//     node render.mjs --frames [--range=0:8] --workers=4                                     JPEG frames → out/frames (parallel, resumable)
//     node render.mjs --encode --out=out/video.mp4                                           out/frames → MP4
//   Standalone loops (LOOPS in the page): add --loop=<name> to any of the above (times are then loop times), or
//     node render.mjs --loop=emotions --png --out=out/loop_emotions                          one cycle as PNGs (for GIFs)
//   Music: --audio=assets/song.mp3 (or PROJECT.audio) is muxed into --clip and --encode. Other flags: --fps=24,
//   --chrome=<path to Chrome/Chromium>.
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const CHROMES = [args.chrome, process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ...playwrightChromes()];
// Chromium builds Playwright downloaded (~/.cache/ms-playwright/chromium-NNNN), newest first
function playwrightChromes() {
  const dir = `${homedir()}/.cache/ms-playwright`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => b.split('-')[1] - a.split('-')[1])
    .map(n => `${dir}/${n}/chrome-linux64/chrome`);
}
const CHROME = CHROMES.find(p => p && existsSync(p));
if (!CHROME) { console.error('Chrome not found: pass --chrome=<path> or set CHROME_PATH'); process.exit(1); }
const fps = +(args.fps || 24), FRAMES_DIR = 'out/frames';
// 片段起点只有一个真相：src/config.js 的 PROJECT.clipStart。这里读它给合成用，
// 绝不让调用方再传一个数进来——两处各写一个数，就是音画错开的唯一原因。
const clipStart = () => {
  try { const m = /clipStart\s*:\s*(-?[\d.]+)/.exec(readFileSync('src/config.js', 'utf8')); return m ? +m[1] : 0 }
  catch { return 0 }
};
const run = (cmd, a) => new Promise((ok, bad) => { const p = spawn(cmd, a, { stdio: 'inherit' }); p.on('close', c => c ? bad(new Error(cmd + ' exited ' + c)) : ok()); });
const times = s => String(s).split(',').map(Number);
const span = s => String(s).split(':').map(Number);
// comma-separated fields, keeping commas inside parentheses ('PLK.MX(1.38),PLK.WL,500,300'); numbers stay numbers
const fields = s => { const out = []; let d = 0, cur = ''; for (const ch of String(s)) { if (ch === ',' && !d) { out.push(cur); cur = ''; continue; } d += ch === '(' ? 1 : ch === ')' ? -1 : 0; cur += ch; } out.push(cur); return out.map(v => isNaN(+v) ? v : +v); };

// ---------- 增量渲染：源码 mtime 快照 ----------
const MANIFEST = 'out/manifest.json';
function srcMtimes() {
  const out = {};
  const walk = (d) => { for (const f of readdirSync(d)) { const p = d + '/' + f; const st = statSync(p); if (st.isDirectory()) walk(p); else if (/\.(js|html)$/.test(f)) out[p] = Math.round(st.mtimeMs); } };
  if (existsSync('src')) walk('src');
  if (existsSync('studio.html')) out['studio.html'] = Math.round(statSync('studio.html').mtimeMs);
  return out;
}

if (args.encode) {
  const out = args.out || 'out/video.mp4', n = readdirSync(FRAMES_DIR).filter(f => f.endsWith('.jpg')).length, audio = args.audio;
  console.log(`encoding ${n} frames → ${out}${audio ? ' with ' + audio : ''}`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-stats', '-framerate', String(fps), '-i', `${FRAMES_DIR}/f%05d.jpg`,
    ...(audio ? ['-ss', String(clipStart()), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  console.log('wrote ' + out);
  process.exit(0);
}

// --soft-gl: no GPU on this machine; render WebGL in software (SwiftShader), which Chrome only allows when asked.
// --gpu-angle=vulkan|gl-egl: headless Linux on an NVIDIA GPU (e.g. a cloud or cluster node); plain --use-gl=angle gets
// no WebGL context there. Check which GPU Chrome actually lands on with gpu_probe.mjs.
const ANGLE = { vulkan: ['--use-angle=vulkan', '--enable-features=Vulkan'], 'gl-egl': ['--use-angle=gl-egl'] };
if (args['gpu-angle'] && !ANGLE[args['gpu-angle']]) { console.error(`--gpu-angle must be one of ${Object.keys(ANGLE)}`); process.exit(1); }
const gpu = args['soft-gl'] ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : args['gpu-angle'] ? ANGLE[args['gpu-angle']]
  : process.platform === 'win32' ? ['--use-angle=d3d11'] : process.platform === 'darwin' ? ['--use-angle=metal'] : ['--use-gl=angle'];
// Ubuntu 23.10+ blocks Chrome's user-namespace sandbox; headless rendering of local files doesn't need it.
const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 0,
  args: [...sandbox, '--allow-file-access-from-files', '--ignore-gpu-blocklist', ...gpu, '--enable-gpu-rasterization', '--window-size=1920,1080', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']
});
async function openPage(tag = '') {
  const page = await browser.newPage();
  page.on('console', m => { if (['error', 'warn'].includes(m.type())) console.log(`[page${tag}]`, m.text()); });
  page.on('pageerror', e => console.log(`[page error${tag}]`, e.message));
  await page.goto(pathToFileURL(resolve('studio.html')).href + '?render' + (args.anchors ? '&anchors' : ''), { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.ready === true', { timeout: 60000 });
  if (args.loop) {
    const ok = await page.evaluate(name => { if (!LOOPS[name]) return false; window.LOOP = LOOPS[name]; return true; }, args.loop);
    if (!ok) { console.error(`no loop named "${args.loop}"`); process.exit(1); }
  }
  return page;
}
const frameOf = async (page, t, type, q) => {
  const url = await page.evaluate((t, type, q) => window.renderAt(t, type, q), t, type, q);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
};
// the length of whatever is being rendered: a loop's .len, or the video's duration
const lengthOf = page => page.evaluate(() => window.LOOP ? window.LOOP.len : DUR);

if (args.sheet || args.strip) {
  const page = await openPage(), out = args.out || 'out/sheet.jpg'; mkdirSync(dirname(out), { recursive: true });
  let ts;
  if (args.strip) { const [a, b] = span(args.strip); ts = []; for (let i = Math.round(a * fps); i <= Math.round(b * fps); i++) ts.push(i / fps); }
  else ts = times(args.sheet);
  const crop = args.crop ? times(args.crop) : null, at = args['crop-at'] ? fields(args['crop-at']) : null;
  const { url, ms } = await page.evaluate((ts, c, w, crop, at) => window.renderSheet(ts, c, w, crop, at), ts, +(args.cols || (args.strip ? 6 : 3)), +(args.w || (args.strip ? 320 : 640)), crop, at);
  writeFileSync(out, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  console.log(`${out}  (${ts.length} frames)  ms/frame: ${ms.join(' ')}`);
} else if (args.cast) {
  // 角色契约表：一个角色一行，一列一镜，全部裁到同一相对尺度。看的是"它还是不是同一个人"——
  // 方头、缺脚、少一层颜色、配件掉了。--at 指定时刻，默认每个镜头取中点。
  const page = await openPage(), out = args.out || 'out/cast.jpg'; mkdirSync(dirname(out), { recursive: true });
  const plan = await page.evaluate(() => (window.getShotPlan ? window.getShotPlan() : []));
  const len = await lengthOf(page);
  let ts, labels;
  if (args.at) { ts = times(args.at); labels = ts.map(t => t.toFixed(2) + 's'); }
  else {
    ts = plan.map((s, i) => +(((s.t0 + (i + 1 < plan.length ? plan[i + 1].t0 : len)) / 2).toFixed(3)));
    labels = plan.map(s => s.id);
    if (!ts.length) { ts = [len / 2]; labels = ['mid']; }
  }
  const { url, keys, shots } = await page.evaluate((ts, labels, w) => window.renderCastSheet(ts, labels, w), ts, labels, +(args.w || 250));
  if (!url) { console.error('--cast：这些时刻里没有任何角色被画出来（检查场景是否走了 cast.js 的包装）'); await browser.close(); process.exit(1); }
  writeFileSync(out, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  console.log(`${out}  ${keys.length} 个角色 × ${shots} 镜：${keys.join(', ')}`);
} else if (args.stills) {
  const page = await openPage(), out = args.out || 'out/stills'; mkdirSync(out, { recursive: true });
  console.log('GPU:', await page.evaluate(() => window.gpuInfo()));
  for (const s of times(args.stills)) {
    const t0 = Date.now(), buf = await frameOf(page, s, 'image/png');
    const f = `${out}/t${s.toFixed(2).replace('.', '_')}.png`; writeFileSync(f, buf);
    console.log(`${f}  ${Date.now() - t0} ms`);
  }
} else if (args.png) {
  // PNG sequence (for GIFs): a loop's full cycle (frame n equals frame 0, so it isn't rendered), or --range=a:b.
  const probe = await openPage(), len = await lengthOf(probe); await probe.close();
  const [a, b] = args.range ? span(args.range) : [0, len], n = Math.round((b - a) * fps);
  const out = args.out || `out/${args.loop ? 'loop_' + args.loop : 'png'}`, workers = +(args.workers || 3); mkdirSync(out, { recursive: true });
  let next = 0; const start = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const page = await openPage('#' + w);
    while (next < n) { const i = next++; writeFileSync(`${out}/f${String(i).padStart(4, '0')}.png`, await frameOf(page, a + i / fps, 'image/png')); }
  }));
  console.log(`${n} frames → ${out}  (${((Date.now() - start) / n).toFixed(0)} ms/frame)`);
} else if (args.frames) {
  // Parallel and resumable: each worker pulls the next missing frame; files are written atomically.
  // INCREMENTAL: compares source mtimes against out/manifest.json and re-renders only the shots whose
  // file changed. --only=s03,s05 forces a set; --all forces the whole film.
  const probe = await openPage(), len = await lengthOf(probe);
  const plan = await probe.evaluate(() => (window.getShotPlan ? window.getShotPlan() : []));
  await probe.close();
  const [a, b] = args.range ? span(args.range) : [0, len], workers = +(args.workers || 4);
  mkdirSync(FRAMES_DIR, { recursive: true });
  const first = Math.round(a * fps), last = Math.min(Math.ceil(len * fps) - 1, Math.round(b * fps) - 1);

  // 每一镜的时间窗：起点已知，终点是下一镜的起点（最后一镜到片尾）
  const bounds = plan.map((s, i) => ({ ...s, t1: i + 1 < plan.length ? plan[i + 1].t0 : len }));
  const framesOf = (bb) => { const r = []; for (let i = Math.max(first, Math.round(bb.t0 * fps)); i <= Math.min(last, Math.round(bb.t1 * fps) - 1); i++) r.push(i); return r; };
  const CORE = ['src/config.js', 'src/core.js', 'src/clawd.js', 'src/timeline.js', 'src/karaoke.js', 'src/scenes/_shared.js'];
  const now = srcMtimes();
  let wanted = null;                                    // null = 全片

  if (args.only) {
    const ids = String(args.only).split(',').map((s) => s.trim()).filter(Boolean);
    wanted = new Set();
    for (const bb of bounds) if (ids.includes(bb.id)) for (const i of framesOf(bb)) wanted.add(i);
    console.log(`--only ${ids.join(',')} → ${wanted.size} 帧`);
  } else if (!args.all) {
    const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
    if (!prev) console.log('没有 manifest（首次）→ 全片');
    else if (CORE.some((f) => now[f] !== (prev.files || {})[f]))
      console.log('核心文件有改动（core / clawd / timeline / config / karaoke / _shared）→ 全片');
    else {
      const changed = Object.keys(now).filter((f) => now[f] !== (prev.files || {})[f]);
      if (!changed.length) { console.log('源码没有变化 → 跳过。要强制重渲请加 --all'); await browser.close(); process.exit(0); }
      const hits = bounds.filter((bb) => changed.some((f) => f.endsWith(bb.file)));
      if (hits.length) {
        wanted = new Set();
        for (const bb of hits) for (const i of framesOf(bb)) wanted.add(i);
        console.log(`改动在 ${changed.map((f) => f.split('/').pop()).join(', ')} → 只重渲 ${hits.map((h) => h.id).join(', ')}（${wanted.size} 帧）`);
      } else console.log('改动的文件对不上任何镜头 → 全片');
    }
  }

  const todo = []; for (let i = first; i <= last; i++) {
    if (wanted && !wanted.has(i)) continue;
    const f = `${FRAMES_DIR}/f${String(i).padStart(5, '0')}.jpg`; if (!existsSync(f) || statSync(f).size < 1000) todo.push(i);
  }
  console.log(`${todo.length} frames to render (${last - first + 1 - todo.length} already done), ${workers} workers`);
  if (args['dry-run']) { console.log('--dry-run：只报告要渲哪些，不动手'); await browser.close(); process.exit(0); }
  let next = 0, done = 0; const start = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const page = await openPage('#' + w);
    while (next < todo.length) {
      const i = todo[next++], f = `${FRAMES_DIR}/f${String(i).padStart(5, '0')}.jpg`;
      const buf = await frameOf(page, i / fps, 'image/jpeg', .94);
      writeFileSync(f + '.tmp', buf); renameSync(f + '.tmp', f);
      if (++done % 24 === 0 || done === todo.length) {
        const el = (Date.now() - start) / 1000;
        console.log(`frame ${done}/${todo.length}  ${(el / done * 1000).toFixed(0)} ms/frame effective  eta ${((todo.length - done) * el / done / 60).toFixed(1)} min`);
      }
    }
  }));
  writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), fps, range: [first, last], files: srcMtimes(), shots: bounds }, null, 1));
  console.log(`manifest 已更新 → ${MANIFEST}（${bounds.length} 镜）`);
} else if (args.animatic) {
  // 低帧率全片预览：每 step 帧取一帧，编成 fps/step 的视频，带原曲。
  // 用来看**节奏、转场、连续性、整片色彩走向**——不是用来看细节的（细节走 --sheet / --crop）。
  // 一支 56 秒的片子按 step=4 约 340 帧，6 路并发 1 分钟左右。
  const step = Math.max(2, +(args.step || 4));
  const probe = await openPage(), len = await lengthOf(probe); await probe.close();
  const out = args.out || 'out/animatic.mp4', dir = 'out/animatic';
  mkdirSync(dir, { recursive: true });
  // 帧缓存必须跟着源码走。以前只看“帧文件在不在”，源码改了也照样全部跳过——
  // 于是静默出一版和上一版字节相同的“新样片”，人眼以为在审新框架，其实在看旧的。
  const sig = JSON.stringify({ fps, step, src: srcMtimes() }, null, 0);
  const sigFile = `${dir}/.srcsig`;
  if (!existsSync(sigFile) || readFileSync(sigFile, 'utf8') !== sig) {
    const old = readdirSync(dir).filter(f => /^f\d+\.jpg$/.test(f));
    for (const f of old) rmSync(`${dir}/${f}`);
    writeFileSync(sigFile, sig);
    console.log(`animatic: 源码已变，清掉 ${old.length} 张旧帧重渲`);
  }
  const n = Math.ceil(len * fps / step), workers = +(args.workers || 6);
  console.log(`animatic: 每 ${step} 帧取 1 → ${n} 帧 @ ${(fps / step).toFixed(1)}fps`);
  let next = 0, done = 0; const start = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const page = await openPage('#' + w);
    while (next < n) {
      const k = next++, f = `${dir}/f${String(k).padStart(5, '0')}.jpg`;
      if (existsSync(f) && statSync(f).size > 1000) { done++; continue; }
      const buf = await frameOf(page, (k * step) / fps, 'image/jpeg', .9);
      writeFileSync(f + '.tmp', buf); renameSync(f + '.tmp', f);
      if (++done % 24 === 0 || done === n) console.log(`animatic ${done}/${n}  ${((Date.now() - start) / done).toFixed(0)} ms/frame`);
    }
  }));
  const ap = await openPage(), audio = args.audio || await ap.evaluate(() => PROJECT.audio || ''); await ap.close();
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps / step), '-i', `${dir}/f%05d.jpg`,
    ...(audio ? ['-ss', String(clipStart()), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-shortest'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  console.log('wrote ' + out);
} else if (args.clip) {
  const page = await openPage(), len = await lengthOf(page);
  const [a, b] = args.range ? span(args.range) : typeof args.clip === 'string' ? span(args.clip) : [0, len];
  const audio = args.audio || await page.evaluate(() => PROJECT.audio || '');
  const out = args.out || 'out/clip.mp4'; mkdirSync(dirname(out), { recursive: true });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    ...(audio ? ['-ss', String(a + clipStart()), '-t', String(b - a), '-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.round((b - a) * fps), start = Date.now();
  for (let i = 0; i < n; i++) {
    const buf = await frameOf(page, a + i / fps, 'image/jpeg', .93);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 24 === 0 || i === n - 1) console.log(`frame ${i + 1}/${n}  ${((Date.now() - start) / (i + 1)).toFixed(0)} ms/frame`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  console.log(`wrote ${out}`);
} else {
  console.log('nothing to do: see the usage notes at the top of render.mjs');
}
await browser.close();
