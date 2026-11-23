/**
 * 落子音效模块
 *
 * 为了不依赖任何音频资源文件（小程序包内体积与网络加载都省了），
 * 这里用 WebAudio 实时合成音色；当运行环境不支持 WebAudio 时，
 * 自动降级为短震动反馈，保证交互始终有回应。
 *
 * 注：微信开发者工具模拟器对 WebAudio 支持有限，真机上效果更佳。
 */

var audioCtx = null;
var audioReady = false;

function getContext() {
  if (!audioReady) {
    audioReady = true;
    if (typeof wx.createWebAudioContext === 'function') {
      try {
        audioCtx = wx.createWebAudioContext();
      } catch (e) {
        audioCtx = null;
      }
    }
  }

  // iOS 上 AudioContext 建好后可能处于 suspended 状态，必须 resume 才会出声，
  // 否则会出现"真机全程静音"的假象。调用点都在触摸回调里，满足用户手势要求。
  if (audioCtx && audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
    try {
      audioCtx.resume();
    } catch (e) {}
  }

  return audioCtx;
}

// 震动反馈（开发者工具多数情况下无效果，真机可用）
function vibrate(type) {
  if (typeof wx.vibrateShort !== 'function') {
    return;
  }
  wx.vibrateShort({
    type: type || 'light',
    fail: function () {}
  });
}

/**
 * 合成一个带包络的振荡器音
 */
function tone(ctx, option) {
  var t0 = option.start;
  var osc = ctx.createOscillator();
  var gain = ctx.createGain();
  osc.type = option.type || 'sine';
  osc.frequency.setValueAtTime(option.from, t0);
  if (option.to && option.to !== option.from) {
    osc.frequency.exponentialRampToValueAtTime(option.to, t0 + option.duration);
  }
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(option.peak, t0 + (option.attack || 0.006));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + option.duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + option.duration + 0.02);
}

/**
 * 落子：木质棋子敲击棋盘 —— 低频“咚” + 高频“嗒”
 */
function playPlace() {
  vibrate('light');
  var ctx = getContext();
  if (!ctx) {
    return;
  }
  try {
    var t = ctx.currentTime;
    tone(ctx, {
      start: t,
      type: 'sine',
      from: 520,
      to: 130,
      duration: 0.13,
      peak: 0.42
    });
    tone(ctx, {
      start: t,
      type: 'triangle',
      from: 1900,
      to: 700,
      duration: 0.055,
      peak: 0.13,
      attack: 0.003
    });
  } catch (e) {
    // 合成失败时静默，已有震动兜底
  }
}

/**
 * 无效落子：短促低沉的提示音
 */
function playInvalid() {
  vibrate('medium');
  var ctx = getContext();
  if (!ctx) {
    return;
  }
  try {
    tone(ctx, {
      start: ctx.currentTime,
      type: 'square',
      from: 220,
      to: 150,
      duration: 0.09,
      peak: 0.1
    });
  } catch (e) {}
}

/**
 * 悔棋：下滑音
 */
function playUndo() {
  vibrate('light');
  var ctx = getContext();
  if (!ctx) {
    return;
  }
  try {
    tone(ctx, {
      start: ctx.currentTime,
      type: 'sine',
      from: 620,
      to: 240,
      duration: 0.16,
      peak: 0.16
    });
  } catch (e) {}
}

/**
 * 获胜：上行琶音
 */
function playWin() {
  vibrate('heavy');
  var ctx = getContext();
  if (!ctx) {
    return;
  }
  var notes = [523.25, 659.25, 783.99, 1046.5];
  try {
    var base = ctx.currentTime;
    for (var i = 0; i < notes.length; i++) {
      tone(ctx, {
        start: base + i * 0.11,
        type: 'sine',
        from: notes[i],
        duration: 0.34,
        peak: 0.26,
        attack: 0.02
      });
    }
  } catch (e) {}
}

module.exports = {
  playPlace: playPlace,
  playInvalid: playInvalid,
  playUndo: playUndo,
  playWin: playWin
};
