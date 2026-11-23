/**
 * 五子棋人机对战 AI 模块
 * 纯逻辑，基于棋型评分 + 浅层前瞻，不依赖小程序 API，便于单测。
 *
 * 思路：对每个空点，分别计算「进攻分」（自己落子收益）与「防守分」
 * （假设对手落子的威胁），加权求和作为该点估值，取最高者落子。
 * 难度通过「是否加入随机扰动」与「前瞻层数」区分。
 *
 * 棋型评分（经验值，越高越强）：
 *   FIVE  成五     1e8
 *   LIVE4 活四     1e6
 *   RUSH4 冲四     8e4
 *   LIVE3 活三     4e3
 *   SLEEP3 眠三    8e2
 *   LIVE2 活二     6e1
 *   SLEEP2 眠二    8e0
 */

var gomoku = require('./gomoku.js');

var SIZE = gomoku.BOARD_SIZE;

// 难度档
var LEVEL_EASY = 'easy';
var LEVEL_NORMAL = 'normal';
var LEVEL_HARD = 'hard';

// 评分常量
var SCORE_FIVE = 100000000;
var SCORE_LIVE4 = 1000000;
var SCORE_RUSH4 = 80000;
var SCORE_LIVE3 = 4000;
var SCORE_SLEEP3 = 800;
var SCORE_LIVE2 = 60;
var SCORE_SLEEP2 = 8;

// 四方向
var DIRS = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1]
];

/**
 * 取一个方向上的连续同色计数与两端空位。
 */
function lineInfo(board, r, c, dr, dc, player) {
  var count = 1;
  var open = 0;

  var rr = r + dr;
  var cc = c + dc;
  while (gomoku.inBounds(rr, cc) && board[rr][cc] === player) {
    count++;
    rr += dr;
    cc += dc;
  }
  if (gomoku.inBounds(rr, cc) && board[rr][cc] === 0) {
    open++;
  }

  rr = r - dr;
  cc = c - dc;
  while (gomoku.inBounds(rr, cc) && board[rr][cc] === player) {
    count++;
    rr -= dr;
    cc -= dc;
  }
  if (gomoku.inBounds(rr, cc) && board[rr][cc] === 0) {
    open++;
  }

  return { count: count, open: open };
}

/**
 * 对单个空点，估算 player 在此落子的进攻价值。
 */
function pointScore(board, r, c, player) {
  var score = 0;
  var fourCount = 0;
  var threeCount = 0;

  for (var d = 0; d < DIRS.length; d++) {
    var info = lineInfo(board, r, c, DIRS[d][0], DIRS[d][1], player);

    if (info.count >= 5) {
      score += SCORE_FIVE;
    } else if (info.count === 4) {
      if (info.open === 2) {
        score += SCORE_LIVE4;
      } else if (info.open === 1) {
        score += SCORE_RUSH4;
        fourCount++;
      }
    } else if (info.count === 3) {
      if (info.open === 2) {
        score += SCORE_LIVE3;
        threeCount++;
      } else if (info.open === 1) {
        score += SCORE_SLEEP3;
      }
    } else if (info.count === 2) {
      if (info.open === 2) {
        score += SCORE_LIVE2;
      } else if (info.open === 1) {
        score += SCORE_SLEEP2;
      }
    }
  }

  // 活四/冲四同时存在时，实际威胁超过单个冲四，适当抬分
  if (fourCount >= 2) {
    score += SCORE_LIVE4 / 2;
  }

  return score;
}

/**
 * 生成候选空点：只考虑已有棋子周围 2 格内的空点，缩小搜索空间。
 */
function candidateMoves(board) {
  var set = {};
  var range = 2;
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) {
        continue;
      }
      for (var dr = -range; dr <= range; dr++) {
        for (var dc = -range; dc <= range; dc++) {
          var nr = r + dr;
          var nc = c + dc;
          if (gomoku.inBounds(nr, nc) && board[nr][nc] === 0) {
            set[nr + ',' + nc] = true;
          }
        }
      }
    }
  }
  var moves = [];
  for (var key in set) {
    var parts = key.split(',');
    moves.push({ r: parseInt(parts[0], 10), c: parseInt(parts[1], 10) });
  }
  return moves;
}

/**
 * 找到当前局面下 player 的最佳落子。
 *
 * @param {number[][]} board 当前棋盘（不会修改）
 * @param {number} player 1 黑 / 2 白
 * @param {string} level easy / normal / hard
 * @param {number|null} aiPlayer AI 执子颜色（用于进攻/防守权重微调，可空）
 * @returns {{r: number, c: number}}
 */
function findBestMove(board, player, level, aiPlayer) {
  var opponent = player === 1 ? 2 : 1;

  // 空盘：固定走天元附近，带一点随机
  var moves = candidateMoves(board);
  if (moves.length === 0) {
    return { r: 7, c: 7 };
  }

  var best = null;
  var bestScore = -Infinity;

  for (var i = 0; i < moves.length; i++) {
    var m = moves[i];

    // 标准规则下，若 AI 是黑方，跳过禁手点
    if (aiPlayer === 1 && gomoku.checkBlackForbidden(board, m.r, m.c).forbidden) {
      continue;
    }

    var attack = pointScore(board, m.r, m.c, player);
    var defend = pointScore(board, m.r, m.c, opponent);

    // 防守权重略高于进攻（对手成五/活四威胁更紧迫）
    var score = attack + defend * 1.05;

    // 难度扰动
    if (level === LEVEL_EASY) {
      score += Math.random() * 200;
    } else if (level === LEVEL_NORMAL) {
      score += Math.random() * 30;
    }
    // hard 不扰动

    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  return best || { r: 7, c: 7 };
}

/**
 * 面向页面层的高层接口：给定棋盘与难度，返回 AI 落点。
 * board 会被内部复制，不会污染调用方。
 *
 * @param {number[][]} board
 * @param {number} player AI 执子颜色
 * @param {string} level
 * @param {string} rule gomoku.RULE_FREE / RULE_STANDARD
 */
function aiMove(board, player, level, rule) {
  var copy = gomoku.cloneBoard(board);
  var aiPlayer = rule === gomoku.RULE_STANDARD ? player : null;
  return findBestMove(copy, player, level, aiPlayer);
}

module.exports = {
  LEVEL_EASY: LEVEL_EASY,
  LEVEL_NORMAL: LEVEL_NORMAL,
  LEVEL_HARD: LEVEL_HARD,
  findBestMove: findBestMove,
  aiMove: aiMove
};
