// 🛡️ khaled-worker.js
// محرك مستوى "خالد" — دفاعي جدًا، عميق، ويعمل خارج خيط واجهة الصفحة.

self.onmessage = (event) => {
  const data = event.data || {}
  if (data.type !== 'think') return

  try {
    const result = chooseKhaledTurn(
      data.board,
      Number(data.maxTimeMs) || 600000,
      Number(data.moveNumber) || 0
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

function chooseKhaledTurn(
  board,
  maxTimeMs,
  moveNumber = 0
) {
  const allTurns =
    getHardTurns(
      board,
      'black'
    )

  if (allTurns.length === 0) {
    return {
      steps: [],
      depth: 0,
      score: -Infinity
    }
  }

  const startTime =
    performance.now()

  const deadline =
    startTime +
    Math.max(
      1500,
      maxTimeMs
    )

  // إذا ما فيه إلا حركة واحدة، القرار محسوم.
  // main.js يتكفل بعدم تنفيذها بسرعة مبالغ فيها.
  if (allTurns.length === 1) {
    return {
      steps:
        allTurns[0].steps,
      depth: 0,
      score:
        evaluateKhaledBoard(
          applyHardTurn(
            board,
            allTurns[0]
          )
        )
    }
  }

  const table =
    new Map()

  const heuristics = {
    killers: new Map(),
    history: new Map()
  }

  let bestTurn =
    allTurns[0]

  let bestScore =
    -Infinity

  let completedDepth = 0
  let lastRootScores = []

  const pieceCount =
    countHardPieces(board)

  const rootHasCapture =
    allTurns.some(
      turn =>
        turn.steps.some(
          step => step.capture
        )
    )

  // التنويع فقط في الافتتاحية، وفقط إذا ما فيه أكل إجباري.
  // الاختيار النهائي يبقى من الحركات المتقاربة جدًا بالقوة.
  const openingRandomAllowed =
    moveNumber <= 5 &&
    pieceCount >= 22 &&
    !rootHasCapture

  // عمق مرتفع جدًا، خصوصًا في النهايات.
  // الزمن هو الحارس الحقيقي؛ أقصى تفكير يظل كما يرسله main.js.
  const maxDepth =
    pieceCount <= 6
      ? 220
      : pieceCount <= 8
        ? 180
        : pieceCount <= 10
          ? 110
          : pieceCount <= 16
            ? 68
            : 40

  let stableKey = null
  let stableCount = 0

  for (
    let depth = 5;
    depth <= maxDepth;
    depth++
  ) {
    if (
      performance.now() >=
      deadline
    ) {
      break
    }

    let depthBestTurn = null
    let depthBestScore =
      -Infinity
    let aborted = false

    const ordered =
      orderKhaledSearchTurns(
        board,
        allTurns,
        'black',
        heuristics,
        0
      )

    // Principal variation من العمق السابق أولًا.
    const oldKey =
      khaledTurnKey(bestTurn)

    const oldIndex =
      ordered.findIndex(
        turn =>
          khaledTurnKey(turn) ===
          oldKey
      )

    if (oldIndex > 0) {
      const [oldBest] =
        ordered.splice(
          oldIndex,
          1
        )

      ordered.unshift(oldBest)
    }

    const depthScores = []
    let rootAlpha = -Infinity

    for (
      const turn of ordered
    ) {
      if (
        performance.now() >=
        deadline
      ) {
        aborted = true
        break
      }

      const nextBoard =
        applyHardTurn(
          board,
          turn
        )

      // في الافتتاح نحسب كل جذر بدقة أكبر حتى تكون
      // العشوائية بين حركات متقاربة فعلًا.
      const childAlpha =
        openingRandomAllowed
          ? -Infinity
          : rootAlpha

      const result =
        khaledMinimax(
          nextBoard,
          depth - 1,
          'cream',
          childAlpha,
          Infinity,
          deadline,
          table,
          heuristics,
          1
        )

      if (result.timeout) {
        aborted = true
        break
      }

      const score =
        result.score +
        khaledTieBreaker(
          board,
          turn
        ) *
          0.0001

      depthScores.push({
        turn,
        score
      })

      if (
        score >
        depthBestScore
      ) {
        depthBestScore = score
        depthBestTurn = turn
      }

      rootAlpha =
        Math.max(
          rootAlpha,
          score
        )
    }

    if (
      aborted ||
      !depthBestTurn
    ) {
      break
    }

    completedDepth = depth
    bestTurn = depthBestTurn
    bestScore = depthBestScore

    lastRootScores =
      depthScores
        .sort(
          (a, b) =>
            b.score - a.score
        )

    const key =
      khaledTurnKey(
        bestTurn
      )

    if (key === stableKey) {
      stableCount++
    }
    else {
      stableKey = key
      stableCount = 1
    }

    self.postMessage({
      type: 'progress',
      depth,
      score:
        Math.round(
          depthBestScore
        ),
      stable:
        stableCount
    })

    trimKhaledTable(table)

    const elapsed =
      performance.now() -
      startTime

    // نوقف مبكرًا فقط عند فوز شبه محسوم وبعد تحليل كافٍ.
    // غير ذلك خالد يستمر حتى حد العمق أو الوقت.
    if (
      depthBestScore >
        9000000 &&
      elapsed >= 30000 &&
      stableCount >= 3
    ) {
      break
    }
  }

  let selectedTurn =
    bestTurn

  // افتتاحية عشوائية ذكية: لا نختار إلا من الحركات
  // القريبة جدًا من أفضل نتيجة محسوبة.
  if (
    openingRandomAllowed &&
    completedDepth >= 5 &&
    Number.isFinite(bestScore) &&
    Math.abs(bestScore) < 8000000 &&
    lastRootScores.length > 1
  ) {
    const margin = 8

    const candidates =
      lastRootScores
        .filter(
          item =>
            item.score >=
            bestScore - margin
        )
        .slice(0, 3)

    if (candidates.length > 1) {
      const pick =
        candidates[
          Math.floor(
            Math.random() *
            candidates.length
          )
        ]

      if (pick?.turn) {
        selectedTurn =
          pick.turn
      }
    }
  }

  return {
    steps:
      selectedTurn?.steps || [],
    depth:
      completedDepth,
    score:
      bestScore
  }
}


function trimKhaledTable(table) {
  const limit = 320000

  if (table.size <= limit) {
    return
  }

  // بدل مسح كل الذاكرة، نحذف الأقدم فقط ونبقي الأحدث.
  const removeCount =
    Math.floor(
      limit * 0.28
    )

  let removed = 0

  for (
    const key of table.keys()
  ) {
    table.delete(key)
    removed++

    if (removed >= removeCount) {
      break
    }
  }
}


function orderKhaledSearchTurns(
  board,
  turns,
  color,
  heuristics,
  ply
) {
  const killers =
    heuristics
      ?.killers
      ?.get(ply) || []

  return [...turns]
    .sort(
      (a, b) => {
        const keyA =
          khaledTurnKey(a)

        const keyB =
          khaledTurnKey(b)

        const historyA =
          heuristics
            ?.history
            ?.get(
              `${color}|${keyA}`
            ) || 0

        const historyB =
          heuristics
            ?.history
            ?.get(
              `${color}|${keyB}`
            ) || 0

        const killerA =
          killers[0] === keyA
            ? 9000
            : killers[1] === keyA
              ? 4500
              : 0

        const killerB =
          killers[0] === keyB
            ? 9000
            : killers[1] === keyB
              ? 4500
              : 0

        const scoreA =
          khaledTurnOrderScore(
            board,
            a,
            color
          ) +
          killerA +
          historyA

        const scoreB =
          khaledTurnOrderScore(
            board,
            b,
            color
          ) +
          killerB +
          historyB

        return scoreB - scoreA
      }
    )
}


function recordKhaledCutoff(
  heuristics,
  ply,
  color,
  turn,
  depth
) {
  if (!heuristics) return

  const key =
    khaledTurnKey(turn)

  const killers =
    heuristics.killers.get(ply) || []

  if (killers[0] !== key) {
    heuristics.killers.set(
      ply,
      [
        key,
        killers[0]
      ].filter(Boolean)
    )
  }

  const historyKey =
    `${color}|${key}`

  const oldValue =
    heuristics.history.get(
      historyKey
    ) || 0

  heuristics.history.set(
    historyKey,
    Math.min(
      12000,
      oldValue +
        Math.max(
          1,
          depth * depth
        )
    )
  )
}


function khaledMinimax(
  board,
  depth,
  color,
  alpha,
  beta,
  deadline,
  table,
  heuristics,
  ply
) {
  if (
    performance.now() >=
    deadline
  ) {
    return {
      score: 0,
      timeout: true
    }
  }

  const blackCount =
    countHardColor(
      board,
      'black'
    )

  const creamCount =
    countHardColor(
      board,
      'cream'
    )

  if (blackCount === 0) {
    return {
      score:
        -10000000 +
        ply,
      timeout: false
    }
  }

  if (creamCount === 0) {
    return {
      score:
        10000000 -
        ply,
      timeout: false
    }
  }

  const turns =
    getHardTurns(
      board,
      color
    )

  if (turns.length === 0) {
    return {
      score:
        color === 'black'
          ? (
            -9000000 +
            ply
          )
          : (
            9000000 -
            ply
          ),
      timeout: false
    }
  }

  // Quiescence:
  // عند نهاية العمق لا نوقف التقييم وسط سلسلة أكل إجبارية.
  if (depth <= 0) {
    const hasCapture =
      turns.some(
        turn =>
          turn
            .steps
            .some(
              step =>
                step.capture
            )
      )

    if (hasCapture) {
      return khaledQuiescence(
        board,
        color,
        alpha,
        beta,
        deadline,
        ply,
        15
      )
    }

    return {
      score:
        evaluateKhaledBoard(
          board
        ),
      timeout: false
    }
  }

  const key =
    `${hardBoardKey(board)}|${color}|${ply}`

  const cached =
    table.get(key)

  if (
    cached &&
    cached.depth >= depth
  ) {
    return {
      score:
        cached.score,
      timeout: false
    }
  }

  const ordered =
    orderKhaledSearchTurns(
      board,
      turns,
      color,
      heuristics,
      ply
    )

  let best =
    color === 'black'
      ? -Infinity
      : Infinity

  let cutOff = false

  for (
    const turn of ordered
  ) {
    if (
      performance.now() >=
      deadline
    ) {
      return {
        score: 0,
        timeout: true
      }
    }

    const nextBoard =
      applyHardTurn(
        board,
        turn
      )

    const result =
      khaledMinimax(
        nextBoard,
        depth - 1,
        color === 'black'
          ? 'cream'
          : 'black',
        alpha,
        beta,
        deadline,
        table,
        heuristics,
        ply + 1
      )

    if (result.timeout) {
      return result
    }

    if (color === 'black') {
      best =
        Math.max(
          best,
          result.score
        )

      alpha =
        Math.max(
          alpha,
          best
        )
    }
    else {
      best =
        Math.min(
          best,
          result.score
        )

      beta =
        Math.min(
          beta,
          best
        )
    }

    if (beta <= alpha) {
      cutOff = true

      recordKhaledCutoff(
        heuristics,
        ply,
        color,
        turn,
        depth
      )

      break
    }
  }

  if (!cutOff) {
    table.set(
      key,
      {
        depth,
        score: best
      }
    )
  }

  return {
    score: best,
    timeout: false
  }
}


function khaledQuiescence(
  board,
  color,
  alpha,
  beta,
  deadline,
  ply,
  qDepth
) {
  if (
    performance.now() >=
    deadline
  ) {
    return {
      score: 0,
      timeout: true
    }
  }

  const standPat =
    evaluateKhaledBoard(
      board
    )

  if (qDepth <= 0) {
    return {
      score: standPat,
      timeout: false
    }
  }

  const turns =
    getHardTurns(
      board,
      color
    )

  const captureTurns =
    turns.filter(
      turn =>
        turn
          .steps
          .some(
            step =>
              step.capture
          )
    )

  if (
    captureTurns.length === 0
  ) {
    return {
      score: standPat,
      timeout: false
    }
  }

  const ordered =
    orderKhaledTurns(
      board,
      captureTurns,
      color
    )

  let best =
    color === 'black'
      ? -Infinity
      : Infinity

  for (
    const turn of ordered
  ) {
    const nextBoard =
      applyHardTurn(
        board,
        turn
      )

    const result =
      khaledQuiescence(
        nextBoard,
        color === 'black'
          ? 'cream'
          : 'black',
        alpha,
        beta,
        deadline,
        ply + 1,
        qDepth - 1
      )

    if (result.timeout) {
      return result
    }

    if (color === 'black') {
      best =
        Math.max(
          best,
          result.score
        )

      alpha =
        Math.max(
          alpha,
          best
        )
    }
    else {
      best =
        Math.min(
          best,
          result.score
        )

      beta =
        Math.min(
          beta,
          best
        )
    }

    if (beta <= alpha) {
      break
    }
  }

  return {
    score:
      Number.isFinite(best)
        ? best
        : standPat,
    timeout: false
  }
}

function evaluateKhaledBoard(board) {
  let score = 0

  let blackMen = 0
  let creamMen = 0
  let blackKings = 0
  let creamKings = 0

  for (
    let row = 0;
    row < 8;
    row++
  ) {
    for (
      let col = 0;
      col < 8;
      col++
    ) {
      const piece =
        board[row][col]

      if (!piece) {
        continue
      }

      let value =
        piece.king
          ? 315
          : 116

      if (piece.king) {
        if (
          piece.color ===
          'black'
        ) {
          blackKings++
        }
        else {
          creamKings++
        }

        // الملك في الوسط مفيد، لكن خالد لا يضحي به لأجل وسط الرقعة.
        if (
          row >= 2 &&
          row <= 5 &&
          col >= 2 &&
          col <= 5
        ) {
          value += 13
        }
      }
      else {
        const progress =
          piece.color ===
          'black'
            ? row
            : 7 - row

        // تقدم محسوب، بدون اندفاع مبالغ فيه.
        value +=
          progress * 7

        if (progress === 6) {
          value += 70
        }
        else if (
          progress === 5
        ) {
          value += 30
        }

        if (
          piece.color ===
          'black'
        ) {
          blackMen++
        }
        else {
          creamMen++
        }
      }

      // الحافة أكثر أمانًا للحجر العادي.
      if (
        col === 0 ||
        col === 7
      ) {
        value +=
          piece.king
            ? 3
            : 11
      }

      // سيطرة هادئة على الوسط.
      if (
        row >= 2 &&
        row <= 5 &&
        col >= 2 &&
        col <= 5
      ) {
        value +=
          piece.king
            ? 9
            : 5
      }

      if (
        piece.color ===
        'black'
      ) {
        score += value
      }
      else {
        score -= value
      }
    }
  }

  // المادة والملوك أهم من أي مكسب شكلي.
  score +=
    (blackKings -
      creamKings) *
    78

  score +=
    (blackMen -
      creamMen) *
    9

  // الدفاع أولًا: خسارة حجر مهدد عقوبة كبيرة جدًا.
  const blackThreatened =
    countHardThreatened(
      board,
      'black'
    )

  const creamThreatened =
    countHardThreatened(
      board,
      'cream'
    )

  score -=
    blackThreatened *
    142

  score +=
    creamThreatened *
    98

  // تماسك القطع ودعم بعضها.
  score +=
    (
      countSupportedPieces(
        board,
        'black'
      ) -
      countSupportedPieces(
        board,
        'cream'
      )
    ) *
    18

  // خالد يحب إبقاء حارس خلفي ويمنع الترقية السهلة.
  score +=
    countHomeGuard(
      board,
      'black'
    ) *
    25

  score -=
    countHomeGuard(
      board,
      'cream'
    ) *
    14

  // خنق حركة الخصم = سحب تدريجي إلى الفخ.
  const blackMobility =
    countLocalMobility(
      board,
      'black'
    )

  const creamMobility =
    countLocalMobility(
      board,
      'cream'
    )

  score +=
    (blackMobility -
      creamMobility) *
    3

  score +=
    countTrappedPieces(
      board,
      'cream'
    ) *
    21

  score -=
    countTrappedPieces(
      board,
      'black'
    ) *
    38

  // فرص الترقية المحمية.
  score +=
    countSafePromotionThreats(
      board,
      'black'
    ) *
    44

  score -=
    countSafePromotionThreats(
      board,
      'cream'
    ) *
    68

  // ضغط الأكل المباشر: خالد ينتبه للتكتيك، لكن دفاعه يظل الأولوية.
  const blackCapturePressure =
    countCaptureOptions(
      board,
      'black'
    )

  const creamCapturePressure =
    countCaptureOptions(
      board,
      'cream'
    )

  score +=
    blackCapturePressure * 26

  score -=
    creamCapturePressure * 36

  // في النهايات تصبح حرية الحركة أهم بكثير.
  const totalPieces =
    blackMen +
    creamMen +
    blackKings +
    creamKings

  if (totalPieces <= 10) {
    score +=
      (blackMobility -
        creamMobility) * 4
  }

  return score
}


function countCaptureOptions(
  board,
  color
) {
  let total = 0

  for (
    let row = 0;
    row < 8;
    row++
  ) {
    for (
      let col = 0;
      col < 8;
      col++
    ) {
      const piece =
        board[row][col]

      if (
        !piece ||
        piece.color !== color
      ) {
        continue
      }

      total +=
        getAICaptures(
          board,
          row,
          col
        ).length
    }
  }

  return total
}


function countSupportedPieces(
  board,
  color
) {
  let count = 0

  const directions = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ]

  for (
    let row = 0;
    row < 8;
    row++
  ) {
    for (
      let col = 0;
      col < 8;
      col++
    ) {
      const piece =
        board[row][col]

      if (
        !piece ||
        piece.color !== color
      ) {
        continue
      }

      let supported = false

      for (
        const [dr, dc]
        of directions
      ) {
        const nr =
          row + dr
        const nc =
          col + dc

        if (
          !isInsideBoard(
            nr,
            nc
          )
        ) {
          continue
        }

        const neighbor =
          board[nr][nc]

        if (
          neighbor &&
          neighbor.color === color
        ) {
          supported = true
          break
        }
      }

      if (supported) {
        count++
      }
    }
  }

  return count
}


function countHomeGuard(
  board,
  color
) {
  const row =
    color === 'black'
      ? 0
      : 7

  let count = 0

  for (
    let col = 0;
    col < 8;
    col++
  ) {
    const piece =
      board[row][col]

    if (
      piece &&
      piece.color === color &&
      !piece.king
    ) {
      count++
    }
  }

  return Math.min(
    count,
    3
  )
}


function countLocalMobility(
  board,
  color
) {
  let total = 0

  for (
    let row = 0;
    row < 8;
    row++
  ) {
    for (
      let col = 0;
      col < 8;
      col++
    ) {
      const piece =
        board[row][col]

      if (
        !piece ||
        piece.color !== color
      ) {
        continue
      }

      const captures =
        getAICaptures(
          board,
          row,
          col
        )

      if (
        captures.length > 0
      ) {
        total +=
          captures.length * 3

        continue
      }

      total +=
        getAINormalMoves(
          board,
          row,
          col
        ).length
    }
  }

  return total
}


function countTrappedPieces(
  board,
  color
) {
  let trapped = 0

  for (
    let row = 0;
    row < 8;
    row++
  ) {
    for (
      let col = 0;
      col < 8;
      col++
    ) {
      const piece =
        board[row][col]

      if (
        !piece ||
        piece.color !== color
      ) {
        continue
      }

      if (
        getAICaptures(
          board,
          row,
          col
        ).length > 0
      ) {
        continue
      }

      if (
        getAINormalMoves(
          board,
          row,
          col
        ).length === 0
      ) {
        trapped++
      }
    }
  }

  return trapped
}


function countSafePromotionThreats(
  board,
  color
) {
  let count = 0

  for (
    let row = 0;
    row < 8;
    row++
  ) {
    for (
      let col = 0;
      col < 8;
      col++
    ) {
      const piece =
        board[row][col]

      if (
        !piece ||
        piece.color !== color ||
        piece.king
      ) {
        continue
      }

      const promotionDistance =
        color === 'black'
          ? 7 - row
          : row

      if (
        promotionDistance > 2
      ) {
        continue
      }

      const threatened =
        isSquareThreatenedForColor(
          board,
          row,
          col,
          color
        )

      if (!threatened) {
        count++
      }
    }
  }

  return count
}


function isSquareThreatenedForColor(
  board,
  row,
  col,
  color
) {
  const enemy =
    color === 'black'
      ? 'cream'
      : 'black'

  for (
    let er = 0;
    er < 8;
    er++
  ) {
    for (
      let ec = 0;
      ec < 8;
      ec++
    ) {
      const piece =
        board[er][ec]

      if (
        !piece ||
        piece.color !== enemy
      ) {
        continue
      }

      const captures =
        getAICaptures(
          board,
          er,
          ec
        )

      if (
        captures.some(
          move =>
            move.capturedRow ===
              row &&
            move.capturedCol ===
              col
        )
      ) {
        return true
      }
    }
  }

  return false
}

function khaledTurnKey(turn) {
  return turn.steps
    .map(step =>
      `${step.fromRow},${step.fromCol}>${step.row},${step.col}:${step.capture ? 1 : 0}`
    )
    .join('|')
}

function getHardTurns(board, color) {
  const captureTurns = []

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col]

      if (!piece || piece.color !== color) continue

      const captures = getAICaptures(board, row, col)

      for (const capture of captures) {
        const captureWithState = {
          ...capture,
          wasKingBefore: piece.king
        }

        const nextBoard = applyAIMove(board, captureWithState)

        buildHardCaptureTurns(
          nextBoard,
          capture.row,
          capture.col,
          [captureWithState],
          captureTurns
        )
      }
    }
  }

  if (captureTurns.length > 0) return captureTurns

  const turns = []

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col]

      if (!piece || piece.color !== color) continue

      const normalMoves = getAINormalMoves(board, row, col)

      for (const move of normalMoves) {
        turns.push({ steps: [move] })
      }
    }
  }

  return turns
}

function buildHardCaptureTurns(board, row, col, steps, result) {
  const piece = board[row][col]

  if (!piece) {
    result.push({ steps })
    return
  }

  const lastMove = steps[steps.length - 1]

  // حجر عادي أصبح ملكًا = ينتهي الدور فورًا
  if (
    lastMove &&
    piece.king &&
    lastMove.wasKingBefore === false
  ) {
    result.push({ steps })
    return
  }

  const more = getAICaptures(board, row, col)

  if (more.length === 0) {
    result.push({ steps })
    return
  }

  for (const move of more) {
    const movingPiece = board[row][col]

    const moveWithState = {
      ...move,
      wasKingBefore: movingPiece ? movingPiece.king : false
    }

    const nextBoard = applyAIMove(board, moveWithState)

    buildHardCaptureTurns(
      nextBoard,
      move.row,
      move.col,
      [...steps, moveWithState],
      result
    )
  }
}

function applyHardTurn(board, turn) {
  let next = copyAIBoard(board)

  for (const step of turn.steps) {
    next = applyAIMove(next, step)
  }

  return next
}

function orderKhaledTurns(
  board,
  turns,
  color
) {
  return [...turns].sort(
    (a, b) =>
      khaledTurnOrderScore(
        board,
        b,
        color
      ) -
      khaledTurnOrderScore(
        board,
        a,
        color
      )
  )
}


function khaledTurnOrderScore(
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
    board
      [first.fromRow]
      [first.fromCol]

  let score =
    turn.steps.length *
    170

  const captures =
    turn.steps.filter(
      step =>
        step.capture
    ).length

  score +=
    captures * 260

  if (
    piece &&
    !piece.king
  ) {
    if (
      color === 'black' &&
      last.row === 7
    ) {
      score += 420
    }

    if (
      color === 'cream' &&
      last.row === 0
    ) {
      score += 420
    }
  }

  const nextBoard =
    applyHardTurn(
      board,
      turn
    )

  const ownThreatened =
    countHardThreatened(
      nextBoard,
      color
    )

  score -=
    ownThreatened *
    115

  const enemy =
    color === 'black'
      ? 'cream'
      : 'black'

  score +=
    countHardThreatened(
      nextBoard,
      enemy
    ) *
    78

  if (
    last.col === 0 ||
    last.col === 7
  ) {
    score += 10
  }

  if (
    last.row >= 2 &&
    last.row <= 5 &&
    last.col >= 2 &&
    last.col <= 5
  ) {
    score += 8
  }

  return score
}


function khaledTieBreaker(
  board,
  turn
) {
  const nextBoard =
    applyHardTurn(
      board,
      turn
    )

  const threatened =
    countHardThreatened(
      nextBoard,
      'black'
    )

  const supported =
    countSupportedPieces(
      nextBoard,
      'black'
    )

  return (
    supported * 9 -
    threatened * 17 +
    turn.steps.length * 4
  )
}


function orderHardTurns(board, turns, color) {
  return [...turns].sort(
    (a, b) =>
      hardTurnOrderScore(board, b, color) -
      hardTurnOrderScore(board, a, color)
  )
}

function hardTurnOrderScore(board, turn, color) {
  const first = turn.steps[0]
  const last = turn.steps[turn.steps.length - 1]
  const piece = board[first.fromRow][first.fromCol]

  let score = turn.steps.length * 120

  if (piece && !piece.king) {
    if (color === 'black' && last.row === 7) score += 220
    if (color === 'cream' && last.row === 0) score += 220
  }

  if (
    last.row >= 2 && last.row <= 5 &&
    last.col >= 2 && last.col <= 5
  ) {
    score += 15
  }

  // لا نستدعي getHardTurns هنا حتى لا ندخل في recursion
  // أثناء ترتيب الحركات.
  return score
}

function evaluateHardBoard(board) {
  let score = 0
  let blackKings = 0
  let creamKings = 0

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col]
      if (!piece) continue

      let value = piece.king ? 210 : 100

      if (piece.king) {
        if (piece.color === 'black') blackKings++
        else creamKings++
      } else {
        const progress =
          piece.color === 'black'
            ? row
            : 7 - row

        value += progress * 8

        if (progress === 6) value += 28
      }

      if (
        row >= 2 && row <= 5 &&
        col >= 2 && col <= 5
      ) {
        value += 12
      }

      if (col === 0 || col === 7) value += 5

      if (piece.color === 'black') score += value
      else score -= value
    }
  }

  score += (blackKings - creamKings) * 20

  // تقييم التهديدات المباشرة بدون توليد أدوار كامل داخل التقييم
  score -= countDirectThreatened(board, 'black') * 24
  score += countDirectThreatened(board, 'cream') * 20

  return score
}

function countDirectThreatened(board, color) {
  const enemy = color === 'black' ? 'cream' : 'black'
  const threatened = new Set()

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col]
      if (!piece || piece.color !== enemy) continue

      for (const move of getAICaptures(board, row, col)) {
        const victim = board[move.capturedRow]?.[move.capturedCol]

        if (victim && victim.color === color) {
          threatened.add(`${move.capturedRow},${move.capturedCol}`)
        }
      }
    }
  }

  return threatened.size
}

function countHardThreatened(board, color) {
  return countDirectThreatened(board, color)
}

function hardBoardKey(board) {
  let key = ''

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col]

      if (!piece) key += '.'
      else if (piece.color === 'black') key += piece.king ? 'B' : 'b'
      else key += piece.king ? 'C' : 'c'
    }
  }

  return key
}

function countHardPieces(board) {
  return (
    countHardColor(board, 'black') +
    countHardColor(board, 'cream')
  )
}

function countHardColor(board, color) {
  let count = 0

  for (const row of board) {
    for (const piece of row) {
      if (piece && piece.color === color) count++
    }
  }

  return count
}

function hardTieBreaker(turn) {
  const last = turn.steps[turn.steps.length - 1]

  return (
    (
      last.row * 8 +
      last.col +
      turn.steps.length * 3
    ) % 17
  )
}

function copyAIBoard(board) {
  return board.map(
    row => row.map(
      piece => piece ? { ...piece } : null
    )
  )
}

function isInsideBoard(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8
}

function getAINormalMoves(board, row, col) {
  const piece = board[row][col]
  if (!piece) return []

  const moves = []

  if (piece.king) {
    const directions = [
      [-1, -1], [-1, 1], [1, -1], [1, 1]
    ]

    for (const [dr, dc] of directions) {
      let newRow = row + dr
      let newCol = col + dc

      while (isInsideBoard(newRow, newCol)) {
        if (board[newRow][newCol]) break

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

  const directions =
    piece.color === 'cream'
      ? [[-1, -1], [-1, 1]]
      : [[1, -1], [1, 1]]

  for (const [dr, dc] of directions) {
    const newRow = row + dr
    const newCol = col + dc

    if (!isInsideBoard(newRow, newCol)) continue
    if (board[newRow][newCol]) continue

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

function getAICaptures(board, row, col) {
  const piece = board[row][col]
  if (!piece) return []

  const captures = []

  if (piece.king) {
    const directions = [
      [-1, -1], [-1, 1], [1, -1], [1, 1]
    ]

    for (const [dr, dc] of directions) {
      let checkRow = row + dr
      let checkCol = col + dc

      while (isInsideBoard(checkRow, checkCol)) {
        const target = board[checkRow][checkCol]

        if (!target) {
          checkRow += dr
          checkCol += dc
          continue
        }

        if (target.color === piece.color) break

        const landingRow = checkRow + dr
        const landingCol = checkCol + dc

        if (!isInsideBoard(landingRow, landingCol)) break
        if (board[landingRow][landingCol]) break

        captures.push({
          fromRow: row,
          fromCol: col,
          row: landingRow,
          col: landingCol,
          capture: true,
          capturedRow: checkRow,
          capturedCol: checkCol
        })

        break
      }
    }

    return captures
  }

  const directions =
    piece.color === 'cream'
      ? [[-1, -1], [-1, 1]]
      : [[1, -1], [1, 1]]

  for (const [dr, dc] of directions) {
    const enemyRow = row + dr
    const enemyCol = col + dc
    const landingRow = row + dr * 2
    const landingCol = col + dc * 2

    if (
      !isInsideBoard(enemyRow, enemyCol) ||
      !isInsideBoard(landingRow, landingCol)
    ) continue

    const enemy = board[enemyRow][enemyCol]

    if (!enemy) continue
    if (enemy.color === piece.color) continue
    if (board[landingRow][landingCol]) continue

    captures.push({
      fromRow: row,
      fromCol: col,
      row: landingRow,
      col: landingCol,
      capture: true,
      capturedRow: enemyRow,
      capturedCol: enemyCol
    })
  }

  return captures
}

function applyAIMove(board, move) {
  const newBoard = copyAIBoard(board)
  const piece = newBoard[move.fromRow][move.fromCol]

  if (!piece) return newBoard

  newBoard[move.fromRow][move.fromCol] = null

  if (move.capture) {
    newBoard[move.capturedRow][move.capturedCol] = null
  }

  const movedPiece = { ...piece }

  if (
    movedPiece.color === 'cream' &&
    !movedPiece.king &&
    move.row === 0
  ) {
    movedPiece.king = true
  }

  if (
    movedPiece.color === 'black' &&
    !movedPiece.king &&
    move.row === 7
  ) {
    movedPiece.king = true
  }

  newBoard[move.row][move.col] = movedPiece

  return newBoard
}
