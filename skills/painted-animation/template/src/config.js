// config.js: 项目设置。
//   duration:  影片长度（秒）
//   bpm:       弹跳、舞蹈、pulse() 跟随的节奏。有音乐就设成歌曲的 BPM，offset 设成第一个重拍的时刻。
//   clipStart: 这段片子取自原曲的第几秒。**设了它，karaoke.js 的 LY 就写原曲绝对时间**（直接抄 LRC），
//              字幕偏移和合成时的裁切都由它算——手动"减片段起点"是音画不同步的头号来源，这里把它消灭掉。
//   bg:        画布底色。每个镜头通常自己铺满背景，这个只在没铺满时兜底。
const PROJECT = { duration: 11, bpm: 120, offset: 0, clipStart: 0, bg: 250 };
