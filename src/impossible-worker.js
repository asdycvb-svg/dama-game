// ========================================
// ☠️ أتحداك تفوز
// AI Worker - يعمل بدون تجميد الصفحة
// ========================================

self.onmessage = (event) => {
  const data = event.data || {}

  if (data.type !== 'think') return

  try {
    const result = chooseImpossibleTurn(
      data.board,
      Number(data.maxTimeMs) || 30000
    )

    self.postMessage({
      type: 'result',
      steps: result.steps,
      depth: result.depth,
      score: result.score
    })
  } catch (error) {
    self.postMessage({
      type: 'result',
      steps: [],
      error: error?.message || String(error)
    })
  }
}


// ========================================
// اختيار أقوى دور
// ========================================

function chooseImpossibleTurn(board, maxTimeMs) {
  const allTurns = getHardTurns(board, 'black')

  if (allTurns.length === 0) {
    return {
      steps: [],
      depth: 0,
      score: -Infinity
    }
  }

  // إذا ما عنده إلا خيار واحد
  // يلعب مباشرة
  if (allTurns.length === 1) {
    return {
      steps: allTurns[0].steps,
      depth: 0,
      score: 0
    }
  }

  const startTime = performance.now()
  const deadline = startTime + maxTimeMs

  const table = new Map()

  let bestTurn = allTurns[0]
  let bestScore = -Infinity

  let completedDepth = 0

  let stableKey = null
  let stableCount = 0

  const pieceCount = countPieces(board)

  // الوقت هو المحدد الحقيقي
  const maxDepth =
    pieceCount <= 6
      ? 30
      : pieceCount <= 10
        ? 24
        : pieceCount <= 16
          ? 18
          : 14

  // ========================================
  // Iterative Deepening
  // ========================================

  for (
    let depth = 1;
    depth <= maxDepth;
    depth++
  ) {
    if (performance.now() >= deadline) {
      break
    }

    let depthBestTurn = null
    let depthBestScore = -Infinity
    let secondBestScore = -Infinity

    let aborted = false

    const ordered = orderTurns(
      board,
      allTurns,
      'black'
    )

    // نجرب أفضل حركة من العمق السابق أولًا
    if (bestTurn) {
      const previousKey = turnKey(bestTurn)

      const index = ordered.findIndex(
        turn => turnKey(turn) === previousKey
      )

      if (index > 0) {
        const [previous] = ordered.splice(index, 1)
        ordered.unshift(previous)
      }
    }

    for (const turn of ordered) {
      if (performance.now() >= deadline) {
        aborted = true
        break
      }

      const nextBoard = applyTurn(
        board,
        turn
      )

      const result = minimax(
        nextBoard,
        depth - 1,
        'cream',
        -Infinity,
        Infinity,
        deadline,
        table,
        1
      )

      if (result.timeout) {
        aborted = true
        break
      }

      const score =
        result.score +
        tieBreaker(turn) * 0.0001

      if (score > depthBestScore) {
        secondBestScore = depthBestScore
        depthBestScore = score
        depthBestTurn = turn
      }

      else if (score > secondBestScore) {
        secondBestScore = score
      }
    }

    // لا نعتمد عمقًا ناقصًا
    if (aborted || !depthBestTurn) {
      break
    }

    completedDepth = depth
    bestTurn = depthBestTurn
    bestScore = depthBestScore

    // ========================================
    // فحص ثبات أفضل حركة
    // ========================================

    const currentKey = turnKey(bestTurn)

    if (currentKey === stableKey) {
      stableCount++
    } else {
      stableKey = currentKey
      stableCount = 1
    }

    const elapsed =
      performance.now() - startTime

    const gap =
      secondBestScore === -Infinity
        ? Infinity
        : depthBestScore - secondBestScore

    // نرسل تقدم البحث للواجهة
    self.postMessage({
      type: 'progress',
      depth,
      score: Math.round(depthBestScore),
      stable: stableCount
    })

    // ========================================
    // إذا اكتشف فوزًا شبه محسوم
    // يلعب فورًا
    // ========================================

    if (
      depthBestScore > 8000000  &&
      elapsed >= 20000
    ) {
      break
    }

    // ========================================
    // نفس الحركة ثبتت عدة أعماق
    // لا ننتظر 3 دقائق
    // ========================================

    if (
      depth >= 20 &&
      stableCount >= 15 &&
      gap >= 300 &&
      elapsed >= 30000
    ) {
      break
    }

    // نهاية اللعب:
    // نخليه أكثر صبرًا
    if (
      pieceCount <= 10 &&
      depth >= 14 &&
      stableCount >= 6 &&
      gap >= 80 &&
      elapsed >= 5000
    ) {
      break
    }
  }

  return {
    steps: bestTurn?.steps || [],
    depth: completedDepth,
    score: bestScore
  }
}


// ========================================
// Minimax + Alpha Beta
// ========================================

function minimax(
  board,
  depth,
  color,
  alpha,
  beta,
  deadline,
  table,
  ply
) {
  if (performance.now() >= deadline) {
    return {
      score: 0,
      timeout: true
    }
  }

  const blackCount =
    countColor(board, 'black')

  const creamCount =
    countColor(board, 'cream')

  // الكمبيوتر خسر
  if (blackCount === 0) {
    return {
      score: -10000000 + ply,
      timeout: false
    }
  }

  // اللاعب خسر
  if (creamCount === 0) {
    return {
      score: 10000000 - ply,
      timeout: false
    }
  }

  const turns = getTurns(
    board,
    color
  )

  // لا توجد حركة قانونية
  if (turns.length === 0) {
    return {
      score:
        color === 'black'
          ? -9000000 + ply
          : 9000000 - ply,

      timeout: false
    }
  }

  // نهاية العمق
  if (depth <= 0) {
    return {
      score: evaluateBoard(board),
      timeout: false
    }
  }

  const key =
    `${boardKey(board)}|${color}|${depth}`

  const cached = table.get(key)

  if (cached !== undefined) {
    return {
      score: cached,
      timeout: false
    }
  }

  const ordered = orderTurns(
    board,
    turns,
    color
  )

  let best =
    color === 'black'
      ? -Infinity
      : Infinity

  let cutOff = false

  for (const turn of ordered) {
    if (performance.now() >= deadline) {
      return {
        score: 0,
        timeout: true
      }
    }

    const nextBoard = applyTurn(
      board,
      turn
    )

    const result = minimax(
      nextBoard,
      depth - 1,

      color === 'black'
        ? 'cream'
        : 'black',

      alpha,
      beta,
      deadline,
      table,
      ply + 1
    )

    if (result.timeout) {
      return result
    }

    // الكمبيوتر يحاول رفع التقييم
    if (color === 'black') {
      best = Math.max(
        best,
        result.score
      )

      alpha = Math.max(
        alpha,
        best
      )
    }

    // اللاعب يحاول خفض التقييم
    else {
      best = Math.min(
        best,
        result.score
      )

      beta = Math.min(
        beta,
        best
      )
    }

    if (beta <= alpha) {
      cutOff = true
      break
    }
  }

  // ما نخزن نتيجة مقصوصة على أنها نتيجة مؤكدة
  if (!cutOff) {
    table.set(
      key,
      best
    )
  }

  return {
    score: best,
    timeout: false
  }
}


// ========================================
// تقييم الرقعة
// الأسود موجب
// الحليبي سالب
// ========================================

function evaluateBoard(board) {
  let score = 0

  let blackKings = 0
  let creamKings = 0

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col]

      if (!piece) continue

      let value =
        piece.king
          ? 340
          : 100

      // ========================================
      // الملك
      // ========================================

      if (piece.king) {
        if (piece.color === 'black') {
          blackKings++
        } else {
          creamKings++
        }
      }

      // ========================================
      // الحجر العادي
      // ========================================

      else {
        const progress =
          piece.color === 'black'
            ? row
            : 7 - row

        value += progress * 8

        // قريب جدًا من الملك
        if (progress === 6) {
          value += 45
        }
      }

      // السيطرة على الوسط
      if (
        row >= 2 &&
        row <= 5 &&
        col >= 2 &&
        col <= 5
      ) {
        value += 12
      }

      // الحافة تعطي حماية بسيطة
      if (
        col === 0 ||
        col === 7
      ) {
        value += 5
      }

      if (piece.color === 'black') {
        score += value
      } else {
        score -= value
      }
    }
  }

  // فرق الملوك
  score +=
    (blackKings - creamKings) * 35

  // القطع المعرضة للأكل
  score -=
    countThreatened(
      board,
      'black'
    ) * 35

  score +=
    countThreatened(
      board,
      'cream'
    ) * 32

  return score
}


// ========================================
// حساب القطع المعرضة للأكل
// ========================================

function countThreatened(
  board,
  color
) {
  const enemy =
    color === 'black'
      ? 'cream'
      : 'black'

  const threatened = new Set()

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col]

      if (
        !piece ||
        piece.color !== enemy
      ) {
        continue
      }

      const captures =
        getCaptures(
          board,
          row,
          col
        )

      for (const move of captures) {
        const victim =
          board[
            move.capturedRow
          ]?.[
            move.capturedCol
          ]

        if (
          victim &&
          victim.color === color
        ) {
          threatened.add(
            `${move.capturedRow},${move.capturedCol}`
          )
        }
      }
    }
  }

  return threatened.size
}


// ========================================
// توليد الدور الكامل
// ========================================

function getTurns(
  board,
  color
) {
  const captureTurns = []

  // ========================================
  // نبحث عن الأكل أولًا
  // ========================================

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col]

      if (
        !piece ||
        piece.color !== color
      ) {
        continue
      }

      const captures =
        getCaptures(
          board,
          row,
          col
        )

      for (const capture of captures) {
        // هل كان ملك قبل الحركة؟
        const wasKing =
          piece.king

        const move = {
          ...capture,
          wasKingBefore: wasKing
        }

        const nextBoard =
          applyMove(
            board,
            move
          )

        const movedPiece =
          nextBoard[
            move.row
          ][
            move.col
          ]

        // ========================================
        // قانوننا:
        // إذا صار ملك الآن ينتهي الدور فورًا
        // ========================================

        const justBecameKing =
          !wasKing &&
          movedPiece?.king === true

        if (justBecameKing) {
          captureTurns.push({
            steps: [move]
          })

          continue
        }

        buildCaptureTurns(
          nextBoard,
          move.row,
          move.col,
          [move],
          captureTurns
        )
      }
    }
  }

  // الأكل إجباري
  if (captureTurns.length > 0) {
    return captureTurns
  }

  // ========================================
  // لا يوجد أكل
  // ========================================

  const turns = []

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col]

      if (
        !piece ||
        piece.color !== color
      ) {
        continue
      }

      const moves =
        getNormalMoves(
          board,
          row,
          col
        )

      for (const move of moves) {
        turns.push({
          steps: [move]
        })
      }
    }
  }

  return turns
}


// ========================================
// بناء الأكل المتعدد
// ========================================

function buildCaptureTurns(
  board,
  row,
  col,
  steps,
  result
) {
  const piece =
    board[row][col]

  if (!piece) {
    result.push({ steps })
    return
  }

  const more =
    getCaptures(
      board,
      row,
      col
    )

  if (more.length === 0) {
    result.push({ steps })
    return
  }

  for (const capture of more) {
    const wasKing =
      piece.king

    const move = {
      ...capture,
      wasKingBefore: wasKing
    }

    const nextBoard =
      applyMove(
        board,
        move
      )

    const movedPiece =
      nextBoard[
        move.row
      ][
        move.col
      ]

    const nextSteps = [
      ...steps,
      move
    ]

    // الترقية توقف سلسلة الأكل
    if (
      !wasKing &&
      movedPiece?.king === true
    ) {
      result.push({
        steps: nextSteps
      })

      continue
    }

    buildCaptureTurns(
      nextBoard,
      move.row,
      move.col,
      nextSteps,
      result
    )
  }
}


// ========================================
// الحركات العادية
// ========================================

function getNormalMoves(
  board,
  row,
  col
) {
  const piece =
    board[row][col]

  if (!piece) return []

  const moves = []

  // ========================================
  // الملك الطائر
  // ========================================

  if (piece.king) {
    const directions = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ]

    for (const [dr, dc] of directions) {
      let newRow = row + dr
      let newCol = col + dc

      while (
        inside(
          newRow,
          newCol
        )
      ) {
        if (
          board[
            newRow
          ][
            newCol
          ]
        ) {
          break
        }

        moves.push({
          fromRow: row,
          fromCol: col,

          row: newRow,
          col: newCol,

          capture: false
        })

        newRow += dr
        newCol += dc
      }
    }

    return moves
  }

  // ========================================
  // الحجر العادي
  // يتحرك للأمام فقط
  // ========================================

  const directions =
    piece.color === 'cream'
      ? [
          [-1, -1],
          [-1, 1]
        ]
      : [
          [1, -1],
          [1, 1]
        ]

  for (const [dr, dc] of directions) {
    const newRow = row + dr
    const newCol = col + dc

    if (
      !inside(
        newRow,
        newCol
      )
    ) {
      continue
    }

    if (
      board[
        newRow
      ][
        newCol
      ]
    ) {
      continue
    }

    moves.push({
      fromRow: row,
      fromCol: col,

      row: newRow,
      col: newCol,

      capture: false
    })
  }

  return moves
}


// ========================================
// الأكل
// ========================================

function getCaptures(
  board,
  row,
  col
) {
  const piece =
    board[row][col]

  if (!piece) return []

  const moves = []

  // ========================================
  // الملك
  // يرى الخصم من بعيد
  // ويهبط مربعًا واحدًا فقط بعده
  // ========================================

  if (piece.king) {
    const directions = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ]

    for (const [dr, dc] of directions) {
      let checkRow = row + dr
      let checkCol = col + dc

      while (
        inside(
          checkRow,
          checkCol
        )
      ) {
        const target =
          board[
            checkRow
          ][
            checkCol
          ]

        // فراغ قبل الخصم
        if (!target) {
          checkRow += dr
          checkCol += dc
          continue
        }

        // حجر من نفس اللون
        if (
          target.color ===
          piece.color
        ) {
          break
        }

        // وجدنا الخصم
        const landingRow =
          checkRow + dr

        const landingCol =
          checkCol + dc

        if (
          !inside(
            landingRow,
            landingCol
          )
        ) {
          break
        }

        // أول مربع بعد الخصم مشغول
        if (
          board[
            landingRow
          ][
            landingCol
          ]
        ) {
          break
        }

        moves.push({
          fromRow: row,
          fromCol: col,

          row: landingRow,
          col: landingCol,

          capture: true,

          capturedRow: checkRow,
          capturedCol: checkCol
        })

        // لا نسمح له بالهبوط أبعد
        break
      }
    }

    return moves
  }

  // ========================================
  // الحجر العادي
  // يأكل للأمام فقط
  // ========================================

  const directions =
    piece.color === 'cream'
      ? [
          [-1, -1],
          [-1, 1]
        ]
      : [
          [1, -1],
          [1, 1]
        ]

  for (const [dr, dc] of directions) {
    const enemyRow =
      row + dr

    const enemyCol =
      col + dc

    const landingRow =
      row + dr * 2

    const landingCol =
      col + dc * 2

    if (
      !inside(
        enemyRow,
        enemyCol
      ) ||
      !inside(
        landingRow,
        landingCol
      )
    ) {
      continue
    }

    const enemy =
      board[
        enemyRow
      ][
        enemyCol
      ]

    if (!enemy) continue

    if (
      enemy.color ===
      piece.color
    ) {
      continue
    }

    if (
      board[
        landingRow
      ][
        landingCol
      ]
    ) {
      continue
    }

    moves.push({
      fromRow: row,
      fromCol: col,

      row: landingRow,
      col: landingCol,

      capture: true,

      capturedRow: enemyRow,
      capturedCol: enemyCol
    })
  }

  return moves
}


// ========================================
// تطبيق حركة
// ========================================

function applyMove(
  board,
  move
) {
  const next =
    copyBoard(board)

  const piece =
    next[
      move.fromRow
    ][
      move.fromCol
    ]

  if (!piece) {
    return next
  }

  next[
    move.fromRow
  ][
    move.fromCol
  ] = null

  if (move.capture) {
    next[
      move.capturedRow
    ][
      move.capturedCol
    ] = null
  }

  const movedPiece = {
    ...piece
  }

  // ترقية الحليبي
  if (
    movedPiece.color === 'cream' &&
    !movedPiece.king &&
    move.row === 0
  ) {
    movedPiece.king = true
  }

  // ترقية الأسود
  if (
    movedPiece.color === 'black' &&
    !movedPiece.king &&
    move.row === 7
  ) {
    movedPiece.king = true
  }

  next[
    move.row
  ][
    move.col
  ] = movedPiece

  return next
}


// ========================================
// تطبيق الدور الكامل
// ========================================

function applyTurn(
  board,
  turn
) {
  let next =
    copyBoard(board)

  for (const step of turn.steps) {
    next =
      applyMove(
        next,
        step
      )
  }

  return next
}


// ========================================
// ترتيب الحركات
// ========================================

function orderTurns(
  board,
  turns,
  color
) {
  return [...turns].sort(
    (a, b) =>
      turnOrderScore(
        board,
        b,
        color
      ) -
      turnOrderScore(
        board,
        a,
        color
      )
  )
}


function turnOrderScore(
  board,
  turn,
  color
) {
  const first =
    turn.steps[0]

  const last =
    turn.steps[
      turn.steps.length - 1
    ]

  const piece =
    board[
      first.fromRow
    ][
      first.fromCol
    ]

  let score = 0

  // الأكل المتعدد أولًا
  score +=
    turn.steps.length * 120

  // الوصول للملك
  if (
    piece &&
    !piece.king
  ) {
    if (
      color === 'black' &&
      last.row === 7
    ) {
      score += 220
    }

    if (
      color === 'cream' &&
      last.row === 0
    ) {
      score += 220
    }
  }

  // الوسط
  if (
    last.row >= 2 &&
    last.row <= 5 &&
    last.col >= 2 &&
    last.col <= 5
  ) {
    score += 15
  }

  return score
}


// ========================================
// أدوات
// ========================================

function copyBoard(board) {
  return board.map(
    row =>
      row.map(
        piece =>
          piece
            ? { ...piece }
            : null
      )
  )
}


function inside(
  row,
  col
) {
  return (
    row >= 0 &&
    row < 8 &&
    col >= 0 &&
    col < 8
  )
}


function countColor(
  board,
  color
) {
  let count = 0

  for (const row of board) {
    for (const piece of row) {
      if (
        piece &&
        piece.color === color
      ) {
        count++
      }
    }
  }

  return count
}


function countPieces(board) {
  return (
    countColor(
      board,
      'black'
    ) +
    countColor(
      board,
      'cream'
    )
  )
}


function boardKey(board) {
  let key = ''

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece =
        board[row][col]

      if (!piece) {
        key += '.'
      }

      else if (
        piece.color === 'black'
      ) {
        key +=
          piece.king
            ? 'B'
            : 'b'
      }

      else {
        key +=
          piece.king
            ? 'C'
            : 'c'
      }
    }
  }

  return key
}


function turnKey(turn) {
  return turn.steps
    .map(step => {
      return (
        `${step.fromRow},${step.fromCol}` +
        `>${step.row},${step.col}` +
        `:${step.capture ? 1 : 0}`
      )
    })
    .join('|')
}


function tieBreaker(turn) {
  const last =
    turn.steps[
      turn.steps.length - 1
    ]

  return (
    (
      last.row * 8 +
      last.col +
      turn.steps.length * 3
    ) % 17
  )
}