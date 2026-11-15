# Claude Animation Base

这是一套小starter kit：用 [p5.js](https://p5js.org) 和 canvas 2D，让 Claude Opus 5.5 给一个角色做动画——代码、说明、素材都在里面。

它的前身是音乐 MV [I'm Upping My P(doom)](https://github.com/JohnHeibel/PDoomVideo) 的代码，加上一份"模型哪些做得好、哪些没做好"的分析。

**强烈建议你多试试怎么给它提示**：让它先交分镜再写代码；给它非常宽泛的指令；也试试非常具体的指令；要求它开子代理；再用各种好玩的方式探探它的能力边界。在我自己的测试里，它给一点点信息就能做很多事，但你给的要求越多，它反而越准。也可以让它换角色、造新表情、做新服装，或者丢你自己的参考图进去，这类玩法都值得一试。我还发现，推理强度直接决定它把场景画得多"铺张"、多抠细节。所有测试视频都是在 Claude Code 里用 Opus 5.5、xhigh 推理生成的。

![Clawd 的表情表](docs/emotions.jpg)

## 做一支片子

克隆下来，在 Claude Code（或任何编程 agent）里打开，直接说要什么：

> 先读 ANIMATION_GUIDE.md，然后做一支 15 秒的视频，内容是 Clawd 想抓住一只蝴蝶。

模型会先写分镜，一镜一镜地搭，渲 contact sheet 检查自己的活儿，最后写出 `out/video.mp4`。[ANIMATION_GUIDE.md](ANIMATION_GUIDE.md) 里是它要遵守的规则：像手画的、活的、一件作品、不要文字、每个接缝都要交代、每一场都要有事发生，以及"平面色块 + 2D + 沸腾墨线"这套硬媒介。它也讲怎么替观众排时间，以及角色动画的核心原理。

## 自己跑一遍

需要 Node.js、Google Chrome 和 ffmpeg。

没有独立显卡时，canvas 2D 的水彩填充会让渲染慢到以"秒/帧"计。如果你用的是集显，建议让模型避开这类填充、换成别的合适画法（不过我个人很喜欢水彩那个味道）。

```bash
npm install
node render.mjs --clip --out=out/video.mp4
```

这条命令渲的是 [src/scenes/demo.js](src/scenes/demo.js) 里那支 11 秒的示例。用 Chrome 打开 [studio.html](studio.html) 就能拖着看。加上 `?loop=emotions` 或 `?loop=views` 可以看设定表。如果 Chrome 不在标准位置，传 `--chrome=<path>` 或设 `CHROME_PATH`。

在 Linux 上，`render.mjs` 会带 `--no-sandbox` 启动 Chrome（Ubuntu 23.10+ 会拦掉 headless 下 Chrome 的沙箱），也会去找 Playwright 装的 Chromium。完全没有 GPU 时，加 `--soft-gl` 用软件渲 WebGL：水彩填充会很慢，但能用。在带 NVIDIA GPU 的 headless Linux 机器上（云主机或集群节点），加 `--gpu-angle=gl-egl`（或 `vulkan`）；`node gpu_probe.mjs <chrome 路径>` 会告诉你每组参数各自拿到哪个渲染器。

## 这里有什么

| 路径 | 是什么 |
|---|---|
| [ANIMATION_GUIDE.md](ANIMATION_GUIDE.md) | 规则、流程和完整 API。先读它。 |
| [src/clawd.js](src/clawd.js) | Clawd：视角、表情、眼睛、嘴、帽子、emote、舞蹈 |
| [src/core.js](src/core.js) | 绘制、时间、运动辅助、相机、光、纸 |
| [src/timeline.js](src/timeline.js) | 镜头、loop 和笔刷擦除转场 |
| [src/config.js](src/config.js) | 片长与速度 |
| [src/scenes/](src/scenes/) | 你的片子放这里（demo 就是个例子） |
| [render.mjs](render.mjs) | headless 渲染器：contact sheet、逐帧条、裁切、静帧、MP4 |
| [docs/](docs/) | 设定表：[表情](docs/emotions.jpg)和[视角、运动与帽子](docs/views.jpg) |
