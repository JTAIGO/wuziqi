/**
 * 五子棋核心规则模块
 * 纯逻辑，不依赖任何小程序 API，便于单测与复用。
 *
 * 棋盘约定：board[row][col]，取值 0 = 空，1 = 黑，2 = 白
 * 坐标约定：row 向下递增，col 向右递增，均从 0 开始
 *
 * 规则模式：
 *  - RULE_FREE     无禁手：连成五子即胜，黑/白一致（经典自由规则）
 *  - RULE_STANDARD 标准规则：黑方存在禁手（三三、四四、长连），
 *                  黑方落下禁手即判负；白方长连照常判胜。
 */

var BOARD_SIZE = 15;

var RULE_FREE = 'free';
var RULE_STANDARD = 'standard';

// 四组方向向量，只需检查右、下、右下、左下四条轴线
var DIRECTIONS = [
  [0, 1], // 水平
  [1, 0], // 垂直
  [1, 1], // 主对角线
  [1, -1] // 副对角线
];

/**
 * 生成空棋盘
 * @returns {number[][]}
 */
function createEmptyBoard() {
  var board = [];
  for (var r = 0; r < BOARD_SIZE; r++) {
    var row = [];
    for (var c = 0; c < BOARD_SIZE; c++) {
      row.push(0);
    }
    board.push(row);
  }
  return board;
}

/**
 * 深拷贝棋盘
 */
function cloneBoard(board) {
  var copy = [];
  for (var r = 0; r < BOARD_SIZE; r++) {
    copy.push(board[r].slice());
  }
  return copy;
}

/**
 * 判断坐标是否落在棋盘内
 */
function inBounds(r, c) {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

/**
 * 沿某个方向，从 (row,col) 出发收集一条同色连线（含起点，不含起点两侧外扩）。
 * 返回连续同色子的坐标数组。
 */
function collectLine(board, row, col, dr, dc, player) {
  var line = [[row, col]];
  var r = row + dr;
  var c = col + dc;
  while (inBounds(r, c) && board[r][c] === player) {
    line.push([r, c]);
    r += dr;
    c += dc;
  }
  r = row - dr;
  c = col - dc;
  while (inBounds(r, c) && board[r][c] === player) {
    line.unshift([r, c]);
    r -= dr;
    c -= dc;
  }
  return line;
}

/**
 * 检查在 (row, col) 落子后是否形成五连（含五连以上）。
 * 此函数只负责"连成五子及以上"这一层，不含禁手；
 * 长连（>=6）在这里也会被返回，是否判负由调用方按规则模式处理。
 *
 * @returns {number[][]|null} 命中时返回构成连线的全部坐标，否则 null
 */
function checkWin(board, row, col, player) {
  if (!inBounds(row, col) || board[row][col] !== player) {
    return null;
  }

  for (var d = 0; d < DIRECTIONS.length; d++) {
    var line = collectLine(board, row, col, DIRECTIONS[d][0], DIRECTIONS[d][1], player);
    if (line.length >= 5) {
      return line;
    }
  }

  return null;
}

/**
 * 判断在 (row,col)（已落 player）是否形成「长连」（连子数 >= 6）。
 */
function isOverline(board, row, col, player) {
  if (!inBounds(row, col) || board[row][col] !== player) {
    return false;
  }
  for (var d = 0; d < DIRECTIONS.length; d++) {
    var line = collectLine(board, row, col, DIRECTIONS[d][0], DIRECTIONS[d][1], player);
    if (line.length >= 6) {
      return true;
    }
  }
  return false;
}

/**
 * 统计某方向上，把 (row,col) 视为已落 player 后的连子数与两端空位。
 * @returns {{count: number, open: number}} count 连子数，open 两端空位数（0~2）
 */
function evalDirection(board, row, col, player, dr, dc) {
  var count = 1;
  var open = 0;

  var r = row + dr;
  var c = col + dc;
  while (inBounds(r, c) && board[r][c] === player) {
    count++;
    r += dr;
    c += dc;
  }
  if (inBounds(r, c) && board[r][c] === 0) {
    open++;
  }

  r = row - dr;
  c = col - dc;
  while (inBounds(r, c) && board[r][c] === player) {
    count++;
    r -= dr;
    c -= dc;
  }
  if (inBounds(r, c) && board[r][c] === 0) {
    open++;
  }

  return { count: count, open: open };
}

/**
 * 判断 (row,col) 落 player 后形成的「活三」数量。
 * 活三 = 连子数 3 且两端皆空。
 */
function countOpenThree(board, row, col, player) {
  var n = 0;
  for (var d = 0; d < DIRECTIONS.length; d++) {
    var e = evalDirection(board, row, col, player, DIRECTIONS[d][0], DIRECTIONS[d][1]);
    if (e.count === 3 && e.open === 2) {
      n++;
    }
  }
  return n;
}

/**
 * 判断 (row,col) 落 player 后形成的「四」数量（活四或冲四）。
 * 四 = 连子数 4 且至少一端空。
 */
function countFour(board, row, col, player) {
  var n = 0;
  for (var d = 0; d < DIRECTIONS.length; d++) {
    var e = evalDirection(board, row, col, player, DIRECTIONS[d][0], DIRECTIONS[d][1]);
    if (e.count === 4 && e.open >= 1) {
      n++;
    }
  }
  return n;
}

/**
 * 黑方禁手判定（标准规则）。
 * 仅在「假设 (row,col) 已落下黑子」的快照上判断，不修改原棋盘。
 *
 * 三种禁手：
 *  - 三三禁手：一子同时形成两个或以上「活三」
 *  - 四四禁手：一子同时形成两个或以上「四」（活四或冲四）
 *  - 长连禁手：一子落下后形成连子数 >= 6
 *
 * @returns {{forbidden: boolean, type: string|null}}
 */
function checkBlackForbidden(board, row, col) {
  if (!inBounds(row, col) || board[row][col] !== 0) {
    return { forbidden: false, type: null };
  }

  var snap = cloneBoard(board);
  snap[row][col] = 1;

  if (isOverline(snap, row, col, 1)) {
    return { forbidden: true, type: 'overline' };
  }
  if (countFour(snap, row, col, 1) >= 2) {
    return { forbidden: true, type: 'doubleFour' };
  }
  if (countOpenThree(snap, row, col, 1) >= 2) {
    return { forbidden: true, type: 'doubleThree' };
  }

  return { forbidden: false, type: null };
}

/**
 * 扫描整张棋盘上所有对「黑方」而言构成禁手的空位（标准规则）。
 * 用于禁手提示可视化：轮到黑方时把不可落的位置标记出来。
 *
 * 只对已有黑子附近的空位做校验（远离任何棋子的空位不可能成禁手），
 * 缩小扫描范围，避免每次重绘都全盘 225 点 × 四方向计算。
 *
 * @returns {{forbidden: Array<{r:number,c:number,type:string}>, reason: Object<string, number>}}
 */
function scanForbiddenPoints(board) {
  var points = [];
  var reasonCount = { doubleThree: 0, doubleFour: 0, overline: 0 };
  var hasAny = false;
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 1) {
        hasAny = true;
        break;
      }
    }
    if (hasAny) {
      break;
    }
  }

  // 没有黑子，不可能有禁手
  if (!hasAny) {
    return { points: points, reason: reasonCount };
  }

  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] !== 0) {
        continue;
      }
      // 仅当周围 2 格内有黑子才可能构成禁手，跳过明显无关的空位
      if (!nearBlack(board, r, c, 2)) {
        continue;
      }
      var fb = checkBlackForbidden(board, r, c);
      if (fb.forbidden) {
        points.push({ r: r, c: c, type: fb.type });
        reasonCount[fb.type] = (reasonCount[fb.type] || 0) + 1;
      }
    }
  }

  return { points: points, reason: reasonCount };
}

/**
 * 判断 (row,col) 周围 radius 格范围内是否存在黑子。
 */
function nearBlack(board, row, col, radius) {
  var r0 = Math.max(0, row - radius);
  var r1 = Math.min(BOARD_SIZE - 1, row + radius);
  var c0 = Math.max(0, col - radius);
  var c1 = Math.min(BOARD_SIZE - 1, col + radius);
  for (var r = r0; r <= r1; r++) {
    for (var c = c0; c <= c1; c++) {
      if (board[r][c] === 1) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 标准规则下，落子后的完整胜负判定（棋盘已包含该落子）。
 *
 * @returns {{winner: number, reason: string, line: number[][]|null}}
 *   winner：1 黑胜 / 2 白胜 / 0 未结束
 */
function checkStandardResult(board, row, col, player) {
  if (player === 1) {
    // 黑方：长连判负（白胜）
    if (isOverline(board, row, col, 1)) {
      return { winner: 2, reason: 'overline', line: null };
    }
    var blackWin = checkWin(board, row, col, 1);
    if (blackWin) {
      return { winner: 1, reason: 'five', line: blackWin };
    }
    return { winner: 0, reason: '', line: null };
  }

  // 白方：连五即胜（白方无禁手）
  var whiteWin = checkWin(board, row, col, 2);
  if (whiteWin) {
    return { winner: 2, reason: 'five', line: whiteWin };
  }
  return { winner: 0, reason: '', line: null };
}

/**
 * 棋盘是否已下满
 */
function isBoardFull(board) {
  for (var r = 0; r < BOARD_SIZE; r++) {
    for (var c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === 0) {
        return false;
      }
    }
  }
  return true;
}

module.exports = {
  BOARD_SIZE: BOARD_SIZE,
  RULE_FREE: RULE_FREE,
  RULE_STANDARD: RULE_STANDARD,
  createEmptyBoard: createEmptyBoard,
  cloneBoard: cloneBoard,
  checkWin: checkWin,
  isOverline: isOverline,
  checkBlackForbidden: checkBlackForbidden,
  scanForbiddenPoints: scanForbiddenPoints,
  checkStandardResult: checkStandardResult,
  isBoardFull: isBoardFull,
  inBounds: inBounds
};
