var gomoku = require('../../utils/gomoku.js');
var sound = require('../../utils/sound.js');
var ai = require('../../utils/ai.js');

var SIZE = gomoku.BOARD_SIZE;
var WIN_ANIM_DURATION = 480; // 五连高亮入场动画时长（ms）
var TAP_TOLERANCE = 0.55; // 点击吸附到交叉点的最大容差（单位：格）
var MAX_BOARD_SIZE = 420; // 棋盘边长上限（px）
var MIN_BOARD_SIZE = 220; // 棋盘边长下限（px）
var CHROME_HEIGHT = 220; // 顶栏 + 工具栏 + 间距 + 安全区占用的高度估算（px）

// 禁手提示文案
var FORBIDDEN_TEXT = {
  doubleThree: '三三禁手',
  doubleFour: '四四禁手',
  overline: '长连禁手'
};

// 星位坐标（15 路棋盘：天元 + 四星）
var STAR_POINTS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]];

function getWindowInfo() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo();
  }
  return wx.getSystemInfoSync();
}

/**
 * 计算棋盘边长：同时受屏幕宽度与可用高度约束，
 * 避免小屏 / 横屏 / 分屏下棋盘把底部按钮顶出视口。
 */
function computeCanvasSize() {
  var info = getWindowInfo();
  var winW = info.windowWidth || 375;
  var winH = info.windowHeight || 667;
  var size = Math.min(winW - 32, winH - CHROME_HEIGHT, MAX_BOARD_SIZE);
  if (size < MIN_BOARD_SIZE) {
    size = MIN_BOARD_SIZE;
  }
  return Math.round(size);
}

function formatTime(ms) {
  var total = Math.floor((ms || 0) / 1000);
  var m = Math.floor(total / 60);
  var s = total % 60;
  return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

Page({
  data: {
    canvasSize: 0,
    statusBarHeight: 20, // 状态栏高度，自定义导航栏时用于留出安全区
    current: 1, // 1 黑，2 白
    moveCount: 0,
    winner: 0, // 0 未结束，1 黑胜，2 白胜
    isDraw: false,
    canUndo: false,
    time1: '00:00',
    time2: '00:00',
    resultTime: '',
    // 模式配置
    mode: 'pvp', // pvp 双人 / pve 人机
    rule: gomoku.RULE_FREE, // free 无禁手 / standard 标准禁手
    level: ai.LEVEL_NORMAL, // easy / normal / hard
    aiThinking: false, // AI 是否正在思考
    showMenu: false, // 开局菜单是否展开
    forbidHint: '' // 禁手提示文案
  },

  // ---------------- 生命周期 ----------------

  onLoad: function () {
    // 棋盘与对局状态（放实例上，避免高频 setData）
    this.board = gomoku.createEmptyBoard();
    this.history = [];
    this.winAnim = null; // 五连高亮入场动画 { start }
    this.winLine = null; // [[r, c], ...]
    this.rafId = 0;

    // 状态栏高度（自定义导航栏时，用于给页面顶部留出安全区）
    var info = getWindowInfo();
    var statusBarHeight = info.statusBarHeight || 20;

    // 计时
    this.times = { 1: 0, 2: 0 };
    this.turnStart = Date.now();
    this.running = true;
    this.timer = null;

    // 画布
    this.canvas = null;
    this.ctx = null;
    this.cssSize = 0;
    this.cell = 0;
    this.pad = 0;

    // 禁手提示点缓存（仅标准规则 + 轮到黑方时启用）
    this.forbiddenPoints = [];

    this.setData({ canvasSize: computeCanvasSize(), statusBarHeight: statusBarHeight });
  },

  onReady: function () {
    this.initCanvas();
  },

  onShow: function () {
    // 对局已结束：不重启计时（否则输家一侧的计时会一直涨），
    // 同时补一次绘制——五连高亮动画若被切后台打断，结果遮罩会漏画。
    if (this.data.winner || this.data.isDraw) {
      if (this.winAnim) {
        this.winAnim = null;
      }
      this.draw();
      return;
    }

    this.turnStart = Date.now();
    this.running = true;
    this.startTimer();
    this.tick();
  },

  // 屏幕旋转 / 窗口尺寸变化时重算棋盘大小
  onResize: function () {
    var size = computeCanvasSize();
    if (size === this.data.canvasSize) {
      return;
    }
    var self = this;
    this.setData({ canvasSize: size }, function () {
      // 尺寸变化会重置画布内容，需要重新初始化并重绘（对局状态保留在实例上）
      self.initCanvas();
    });
  },

  onHide: function () {
    this.pauseTimer();
  },

  onUnload: function () {
    this.stopTimer();
    if (this.rafId && this.canvas) {
      this.canvas.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  },

  // ---------------- 计时 ----------------

  pauseTimer: function () {
    if (this.running) {
      this.times[this.data.current] += Date.now() - this.turnStart;
      this.running = false;
    }
    this.stopTimer();
  },

  startTimer: function () {
    var self = this;
    if (this.timer) {
      return;
    }
    this.timer = setInterval(function () {
      self.tick();
    }, 500);
  },

  stopTimer: function () {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  tick: function () {
    var cur = this.data.current;
    if (!cur) {
      return;
    }
    var elapsed = this.times[cur] + (this.running ? Date.now() - this.turnStart : 0);
    var patch = {};
    patch[cur === 1 ? 'time1' : 'time2'] = formatTime(elapsed);
    this.setData(patch);
  },

  // ---------------- 画布初始化 ----------------

  initCanvas: function () {
    var self = this;
    wx.createSelectorQuery()
      .select('#board')
      .fields({ node: true, size: true, rect: true })
      .exec(function (res) {
        if (!res || !res[0] || !res[0].node) {
          return;
        }
        var canvas = res[0].node;
        var ctx = canvas.getContext('2d');
        var info = getWindowInfo();
        var dpr = info.pixelRatio || 2;
        var cssSize = res[0].width || self.data.canvasSize;

        // 记录画布在页面中的位置，供触摸坐标兜底换算使用
        if (typeof res[0].left === 'number') {
          self.canvasLeft = res[0].left;
          self.canvasTop = res[0].top;
        }

        canvas.width = Math.round(cssSize * dpr);
        canvas.height = Math.round(cssSize * dpr);
        ctx.scale(dpr, dpr);

        self.canvas = canvas;
        self.ctx = ctx;
        self.cssSize = cssSize;
        self.cell = cssSize / SIZE;
        self.pad = self.cell / 2;

        self.draw();
      });
  },

  /**
   * 绘制棋盘底图（木纹 + 网格 + 外框 + 星位）
   */
  drawBoardBase: function (ctx) {
    var size = this.cssSize;
    var cell = this.cell;
    var pad = this.pad;

    // 棋盘木色底
    var bg = ctx.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#F2DBAD');
    bg.addColorStop(0.5, '#E9C990');
    bg.addColorStop(1, '#D8AE70');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    // 网格
    ctx.strokeStyle = 'rgba(94, 66, 32, 0.6)';
    ctx.lineWidth = Math.max(1, cell * 0.028);
    ctx.beginPath();
    for (var i = 0; i < SIZE; i++) {
      var p = pad + i * cell;
      ctx.moveTo(pad, p);
      ctx.lineTo(size - pad, p);
      ctx.moveTo(p, pad);
      ctx.lineTo(p, size - pad);
    }
    ctx.stroke();

    // 外框
    ctx.strokeStyle = 'rgba(76, 50, 20, 0.85)';
    ctx.lineWidth = Math.max(1.6, cell * 0.055);
    ctx.strokeRect(pad, pad, size - 2 * pad, size - 2 * pad);

    // 星位
    ctx.fillStyle = 'rgba(76, 50, 20, 0.78)';
    for (var s = 0; s < STAR_POINTS.length; s++) {
      ctx.beginPath();
      ctx.arc(
        pad + STAR_POINTS[s][1] * cell,
        pad + STAR_POINTS[s][0] * cell,
        Math.max(2, cell * 0.1),
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  },

  // ---------------- 绘制 ----------------

  draw: function () {
    var ctx = this.ctx;
    if (!ctx || !this.cssSize) {
      return;
    }
    var size = this.cssSize;

    // 底图不透明且铺满整块画布，直接重绘即可覆盖上一帧内容。
    // 这里刻意不做 clearRect —— 清屏会制造"已擦除但还没画"的空白中间态，
    // 观感上就是落子时棋盘闪一下。
    this.drawBoardBase(ctx);

    // 已落子
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var v = this.board[r][c];
        if (v === 0) {
          continue;
        }
        this.drawStone(r, c, v, 1, 1);
      }
    }

    // 禁手提示点（标准规则 + 轮到黑方时，把当前不可落的位置标红）
    this.drawForbiddenHints();

    // 最后一手标记（终局时让位给获胜高亮）
    if (!this.winLine && this.history.length) {
      var last = this.history[this.history.length - 1];
      this.drawLastMark(last.r, last.c, last.player);
    }

    // 五连高亮
    if (this.winLine) {
      var wp = 1;
      if (this.winAnim) {
        var wt = (Date.now() - this.winAnim.start) / WIN_ANIM_DURATION;
        wt = wt < 0 ? 0 : wt > 1 ? 1 : wt;
        wp = 1 - Math.pow(1 - wt, 3);
      }
      this.drawWinLine(wp);
    }

    // 终局结果（等五连高亮入场动画结束后再覆盖显示）
    if ((this.data.winner || this.data.isDraw) && !this.winAnim) {
      this.drawResult();
    }
  },

  drawResult: function () {
    var ctx = this.ctx;
    var size = this.cssSize;
    var winner = this.data.winner;

    ctx.save();
    ctx.fillStyle = 'rgba(10, 14, 22, 0.62)';
    roundRectPath(ctx, 0, 0, size, size, Math.max(10, size * 0.045));
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#F2C14E';
    ctx.font = 'bold ' + Math.round(size * 0.088) + 'px sans-serif';
    ctx.fillText(
      winner === 1 ? '黑方获胜' : winner === 2 ? '白方获胜' : '平局',
      size / 2,
      size / 2 - size * 0.05
    );

    ctx.fillStyle = 'rgba(232, 236, 244, 0.78)';
    ctx.font = Math.round(size * 0.038) + 'px sans-serif';
    ctx.fillText(
      winner
        ? '用时 ' + this.data.resultTime + ' · 共 ' + this.data.moveCount + ' 手'
        : '棋盘已满 · 共 ' + this.data.moveCount + ' 手',
      size / 2,
      size / 2 + size * 0.05
    );

    ctx.fillStyle = 'rgba(232, 236, 244, 0.42)';
    ctx.font = Math.round(size * 0.028) + 'px sans-serif';
    ctx.fillText('点击下方按钮再来一局或悔棋复盘', size / 2, size / 2 + size * 0.12);

    ctx.restore();
  },

  drawStone: function (r, c, player, scale, alpha) {
    var ctx = this.ctx;
    var x = this.pad + c * this.cell;
    var y = this.pad + r * this.cell;
    var radius = this.cell * 0.44 * scale;
    if (radius <= 0.5) {
      return;
    }

    ctx.save();
    if (alpha !== undefined && alpha < 1) {
      ctx.globalAlpha = alpha;
    }

    // 投影
    ctx.beginPath();
    ctx.arc(x + radius * 0.1, y + radius * 0.14, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(70, 45, 18, 0.3)';
    ctx.fill();

    // 主体（径向渐变模拟立体感）
    var g = ctx.createRadialGradient(
      x - radius * 0.38,
      y - radius * 0.42,
      radius * 0.06,
      x,
      y,
      radius * 1.12
    );
    if (player === 1) {
      g.addColorStop(0, '#7A7A7A');
      g.addColorStop(0.42, '#333333');
      g.addColorStop(1, '#070707');
    } else {
      g.addColorStop(0, '#FFFFFF');
      g.addColorStop(0.52, '#F4F5F7');
      g.addColorStop(1, '#C4C8D0');
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // 白子描边，避免与浅色棋盘糊在一起
    if (player === 2) {
      ctx.strokeStyle = 'rgba(122, 126, 138, 0.55)';
      ctx.lineWidth = Math.max(0.7, this.cell * 0.022);
      ctx.stroke();
    }

    ctx.restore();
  },

  /**
   * 绘制禁手提示点：标准规则下轮到黑方时，把所有禁手空位标记出来，
   * 让玩家落子前就能看清「哪里不能下」。红叉 + 红点圈。
   */
  drawForbiddenHints: function () {
    var pts = this.forbiddenPoints;
    if (!pts || !pts.length) {
      return;
    }
    var ctx = this.ctx;
    var cell = this.cell;

    ctx.save();
    for (var i = 0; i < pts.length; i++) {
      var x = this.pad + pts[i].c * cell;
      var y = this.pad + pts[i].r * cell;

      // 浅红底色，柔和提示该点不可落
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(228, 60, 60, 0.16)';
      ctx.fill();

      // 红圈描边
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.3, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(228, 60, 60, 0.85)';
      ctx.lineWidth = Math.max(1.4, cell * 0.05);
      ctx.stroke();

      // 红叉
      var s = cell * 0.14;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y + s);
      ctx.moveTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.strokeStyle = 'rgba(214, 40, 40, 0.95)';
      ctx.lineWidth = Math.max(1.6, cell * 0.06);
      ctx.stroke();
    }
    ctx.restore();
  },

  /**
   * 刷新禁手提示点缓存（按当前棋盘与规则重算）。
   * 条件：标准规则 且 轮到黑方（current === 1）。
   */
  refreshForbiddenPoints: function () {
    if (this.data.rule !== gomoku.RULE_STANDARD || this.data.current !== 1) {
      this.forbiddenPoints = [];
      return;
    }
    this.forbiddenPoints = gomoku.scanForbiddenPoints(this.board).points;
  },

  drawLastMark: function (r, c, player) {
    var ctx = this.ctx;
    var x = this.pad + c * this.cell;
    var y = this.pad + r * this.cell;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, this.cell * 0.11), 0, Math.PI * 2);
    ctx.fillStyle = player === 1 ? 'rgba(255, 198, 88, 0.95)' : 'rgba(228, 78, 78, 0.9)';
    ctx.fill();
  },

  drawWinLine: function (progress) {
    var ctx = this.ctx;
    var line = this.winLine;
    for (var i = 0; i < line.length; i++) {
      var x = this.pad + line[i][1] * this.cell;
      var y = this.pad + line[i][0] * this.cell;
      var radius = this.cell * 0.44;

      // 光晕
      var glow = ctx.createRadialGradient(x, y, radius * 0.55, x, y, radius * 1.55);
      glow.addColorStop(0, 'rgba(255, 198, 88, ' + (0.5 * progress).toFixed(3) + ')');
      glow.addColorStop(1, 'rgba(255, 198, 88, 0)');
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.55, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // 金环
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 186, 60, ' + (0.95 * progress).toFixed(3) + ')';
      ctx.lineWidth = Math.max(2, this.cell * 0.075);
      ctx.stroke();
    }
  },

  // ---------------- 动画驱动（仅用于终局五连高亮的入场） ----------------

  requestFrame: function () {
    var self = this;
    if (this.rafId || !this.canvas) {
      return;
    }
    var step = function () {
      self.rafId = 0;

      if (self.winAnim && Date.now() - self.winAnim.start >= WIN_ANIM_DURATION) {
        self.winAnim = null;
      }

      self.draw();

      if (self.winAnim) {
        self.rafId = self.canvas.requestAnimationFrame(step);
      }
    };
    this.rafId = this.canvas.requestAnimationFrame(step);
  },

  // ---------------- 交互 ----------------

  onBoardTap: function (e) {
    if (this.data.winner || this.data.isDraw) {
      return;
    }
    if (!this.ctx || !this.cell) {
      return;
    }
    // 人机模式：只允许玩家（执白）落子，AI 思考中也不接受
    if (this.data.mode === 'pve') {
      if (this.data.aiThinking) {
        return;
      }
      if (this.data.current !== 2) {
        return; // AI 执黑，轮到 AI 时玩家不能落子
      }
    }

    // 多指按下会重复触发 touchstart，只认单指，避免一次落下两颗子
    if (e.touches && e.touches.length > 1) {
      return;
    }

    var touch = e.touches && e.touches[0];
    if (!touch) {
      return;
    }

    // 优先使用 canvas 触摸事件自带的相对坐标；缺失时用页面坐标减去画布偏移兜底
    var x = touch.x;
    var y = touch.y;
    if (typeof x !== 'number' || typeof y !== 'number') {
      if (typeof touch.clientX === 'number') {
        x = touch.clientX - (this.canvasLeft || 0);
        y = touch.clientY - (this.canvasTop || 0);
      } else if (typeof touch.pageX === 'number') {
        x = touch.pageX - (this.canvasLeft || 0);
        y = touch.pageY - (this.canvasTop || 0);
      } else {
        return;
      }
    }

    var c = Math.round((x - this.pad) / this.cell);
    var r = Math.round((y - this.pad) / this.cell);
    if (!gomoku.inBounds(r, c)) {
      return;
    }

    // 离交叉点太远则视为误触
    var dx = x - (this.pad + c * this.cell);
    var dy = y - (this.pad + r * this.cell);
    if (Math.sqrt(dx * dx + dy * dy) > this.cell * TAP_TOLERANCE) {
      return;
    }

    this.place(r, c);
  },

  /**
   * 落子核心逻辑。返回 true 表示落子成功，false 表示未落（禁手/占位）。
   */
  place: function (r, c) {
    if (this.board[r][c] !== 0) {
      sound.playInvalid();
      return false;
    }

    var player = this.data.current;

    // 标准规则：黑方禁手校验（落子前拦截）
    if (this.data.rule === gomoku.RULE_STANDARD && player === 1) {
      var fb = gomoku.checkBlackForbidden(this.board, r, c);
      if (fb.forbidden) {
        sound.playInvalid();
        this.setData({ forbidHint: FORBIDDEN_TEXT[fb.type] || '禁手' });
        var self = this;
        if (this.forbidTimer) {
          clearTimeout(this.forbidTimer);
        }
        this.forbidTimer = setTimeout(function () {
          self.setData({ forbidHint: '' });
        }, 1200);
        return false;
      }
    }

    this.board[r][c] = player;

    var now = Date.now();
    var spent = now - this.turnStart; // 本手消耗的时间，悔棋时需要归还
    this.times[player] += spent;
    this.turnStart = now;

    this.history.push({ r: r, c: c, player: player, spent: spent });

    sound.playPlace();

    // 胜负判定（按规则模式）
    var winner = 0;
    var winLine = null;
    if (this.data.rule === gomoku.RULE_STANDARD) {
      var res = gomoku.checkStandardResult(this.board, r, c, player);
      winner = res.winner;
      winLine = res.line;
    } else {
      winLine = gomoku.checkWin(this.board, r, c, player);
      if (winLine) {
        winner = player;
      }
    }

    var isDraw = winner === 0 && gomoku.isBoardFull(this.board);

    var patch = {
      current: player === 1 ? 2 : 1,
      moveCount: this.history.length,
      canUndo: true,
      time1: formatTime(this.times[1]),
      time2: formatTime(this.times[2])
    };

    if (winner || isDraw) {
      this.running = false;
      this.stopTimer();

      if (winner) {
        this.winLine = winLine;
        this.winAnim = { start: now };
        patch.winner = winner;
        patch.resultTime = formatTime(this.times[winner]);
        sound.playWin();
      } else {
        patch.isDraw = true;
      }
    }

    this.setData(patch);

    // 刷新禁手提示点（落子后局面变化，禁手点也随之变化）
    this.refreshForbiddenPoints();

    if (this.winAnim) {
      this.requestFrame(); // 五连高亮带入场动画
    } else {
      this.draw(); // 落子立即呈现，不做逐帧动画
    }

    // 人机模式：若对局未结束且轮到 AI（黑方），触发 AI 落子
    if (!winner && !isDraw && this.data.mode === 'pve' && this.data.current === 1) {
      this.aiPlay();
    }

    return true;
  },

  /**
   * AI 落子（人机模式，AI 执黑）
   */
  aiPlay: function () {
    var self = this;
    this.setData({ aiThinking: true });

    // 用 setTimeout 让「AI 思考中」状态先渲染出来，同时避免阻塞触摸事件
    setTimeout(function () {
      var mv = ai.aiMove(self.board, 1, self.data.level, self.data.rule);
      self.setData({ aiThinking: false });
      self.place(mv.r, mv.c);
    }, 220);
  },

  undo: function () {
    if (!this.history.length) {
      return;
    }
    // 人机模式：玩家悔棋需连悔两手（AI 一手 + 玩家一手），才能回到玩家可下的局面
    var steps = 1;
    if (this.data.mode === 'pve' && !this.data.winner && !this.data.isDraw) {
      steps = 2;
    }

    var patch = null;
    for (var i = 0; i < steps; i++) {
      if (!this.history.length) {
        break;
      }
      var last = this.history.pop();
      this.board[last.r][last.c] = 0;

      // 归还这一手消耗的时间，避免悔棋后重复计费
      if (typeof last.spent === 'number') {
        this.times[last.player] -= last.spent;
        if (this.times[last.player] < 0) {
          this.times[last.player] = 0;
        }
      }

      patch = {
        current: last.player,
        moveCount: this.history.length,
        canUndo: this.history.length > 0,
        time1: formatTime(this.times[1]),
        time2: formatTime(this.times[2])
      };
    }

    // 若上一手已终局，先解除终局态再继续
    if (this.data.winner || this.data.isDraw) {
      this.winLine = null;
      this.winAnim = null;
      patch.winner = 0;
      patch.isDraw = false;
      patch.resultTime = '';
      this.running = true;
      this.startTimer();
    }

    this.turnStart = Date.now();
    sound.playUndo();

    this.setData(patch);
    this.refreshForbiddenPoints();
    this.draw();

    // 人机模式：悔棋后若轮到 AI（黑方），触发 AI 落子
    if (this.data.mode === 'pve' && this.data.current === 1 && !this.data.winner && !this.data.isDraw) {
      this.aiPlay();
    }
  },

  restart: function () {
    // 对局进行中重开属于不可逆操作，先确认，避免误触清盘
    if (this.history.length && !this.data.winner && !this.data.isDraw) {
      var self = this;
      wx.showModal({
        title: '重新开始',
        content: '当前对局将作废，确定要重新开始吗？',
        confirmText: '重新开始',
        cancelText: '继续下棋',
        confirmColor: '#C88A1E',
        success: function (res) {
          if (res.confirm) {
            self.resetGame();
          }
        }
      });
      return;
    }

    this.resetGame();
  },

  // 实际执行清盘重开（供确认后调用）
  resetGame: function () {
    this.board = gomoku.createEmptyBoard();
    this.history = [];
    this.winAnim = null;
    this.winLine = null;
    this.times = { 1: 0, 2: 0 };
    this.turnStart = Date.now();
    this.running = true;
    this.startTimer();

    if (this.forbidTimer) {
      clearTimeout(this.forbidTimer);
      this.forbidTimer = null;
    }

    this.setData({
      current: 1,
      moveCount: 0,
      winner: 0,
      isDraw: false,
      canUndo: false,
      time1: '00:00',
      time2: '00:00',
      resultTime: '',
      forbidHint: '',
      aiThinking: false
    });

    this.refreshForbiddenPoints();
    this.draw();

    // 人机模式：AI 执黑先手，开局即触发 AI 落子
    if (this.data.mode === 'pve') {
      this.aiPlay();
    }
  },

  // ---------------- 开局菜单 ----------------

  noop: function () {},

  toggleMenu: function () {
    var next = !this.data.showMenu;
    var self = this;
    this.setData({ showMenu: next }, function () {
      // 关闭弹窗时棋盘 canvas 被重新渲染（wx:if 重建节点），需重新初始化并重绘
      if (!next) {
        self.initCanvas();
      }
    });
  },

  // 选择对战模式（pvp 双人 / pve 人机）
  selectMode: function (e) {
    var mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) {
      return;
    }
    this.setData({ mode: mode });
    this.resetGame();
  },

  // 选择规则（free 无禁手 / standard 标准禁手）
  selectRule: function (e) {
    var rule = e.currentTarget.dataset.rule;
    if (rule === this.data.rule) {
      return;
    }
    this.setData({ rule: rule });
    this.resetGame();
  },

  // 选择 AI 难度（easy / normal / hard）
  selectLevel: function (e) {
    var level = e.currentTarget.dataset.level;
    if (level === this.data.level) {
      return;
    }
    this.setData({ level: level });
    this.resetGame();
  }
});
