import './style.css'
import { io } from 'socket.io-client'
import { supabase } from './supabase.js'

const AUDIO_SOURCES = {
  move: '/move.wav',
  win: '/win.wav',
  lose: '/lose.wav',
  king: '/king.wav'
}

function createGameAudio(src, volume) {
  const audio = new Audio(src)
  audio.preload = 'auto'
  audio.playsInline = true
  audio.volume = volume

  try {
    audio.load()
  }
  catch (error) {
    // Audio preload may be unavailable before user interaction.
  }

  return audio
}

// Reuse audio elements to keep move playback responsive on mobile.
const moveSoundPool =
  Array.from(
    { length: 4 },
    () =>
      createGameAudio(
        AUDIO_SOURCES.move,
        0.6
      )
  )

const winSound =
  createGameAudio(
    AUDIO_SOURCES.win,
    0.7
  )

const loseSound =
  createGameAudio(
    AUDIO_SOURCES.lose,
    0.7
  )

const kingSound =
  createGameAudio(
    AUDIO_SOURCES.king,
    0.72
  )

let moveSoundIndex = 0
let audioPrimed = false

function primeGameAudio() {
  if (audioPrimed) return
  audioPrimed = true

  const sounds = [
    ...moveSoundPool,
    winSound,
    loseSound,
    kingSound
  ]

  sounds.forEach(audio => {
    const originalVolume =
      audio.volume

    try {
      audio.volume = 0
      audio.currentTime = 0

      const playPromise =
        audio.play()

      if (
        playPromise &&
        typeof playPromise.then === 'function'
      ) {
        playPromise
          .then(() => {
            audio.pause()
            audio.currentTime = 0
            audio.volume = originalVolume
          })
          .catch(() => {
            audio.volume = originalVolume
          })
      }
      else {
        audio.pause()
        audio.currentTime = 0
        audio.volume = originalVolume
      }
    }
    catch (error) {
      audio.volume = originalVolume
    }
  })
}

// أول لمسة تجهز الأصوات داخل قيود تشغيل الصوت في الجوال.
document.addEventListener(
  'pointerdown',
  primeGameAudio,
  {
    once: true,
    capture: true
  }
)

document.addEventListener(
  'touchstart',
  primeGameAudio,
  {
    once: true,
    capture: true,
    passive: true
  }
)

function playAudioNow(audio) {
  try {
    audio.pause()
    audio.currentTime = 0

    audio
      .play()
      .catch(() => {})
  }

  catch (error) {
    // الصوت تحسين إضافي ولا نوقف اللعب لو المتصفح رفضه
  }
}

function playResultSound(playerWon) {
  playAudioNow(
    playerWon
      ? winSound
      : loseSound
  )
}

function playKingSound() {
  playAudioNow(kingSound)
}

function playMoveSound() {
  const sound =
    moveSoundPool[moveSoundIndex]

  moveSoundIndex =
    (moveSoundIndex + 1) %
    moveSoundPool.length

  playAudioNow(sound)
}

// ========================================
// حالة اللعبة
// ========================================
// ========================================
// 🌐 اللعب أونلاين
// ========================================

const ONLINE_SERVER_URL =
  `${window.location.protocol}//${window.location.hostname}:3001`

const socket = io(ONLINE_SERVER_URL, { autoConnect:true, reconnection:true, reconnectionAttempts:Infinity });

let onlineRoomCode = null
let onlinePlayerColor = null
let onlineMode = false
let onlineOpponentConnected = false
let onlineOpponentRating = null
let onlineOpponentName = 'صديقك'
let enableClock = false;
let onlineRoomSettings = {
  
  
  mode: 'no-time',
  minutes: null
  
}

let onlineClocks = {
  cream: 0,
  black: 0,
  turn: null

}

socket.on('clock-update', data => {
  onlineClocks = data
  renderOnlineClocks()
})

socket.on('time-ended', (data) => {
  if (!onlineMode || gameOver) return

  const won = data.winner === onlinePlayerColor
  finishGame(won ? 'فزت! انتهى وقت الخصم ⏱️' : 'خسرت! انتهى وقتك ⏱️')
})

function formatClock(seconds) {
  seconds = Math.max(0, Math.ceil(Number(seconds) || 0))
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' +
    String(seconds % 60).padStart(2, '0')
}

function renderOnlineClocks() {
  const timedOnlineGame =
    onlineMode &&
    onlineOpponentConnected &&
    onlineRoomSettings?.mode === 'time'

  const creamClock = document.querySelector('#creamClock')
  const blackClock = document.querySelector('#blackClock')

  if (creamClock) {
    creamClock.textContent = formatClock(onlineClocks.cream)
    creamClock.hidden = !timedOnlineGame
  }

  if (blackClock) {
    blackClock.textContent = formatClock(onlineClocks.black)
    blackClock.hidden = !timedOnlineGame
  }
}

socket.on('player-joined', (data) => {

  if (!onlineMode) return

  onlineOpponentConnected = true
  onlineOpponentName = data?.playerName || 'صديقك'
  const opponentNameLabel =
    document.querySelector('#onlineOpponentName')

  if (opponentNameLabel) {
    opponentNameLabel.textContent = onlineOpponentName
  }

  renderOnlineClocks()
  updateOnlineTurnUI()

  if (
    document.querySelector(
      '#matchTimer'
    )
  ) {
    resetMatchTimer()
  }
})

socket.on('game-move', (move) => {
  if (!onlineMode) return

  applyRemoteOnlineMove(move)
  document.querySelectorAll('.selected-piece')
.forEach(p => p.classList.remove('selected-piece'));
})

// إظهار القطعة المحددة عند الطرف الآخر أونلاين
socket.on('piece-selected', (data) => {
  if (!onlineMode) return

  // حذف أي تحديد أونلاين قديم
  document.querySelectorAll('.selected-piece')
.forEach(p => p.classList.remove('selected-piece'))

  const piece = getPieceAt(data.row, data.col)

  if (piece) {
    piece.classList.add('selected-piece')
}

})

socket.on('restart-game', () => {
  if (!onlineMode) return

  document
    .querySelector('.game-result-overlay')
    ?.remove()

  onlineOpponentConnected = true
  startOnlineGame()
})

socket.on('player-left', () => {
  if (!onlineMode) return

  onlineOpponentConnected = false

  if (!gameOver) {
    finishGame(
      'فزت! خصمك انسحب من المباراة 👑'
    )
  }
})

socket.on('connect_error', (error) => {
  console.error(
    'تعذر الاتصال بسيرفر الأونلاين:',
    error
  )

  if (onlineMode && !gameOver) {
    setTurnText(
      'تعذر الاتصال بالسيرفر'
    )
  }
})

let selectedPiece = null
let currentLevel = null

let currentAuthUser = null
async function loadCloudProfile(user) {

  const { data, error } =
    await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle()

  if (error) {
    console.error(
      'خطأ في تحميل الإحصائيات:',
      error
    )

    return
  }

  // حساب جديد
  if (!data) {

    const freshProfile =
      createDefaultProfile()

    freshProfile.name =
      user.user_metadata?.name ||
      'لاعب'

    const { error: insertError } =
      await supabase
        .from('profiles')
        .insert({
          id: user.id,
          name: freshProfile.name,
          games: 0,
          wins: 0,
          losses: 0,
          total_moves: 0,
          levels: freshProfile.levels,
          history: []
        })

    if (insertError) {
      console.error(
        'خطأ في إنشاء ملف اللاعب:',
        insertError
      )

      return
    }

    playerProfile = freshProfile

    updateProfileUI()

    return
  }

  // حساب موجود
  const defaults =
    createDefaultProfile()

  playerProfile = {
    ...defaults,

    name:
      data.name || 'لاعب',

    games:
      data.games || 0,

    wins:
      data.wins || 0,

    losses:
      data.losses || 0,

    totalMoves:
      data.total_moves || 0,

    levels: {
      ...defaults.levels,
      ...(data.levels || {}),

      progress: {
        rating:
          normalizeRating(
            data
              .levels
              ?.progress
              ?.rating
          )
      }
    },

    history:
      Array.isArray(data.history)
        ? data.history
        : []
  }

  if (
    data
      .levels
      ?.progress
      ?.rating == null
  ) {
    await saveCloudProfile()
  }

  updateProfileUI()
}
async function saveCloudProfile() {

  if (!currentAuthUser) {
    return
  }

  const { error } =
    await supabase
      .from('profiles')
      .upsert({
        id: currentAuthUser.id,

        name:
          playerProfile.name,

        games:
          playerProfile.games,

        wins:
          playerProfile.wins,

        losses:
          playerProfile.losses,

        total_moves:
          playerProfile.totalMoves,

        levels:
          playerProfile.levels,

        history:
          playerProfile.history,

        updated_at:
          new Date().toISOString()
      })

  if (error) {
    console.error(
      'خطأ في حفظ الإحصائيات:',
      error
    )
  }
}
let currentTurn = 'cream'
let mustContinueCapture = false
let gameOver = false
// ========================================
// ☠️ Worker مستوى أتحداك تفوز
// ========================================

let impossibleWorker = null
let impossibleThinkTimer = null

// ========================================
// 🛡️ Worker مستوى خالد
// ========================================

let khaledWorker = null
let khaledMoveDelayTimer = null
const KHALED_MIN_THINK_MS = 2000

// ========================================
// ⏱️ مؤقت المباراة
// ========================================

let matchTimerInterval = null
let matchTimerStartedAt = 0
let matchTimerElapsedMs = 0

function formatMatchTime(totalMs) {
  const totalSeconds =
    Math.max(
      0,
      Math.floor(
        Number(totalMs || 0) / 1000
      )
    )

  const hours =
    Math.floor(
      totalSeconds / 3600
    )

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    )

  const seconds =
    totalSeconds % 60

  const pad =
    value =>
      String(value).padStart(2, '0')

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  }

  return `${pad(minutes)}:${pad(seconds)}`
}

function renderMatchTimer() {
  const element =
    document.querySelector(
      '#matchTimer'
    )

  if (!element) return

  const elapsed =
    matchTimerStartedAt
      ? (
        matchTimerElapsedMs +
        (
          performance.now() -
          matchTimerStartedAt
        )
      )
      : matchTimerElapsedMs

  element.textContent =
    formatMatchTime(elapsed)
}

function stopMatchTimer(
  preserveElapsed = true
) {
  if (
    preserveElapsed &&
    matchTimerStartedAt
  ) {
    matchTimerElapsedMs +=
      performance.now() -
      matchTimerStartedAt
  }

  matchTimerStartedAt = 0

  if (matchTimerInterval) {
    clearInterval(
      matchTimerInterval
    )

    matchTimerInterval = null
  }

  renderMatchTimer()
}

function resetMatchTimer() {
  stopMatchTimer(false)

  matchTimerElapsedMs = 0
  matchTimerStartedAt = 0

  renderMatchTimer()
}

function startMatchTimer() {
  stopMatchTimer(true)

  matchTimerStartedAt =
    performance.now()

  renderMatchTimer()

  matchTimerInterval =
    setInterval(
      renderMatchTimer,
      1000
    )
}

// ========================================
// 👤 الملف الشخصي والإحصائيات
// ========================================

const PROFILE_KEY = 'damagame_profile_v1'

let currentGameMoves = 0
let currentGameRecorded = false
let pendingProfileSave =
  Promise.resolve()

// ========================================
// ♛ نظام التصنيف بالنقاط - أونلاين فقط
// ========================================

const RATING_START = 400
const RATING_MIN = 400
const RATING_MAX = 3000
const RATING_K = 24

const RATING_TIERS = [
  {
    key: 'beginner',
    label: 'مبتدئ',
    min: 0,
    max: 599
  },
  {
    key: 'rising',
    label: 'مبتدئ متقدم',
    min: 600,
    max: 899
  },
  {
    key: 'intermediate',
    label: 'متوسط',
    min: 900,
    max: 1299
  },
  {
    key: 'advanced',
    label: 'متقدم',
    min: 1300,
    max: 1699
  },
  {
    key: 'expert',
    label: 'خبير',
    min: 1700,
    max: 2099
  },
  {
    key: 'grandmaster',
    label: 'جراند ماستر',
    min: 2100,
    max: 3000
  }
]

let lastRatingChange = 0
let lastRatingBefore = RATING_START
let lastRatingAfter = RATING_START

function normalizeRating(value) {
  const number = Number(value)

  if (!Number.isFinite(number)) {
    return RATING_START
  }

  return Math.max(
    RATING_MIN,
    Math.min(
      RATING_MAX,
      Math.round(number)
    )
  )
}

function getRatingTier(rating) {
  const safeRating =
    normalizeRating(rating)

  return (
    RATING_TIERS.find(
      tier =>
        safeRating >= tier.min &&
        safeRating <= tier.max
    ) ||
    RATING_TIERS[0]
  )
}

function getPlayerRating(
  profile = playerProfile
) {
  return normalizeRating(
    profile
      ?.levels
      ?.progress
      ?.rating
  )
}

function getPlayerRatingState(
  profile = playerProfile
) {
  const rating =
    getPlayerRating(profile)

  const tier =
    getRatingTier(rating)

  const tierIndex =
    RATING_TIERS.findIndex(
      item => item.key === tier.key
    )

  const nextTier =
    tierIndex >= 0 &&
    tierIndex < RATING_TIERS.length - 1
      ? RATING_TIERS[tierIndex + 1]
      : null

  const nextRating =
    nextTier
      ? nextTier.min
      : RATING_MAX

  let percent = 100

  if (nextTier) {
    const range =
      nextRating - tier.min

    percent =
      range > 0
        ? Math.round(
            (
              (rating - tier.min) /
              range
            ) * 100
          )
        : 100
  }

  else if (RATING_MAX > tier.min) {
    percent = Math.round(
      (
        (rating - tier.min) /
        (RATING_MAX - tier.min)
      ) * 100
    )
  }

  return {
    rating,
    tier,
    nextTier,
    nextRating,
    percent:
      Math.max(
        0,
        Math.min(100, percent)
      )
  }
}

function setPlayerRating(value) {
  if (!playerProfile.levels.progress) {
    playerProfile.levels.progress = {
      rating: RATING_START
    }
  }

  playerProfile
    .levels
    .progress
    .rating =
      normalizeRating(value)
}

function getOnlinePerformanceSnapshot() {
  const playerColor = onlinePlayerColor || 'cream'
  const creamCount = document.querySelectorAll('.checker-piece[data-color="cream"]').length
  const blackCount = document.querySelectorAll('.checker-piece[data-color="black"]').length
  const playerCount = playerColor === 'cream' ? creamCount : blackCount
  const opponentCount = playerColor === 'cream' ? blackCount : creamCount
  const capturedDifference = Math.max(0, playerCount - opponentCount)
  const margin = Math.abs(playerCount - opponentCount)
  const elapsedMs = matchTimerStartedAt
    ? matchTimerElapsedMs + (performance.now() - matchTimerStartedAt)
    : matchTimerElapsedMs
  const fastWin = elapsedMs < 180000

  return {
    moves: currentGameMoves,
    pieceAdvantage: capturedDifference,
    margin,
    fastWin
  }
}

function calculateRatingResult(
  playerWon,
  opponentRating = onlineOpponentRating,
  performance = {}
) {
  const playerRating = getPlayerRating()
  const safeOpponentRating = normalizeRating(
    opponentRating == null ? playerRating : opponentRating
  )

  const expected =
    1 /
    (1 + Math.pow(10, (safeOpponentRating - playerRating) / 400))

  const actual = playerWon ? 1 : 0
  const pieceAdvantage = Number(performance.pieceAdvantage || 0)
  const margin = Number(performance.margin || 0)
  const fastWin = Boolean(performance.fastWin)
  const moveCount = Number(performance.moves || 0)

  let bonus = 0
  let penalty = 0

  if (playerWon) {
    if (fastWin) bonus += 12
    if (pieceAdvantage >= 3) bonus += 10
    if (moveCount > 0 && moveCount < 25) bonus += 6
    if (margin >= 2) bonus += Math.min(10, margin * 2)
  }

  else {
    penalty += Math.min(18, Math.max(6, margin * 2))
    if (moveCount > 0 && moveCount <= 20) penalty -= 4
  }

  const adjusted =
    RATING_K * (actual - expected) +
    (playerWon ? bonus : -penalty)

  const after = normalizeRating(playerRating + Math.round(adjusted))

  return {
    before: playerRating,
    after,
    change: after - playerRating,
    opponent: safeOpponentRating
  }
}

function applyOnlineRating(playerWon, performance = {}) {
  const result =
    calculateRatingResult(
      playerWon,
      onlineOpponentRating,
      performance
    )

  setPlayerRating(result.after)

  lastRatingBefore = result.before
  lastRatingAfter = result.after
  lastRatingChange = result.change

  return result
}

function applyOnlineRatingChange(playerWon) {
  return applyOnlineRating(
    playerWon,
    getOnlinePerformanceSnapshot()
  )
}

function getRankCheckerClass(
  state = getPlayerRatingState()
) {
  return `rank-${state.tier.key}`
}

function setRankCheckerElement(
  element,
  state = getPlayerRatingState()
) {
  if (!element) return

  RATING_TIERS.forEach(tier => {
    element.classList.remove(
      `rank-${tier.key}`
    )
  })

  element.classList.add(
    getRankCheckerClass(state)
  )

  element.title =
    `${state.tier.label} • ${state.rating} نقطة`
}

function createDefaultProfile() {
  return {
    name: 'لاعب',

    games: 0,
    wins: 0,
    losses: 0,
    totalMoves: 0,

    levels: {
      easy: {
        played: 0,
        wins: 0,
        losses: 0
      },

      medium: {
        played: 0,
        wins: 0,
        losses: 0
      },

      hard: {
        played: 0,
        wins: 0,
        losses: 0
      },

      impossible: {
  played: 0,
  wins: 0,
  losses: 0
},

khaled: {
  played: 0,
  wins: 0,
  losses: 0
},

online: {
  played: 0,
  wins: 0,
  losses: 0
},

progress: {
  rating: RATING_START
}
    },

    history: []
  }
}


function loadProfile() {
  const defaultProfile =
    createDefaultProfile()

  try {
    const saved =
      localStorage.getItem(
        PROFILE_KEY
      )

    if (!saved) {
      return defaultProfile
    }

    const data =
      JSON.parse(saved)

    return {
      ...defaultProfile,
      ...data,

      levels: {
        easy: {
          ...defaultProfile.levels.easy,
          ...(data.levels?.easy || {})
        },

        medium: {
          ...defaultProfile.levels.medium,
          ...(data.levels?.medium || {})
        },

        hard: {
          ...defaultProfile.levels.hard,
          ...(data.levels?.hard || {})
        },

        impossible: {
          ...defaultProfile.levels.impossible,
          ...(data.levels?.impossible || {})
        },

        khaled: {
          ...defaultProfile.levels.khaled,
          ...(data.levels?.khaled || {})
        },

        online: {
          ...defaultProfile.levels.online,
          ...(data.levels?.online || {})
        },

        progress: {
          rating:
            normalizeRating(
              data
                .levels
                ?.progress
                ?.rating
            )
        }
      },

      history:
        Array.isArray(data.history)
          ? data.history
          : []
    }
  }

  catch (error) {
    console.error(
      'خطأ في تحميل الملف الشخصي:',
      error
    )

    return defaultProfile
  }
}


let playerProfile =
  loadProfile()


function saveProfile() {

  // مسجل دخول
  if (currentAuthUser) {
    pendingProfileSave =
      saveCloudProfile()

    return pendingProfileSave
  }

  // زائر
  localStorage.setItem(
    PROFILE_KEY,
    JSON.stringify(playerProfile)
  )

  return Promise.resolve()
}


function savePlayerName(name) {
  const cleanName =
    String(name)
      .trim()
      .slice(0, 20)

  if (!cleanName) {
    return false
  }

  playerProfile.name =
    cleanName

  saveProfile()

  return true
}


// ========================================
// تسجيل نتيجة مباراة
// ========================================

function recordGameResult(
  playerWon,
  options = {}
) {
  // يمنع تسجيل نفس المباراة مرتين
  if (currentGameRecorded) {
    return Promise.resolve()
  }

  currentGameRecorded = true

  const level =
    currentLevel || 'easy'

  const forfeited =
    options.forfeited === true

  if (!playerProfile.levels[level]) {
    playerProfile.levels[level] = {
      played: 0,
      wins: 0,
      losses: 0
    }
  }

  playerProfile.games++
  playerProfile.totalMoves +=
    currentGameMoves

  playerProfile
    .levels[level]
    .played++

  if (playerWon) {
    playerProfile.wins++

    playerProfile
      .levels[level]
      .wins++
  }

  else {
    playerProfile.losses++

    playerProfile
      .levels[level]
      .losses++
  }

  // التصنيف يتحرك في الأونلاين فقط.
  // اللعب ضد الذكاء يحدّث الإحصائيات والحركات فقط.
  let ratingResult = null

  lastRatingChange = 0
  lastRatingBefore =
    getPlayerRating()
  lastRatingAfter =
    lastRatingBefore

  if (level === 'online') {
    ratingResult =
      applyOnlineRating(
        playerWon,
        options.performance || getOnlinePerformanceSnapshot()
      )
  }

  // ========================================
  // سجل آخر المباريات
  // ========================================

  playerProfile.history.unshift({
    result:
      playerWon
        ? 'win'
        : 'loss',

    level,

    moves:
      currentGameMoves,

    ratingChange:
      ratingResult?.change || 0,

    rating:
      ratingResult?.after ??
      getPlayerRating(),

    forfeited,

    date:
      new Date()
        .toLocaleString(
          'ar-SA'
        )
  })

  // نحفظ آخر 20 مباراة فقط
  playerProfile.history =
    playerProfile.history.slice(
      0,
      20
    )

  return saveProfile()
}

// ========================================
// تنسيق المستوى ولوحة الصدارة
// ========================================

function ensureProgressionStyles() {
  if (
    document.querySelector(
      '#progressionStyles'
    )
  ) {
    return
  }

  const style =
    document.createElement('style')

  style.id =
    'progressionStyles'

  style.textContent = `
    .player-level-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 48px;
      height: 24px;
      padding: 0 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      color: #f7e9d2;
      background: rgba(97, 55, 30, 0.72);
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
      white-space: nowrap;
    }

    .rank-checker {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.24);
      box-shadow:
        inset 0 2px 3px rgba(255,255,255,.18),
        inset 0 -3px 5px rgba(0,0,0,.24),
        0 4px 10px rgba(0,0,0,.26);
    }

    .rank-checker::before {
      content: '';
      position: absolute;
      inset: 18%;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,.24);
    }

    .rank-checker::after {
      position: relative;
      z-index: 1;
      font-size: 11px;
      line-height: 1;
      font-weight: 900;
    }

    .rank-checker-mini {
      width: 24px;
      height: 24px;
    }

    .rank-checker-large {
      width: 64px;
      height: 64px;
      border-width: 3px;
    }

    .rank-checker-large::after {
      font-size: 23px;
    }

    .rank-beginner {
      background: linear-gradient(145deg, #b58a60, #755037);
      border-color: #caa47d;
    }

    .rank-beginner::after {
      content: '•';
      color: #f4dfc5;
    }

    .rank-rising {
      background: linear-gradient(145deg, #d39a5c, #8a542c);
      border-color: #e2b47e;
    }

    .rank-rising::after {
      content: '◆';
      color: #ffe2b8;
    }

    .rank-intermediate {
      background: linear-gradient(145deg, #ded8ca, #807d77);
      border-color: #f1ece1;
    }

    .rank-intermediate::after {
      content: '✦';
      color: #2b2925;
    }

    .rank-advanced {
      background: linear-gradient(145deg, #e8c582, #a4702f);
      border-color: #f6d89d;
      box-shadow:
        inset 0 2px 3px rgba(255,255,255,.28),
        inset 0 -3px 5px rgba(70,37,8,.28),
        0 4px 12px rgba(153,104,38,.30);
    }

    .rank-advanced::after {
      content: '✦';
      color: #573812;
    }

    .rank-expert {
      background: linear-gradient(145deg, #282522, #090909);
      border-color: #d4b078;
      box-shadow:
        inset 0 2px 3px rgba(255,255,255,.10),
        inset 0 -3px 5px rgba(0,0,0,.45),
        0 4px 14px rgba(212,176,120,.20);
    }

    .rank-expert::after {
      content: '♛';
      color: #d8b77f;
    }

    .rank-grandmaster {
      background:
        radial-gradient(circle at 35% 28%, #fff6d8 0 12%, transparent 13%),
        linear-gradient(145deg, #f0d8a1, #9b642b 58%, #42240e);
      border-color: #ffe4a9;
      box-shadow:
        inset 0 2px 4px rgba(255,255,255,.38),
        inset 0 -4px 6px rgba(84,43,8,.38),
        0 0 0 2px rgba(220,175,94,.14),
        0 5px 18px rgba(222,176,91,.34);
    }

    .rank-grandmaster::after {
      content: '♛';
      color: #3b210c;
      text-shadow: 0 1px 0 rgba(255,255,255,.35);
    }

    .leaderboard-player-name-line {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .leaderboard-player-name-line strong {
      min-width: 0;
    }

    .profile-name-level-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      flex-wrap: wrap;
    }

    .profile-name-level-row h2 {
      margin: 0;
    }

    .profile-page-level-badge {
      transform: translateY(1px);
    }

    .profile-xp-box {
      width: min(320px, 86vw);
      margin: 12px auto 0;
    }

    .profile-xp-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 7px;
      font-size: 11px;
      color: rgba(255,255,255,.72);
    }

    .profile-xp-track {
      position: relative;
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(0,0,0,.22);
      border: 1px solid rgba(255,255,255,.07);
    }

    .profile-xp-fill {
      display: block;
      width: 0;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(
        90deg,
        #b88652,
        #e6c08d
      );
      transition: width .25s ease;
    }

    .leaderboard-view {
      width: min(760px, 94vw);
      margin: 0 auto;
    }

    .leaderboard-main {
      width: 100%;
    }

    .leaderboard-note {
      width: fit-content;
      margin: 0 auto 14px;
      padding: 7px 12px;
      border-radius: 999px;
      font-size: 12px;
      color: rgba(255,255,255,.72);
      background: rgba(255,255,255,.06);
      border: 1px solid rgba(255,255,255,.08);
    }

    .leaderboard-list {
      display: grid;
      gap: 9px;
    }

    .leaderboard-loading,
    .leaderboard-empty {
      padding: 26px 16px;
      text-align: center;
      color: rgba(255,255,255,.68);
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 16px;
    }

    .leaderboard-row {
      width: 100%;
      display: grid;
      grid-template-columns: 58px 1fr auto;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 16px;
      background: linear-gradient(
        135deg,
        rgba(255,255,255,.075),
        rgba(255,255,255,.035)
      );
      color: #fff;
      text-align: right;
      cursor: pointer;
      transition:
        transform .15s ease,
        border-color .15s ease,
        background .15s ease;
    }

    .leaderboard-row:hover {
      transform: translateY(-1px);
      border-color: rgba(229, 193, 145, .30);
      background: linear-gradient(
        135deg,
        rgba(255,255,255,.10),
        rgba(255,255,255,.045)
      );
    }

    .leaderboard-rank {
      font-size: 18px;
      text-align: center;
      font-weight: 900;
    }

    .leaderboard-player-copy {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .leaderboard-player-copy strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
    }

    .leaderboard-player-copy small {
      color: rgba(255,255,255,.60);
      font-size: 11px;
    }

    .leaderboard-points {
      min-width: 62px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(184, 134, 82, .14);
      border: 1px solid rgba(229, 193, 145, .15);
    }

    .leaderboard-points strong {
      font-size: 16px;
    }

    .leaderboard-points small {
      font-size: 10px;
      color: rgba(255,255,255,.62);
    }

    .public-player-view {
      width: 100%;
    }

    .public-profile-back-btn {
      margin-bottom: 12px;
    }

    .public-profile-card {
      padding: 20px;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,.09);
      background: linear-gradient(
        145deg,
        rgba(255,255,255,.075),
        rgba(255,255,255,.03)
      );
    }

    .public-profile-avatar {
      width: 58px;
      height: 58px;
      margin: 0 auto 10px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      font-size: 25px;
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.10);
    }

    .public-profile-name-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      flex-wrap: wrap;
    }

    .public-profile-name-row h2 {
      margin: 0;
      font-size: 21px;
    }

    .public-profile-xp {
      width: min(340px, 100%);
      margin: 14px auto 18px;
    }

    .public-profile-stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-bottom: 16px;
    }

    .public-profile-stats > div {
      padding: 12px 8px;
      text-align: center;
      border-radius: 13px;
      background: rgba(255,255,255,.055);
      border: 1px solid rgba(255,255,255,.07);
    }

    .public-profile-stats span {
      display: block;
      margin-bottom: 5px;
      color: rgba(255,255,255,.60);
      font-size: 10px;
    }

    .public-profile-stats strong {
      font-size: 17px;
    }

    .public-level-list {
      display: grid;
      gap: 8px;
    }

    .public-level-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 11px 13px;
      border-radius: 13px;
      background: rgba(255,255,255,.045);
      border: 1px solid rgba(255,255,255,.065);
    }

    .public-level-row > div:first-child {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .public-level-row small {
      color: rgba(255,255,255,.55);
      font-size: 10px;
    }

    .public-level-row > div:last-child {
      display: flex;
      gap: 6px;
      font-size: 11px;
      color: rgba(255,255,255,.72);
    }

    @media (max-width: 620px) {
      .leaderboard-row {
        grid-template-columns: 44px 1fr auto;
        gap: 8px;
        padding: 12px;
      }

      .leaderboard-points {
        min-width: 52px;
        padding: 7px 8px;
      }

      .public-profile-stats {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .selected-ring,
    .remote-selected-ring {
      position: relative;
      filter: none !important;
      transform: none !important;
      box-shadow: none !important;
      animation: none !important;
    }

   .selected-ring::after,
.remote-selected-ring::after {
  content: '';
  position: absolute;
  inset: -7px;
  border: 2px solid rgba(255,255,255,.9);
  border-radius: 50%;
  pointer-events: none;
  z-index: -1;
}
  `

  document.head.appendChild(style)
}


// ========================================
// الصفحة الرئيسية
// ========================================

function showHome() {
  ensureProgressionStyles()
  stopImpossibleWorker()
  stopKhaledWorker()
  stopMatchTimer(false)
  matchTimerElapsedMs = 0

  if (onlineMode) {
    leaveOnlineRoom()
  }

  selectedPiece = null
  currentTurn = 'cream'
  mustContinueCapture = false
  gameOver = false

  document.querySelector('#app').innerHTML = `
    <main class="home">

      <!-- زر الملف الشخصي -->
      <button id="profileBtn" class="profile-top-btn">
        <span
          id="profileRankPiece"
          class="rank-checker rank-checker-mini rank-beginner"
          aria-hidden="true"
        ></span>
        <span id="profileButtonName">لاعب</span>
        <span
          id="profileLevelBadge"
          class="player-level-badge"
        >
          400
        </span>
      </button>


      <!-- ========================================
           الصفحة الرئيسية العادية
           ======================================== -->

      <section id="homeMainContent">

        <h1 class="game-title">الدامة</h1>

        <p class="subtitle">
          العب الدامة مع أصدقائك أو تحدَّ الذكاء الاصطناعي
        </p>

        <div class="menu">
          <button id="newGameBtn" class="primary-btn home-action-btn">
            لعبة جديدة
          </button>

          <button
            id="leaderboardBtn"
            class="secondary-btn home-action-btn leaderboard-action-btn"
          >
            ♛ لوحة الصدارة
          </button>
        </div>

      </section>


      <!-- ========================================
           الملف الشخصي
           ======================================== -->

      <section
        id="profileView"
        class="profile-view"
        hidden
      >

        <div class="profile-page-header">
          <button
            id="profileBackBtn"
            class="profile-back-btn"
          >
            ← رجوع
          </button>

          <div>
            <div class="profile-big-avatar">
              <span
                id="profileRankPieceLarge"
                class="rank-checker rank-checker-large rank-beginner"
                aria-hidden="true"
              ></span>
            </div>

            <div class="profile-name-level-row">
              <h2 id="profilePageName">
                لاعب
              </h2>

              <span
                id="profilePageLevelBadge"
                class="player-level-badge profile-page-level-badge"
              >
                مبتدئ • 400
              </span>
            </div>

            <p>
              إحصائياتك في الدامة
            </p>

            <div class="profile-xp-box">
              <div class="profile-xp-head">
                <span id="profileXpText">
                  400 نقطة
                </span>

                <span id="profileXpTotal">
                  التالي: 800
                </span>
              </div>

              <div class="profile-xp-track">
                <span
                  id="profileXpFill"
                  class="profile-xp-fill"
                ></span>
              </div>
            </div>
          </div>
        </div>

<!-- ========================================
     الحساب
     ======================================== -->

<div class="profile-section account-section">

  <div class="account-section-head">
    <div>
      <span class="account-eyebrow">حساب اللاعب</span>
      <h3>الحساب</h3>
    </div>

    <div class="account-head-icon">👤</div>
  </div>

  <!-- الزائر -->
  <div id="guestAccountView" class="guest-account-view">

    <div class="account-welcome-card">
      <div class="account-welcome-icon">♛</div>

      <div class="account-welcome-copy">
        <strong>احفظ تقدمك وإحصائياتك</strong>
        <small>
          سجّل دخولك أو أنشئ حسابًا، وترجع بياناتك لك من أي جهاز.
        </small>
      </div>
    </div>

    <div class="account-choice-grid">

      <button
        id="openLoginBtn"
        class="account-choice-btn account-login-choice"
        type="button"
      >
        <span class="account-choice-icon">↪</span>

        <span class="account-choice-copy">
          <strong>تسجيل الدخول</strong>
          <small>عندي حساب</small>
        </span>

        <span class="account-choice-arrow">←</span>
      </button>

      <button
        id="openRegisterBtn"
        class="account-choice-btn account-register-choice"
        type="button"
      >
        <span class="account-choice-icon">＋</span>

        <span class="account-choice-copy">
          <strong>إنشاء حساب</strong>
          <small>حساب جديد</small>
        </span>

        <span class="account-choice-arrow">←</span>
      </button>

    </div>

  </div>


  <!-- تسجيل الدخول -->
  <div
    id="loginAccountView"
    class="auth-form-view auth-modern-card"
    hidden
  >

    <button
      id="backFromLoginBtn"
      class="auth-back-btn"
      type="button"
    >
      <span>→</span>
      رجوع
    </button>

    <div class="auth-modern-head">
      <div class="auth-modern-icon">↪</div>

      <div>
        <h4>تسجيل الدخول</h4>
        <p>أدخل حسابك للمتابعة من حيث توقفت.</p>
      </div>
    </div>

    <label class="auth-field">
      <span class="auth-field-label">البريد الإلكتروني</span>

      <span class="auth-input-wrap">
        <span class="auth-input-icon">✉</span>

        <input
          id="loginEmail"
          type="email"
          placeholder="name@example.com"
          autocomplete="email"
        >
      </span>
    </label>

    <label class="auth-field">
      <span class="auth-field-label">كلمة المرور</span>

      <span class="auth-input-wrap">
        <span class="auth-input-icon">⌁</span>

        <input
          id="loginPassword"
          type="password"
          placeholder="••••••••"
          autocomplete="current-password"
        >
      </span>
    </label>

    <button
      id="loginSubmitBtn"
      class="auth-submit-btn"
      type="button"
    >
      <span>دخول إلى الحساب</span>
      <span class="auth-submit-arrow">←</span>
    </button>

    <p
      id="loginMessage"
      class="auth-message"
    ></p>

  </div>


  <!-- إنشاء حساب -->
  <div
    id="registerAccountView"
    class="auth-form-view auth-modern-card"
    hidden
  >

    <button
      id="backFromRegisterBtn"
      class="auth-back-btn"
      type="button"
    >
      <span>→</span>
      رجوع
    </button>

    <div class="auth-modern-head">
      <div class="auth-modern-icon">＋</div>

      <div>
        <h4>إنشاء حساب</h4>
        <p>أنشئ حسابك واحفظ سجل مبارياتك وإحصائياتك.</p>
      </div>
    </div>

    <label class="auth-field">
      <span class="auth-field-label">اسم اللاعب</span>

      <span class="auth-input-wrap">
        <span class="auth-input-icon">♟</span>

        <input
          id="registerName"
          type="text"
          maxlength="20"
          placeholder="اسمك داخل اللعبة"
          autocomplete="nickname"
        >
      </span>
    </label>

    <label class="auth-field">
      <span class="auth-field-label">البريد الإلكتروني</span>

      <span class="auth-input-wrap">
        <span class="auth-input-icon">✉</span>

        <input
          id="registerEmail"
          type="email"
          placeholder="name@example.com"
          autocomplete="email"
        >
      </span>
    </label>

    <label class="auth-field">
      <span class="auth-field-label">كلمة المرور</span>

      <span class="auth-input-wrap">
        <span class="auth-input-icon">⌁</span>

        <input
          id="registerPassword"
          type="password"
          placeholder="6 أحرف على الأقل"
          autocomplete="new-password"
        >
      </span>
    </label>

    <label class="auth-field">
      <span class="auth-field-label">تأكيد كلمة المرور</span>

      <span class="auth-input-wrap">
        <span class="auth-input-icon">✓</span>

        <input
          id="registerPasswordConfirm"
          type="password"
          placeholder="أعد كتابة كلمة المرور"
          autocomplete="new-password"
        >
      </span>
    </label>

    <button
      id="registerSubmitBtn"
      class="auth-submit-btn"
      type="button"
    >
      <span>إنشاء الحساب</span>
      <span class="auth-submit-arrow">←</span>
    </button>

    <p
      id="registerMessage"
      class="auth-message"
    ></p>

  </div>


  <!-- الحساب بعد تسجيل الدخول -->
  <div
    id="loggedAccountView"
    class="logged-account-view"
    hidden
  >

    <div class="account-signed-card">

      <div class="account-signed-avatar">
        ✓
      </div>

      <div class="account-signed-copy">
        <span class="account-signed-label">مسجل الدخول</span>

        <strong id="loggedAccountName">
          لاعب
        </strong>

        <small id="loggedAccountEmail">
          example@email.com
        </small>
      </div>

    </div>

    <button
      id="logoutAccountBtn"
      class="logout-account-btn"
      type="button"
    >
      <span>تسجيل الخروج</span>
      <span>↗</span>
    </button>

  </div>

</div>
        <!-- تعديل الاسم -->

        <div class="profile-section">

          <h3>
            الاسم
          </h3>

          <div class="profile-name-editor">

            <input
              id="profileNameInput"
              type="text"
              maxlength="20"
              placeholder="اكتب اسمك"
            >

            <button
              id="saveProfileNameBtn"
              class="profile-save-btn"
            >
              حفظ الاسم
            </button>

          </div>

          <p
            id="profileSaveMessage"
            class="profile-save-message"
          ></p>

        </div>


        <!-- الإحصائيات العامة -->

        <div class="profile-section">

          <h3>
            الإحصائيات
          </h3>

          <div class="profile-stats-grid">

            <div class="profile-stat-card">
              <span>المباريات</span>
              <strong id="profileGames">0</strong>
            </div>

            <div class="profile-stat-card">
              <span>الانتصارات</span>
              <strong id="profileWins">0</strong>
            </div>

            <div class="profile-stat-card">
              <span>الخسائر</span>
              <strong id="profileLosses">0</strong>
            </div>

            <div class="profile-stat-card">
              <span>حركاتك</span>
              <strong id="profileMoves">0</strong>
            </div>

          </div>

        </div>


        <!-- إحصائيات المستويات -->

        <div class="profile-section">

          <div class="level-section-head">
            <div>
              <span class="profile-section-kicker">أداؤك</span>

              <h3>
                حسب نوع اللعب
              </h3>
            </div>
          </div>

          <div class="level-stats-list">

            <div class="level-stat-row">
              <div class="level-stat-main">
                <strong>سهل</strong>
                <small id="easyPlayed">0 مباراة</small>
              </div>

              <div class="level-results">
                <span id="easyWins">0 فوز</span>
                <span id="easyLosses">0 خسارة</span>
              </div>
            </div>

            <div class="level-stat-row">
              <div class="level-stat-main">
                <strong>متوسط</strong>
                <small id="mediumPlayed">0 مباراة</small>
              </div>

              <div class="level-results">
                <span id="mediumWins">0 فوز</span>
                <span id="mediumLosses">0 خسارة</span>
              </div>
            </div>

            <div class="level-stat-row">
              <div class="level-stat-main">
                <strong>صعب</strong>
                <small id="hardPlayed">0 مباراة</small>
              </div>

              <div class="level-results">
                <span id="hardWins">0 فوز</span>
                <span id="hardLosses">0 خسارة</span>
              </div>
            </div>

            <div class="level-stat-row impossible-row">
              <div class="level-stat-main">
                <strong>☠️ أتحداك تفوز</strong>
                <small id="impossiblePlayed">0 مباراة</small>
              </div>

              <div class="level-results">
                <span id="impossibleWins">0 فوز</span>
                <span id="impossibleLosses">0 خسارة</span>
              </div>
            </div>

            <div class="level-stat-row khaled-row">
              <div class="level-stat-main">
                <strong>🛡️ خالد</strong>
                <small id="khaledPlayed">0 مباراة</small>
              </div>

              <div class="level-results">
                <span id="khaledWins">0 فوز</span>
                <span id="khaledLosses">0 خسارة</span>
              </div>
            </div>

            <div class="level-stat-row online-row">

              <div class="level-stat-main online-stat-main">
                <span class="online-stat-icon">🌐</span>

                <div>
                  <strong>أونلاين</strong>
                  <small id="onlinePlayed">0 مباراة</small>
                </div>
              </div>

              <div class="level-results online-results">
                <span id="onlineWins">0 فوز</span>
                <span id="onlineLosses">0 خسارة</span>
              </div>

            </div>

          </div>

        </div>


        <!-- آخر المباريات -->

        <div class="profile-section">

          <h3>
            آخر المباريات
          </h3>

          <div id="gameHistory">
          </div>

        </div>

      </section>

      <!-- ========================================
           لوحة الصدارة
           ======================================== -->

      <section
        id="leaderboardView"
        class="profile-view leaderboard-view"
        hidden
      >
        <div class="profile-page-header leaderboard-page-header">
          <button
            id="leaderboardBackBtn"
            class="profile-back-btn"
            type="button"
          >
            ← رجوع
          </button>

          <div>
            <div class="profile-big-avatar">
              ♛
            </div>

            <h2>
              لوحة الصدارة
            </h2>

            <p>
              الترتيب حسب تصنيف الأونلاين
            </p>
          </div>
        </div>

        <div
          id="leaderboardMain"
          class="leaderboard-main"
        >
          <div class="leaderboard-note">
            التصنيف يبدأ من 400 ويتغير بنتائج الأونلاين فقط
          </div>

          <div
            id="leaderboardList"
            class="leaderboard-list"
          >
            <div class="leaderboard-loading">
              جاري تحميل اللاعبين...
            </div>
          </div>
        </div>

        <div
          id="publicPlayerView"
          class="public-player-view"
          hidden
        ></div>
      </section>

    </main>


    <!-- نافذة لعبة جديدة -->

    <div id="gameModal" class="modal">

      <div class="modal-box">

        <button
          id="closeModal"
          class="close-btn"
        >
          ×
        </button>

        <h2>
          لعبة جديدة
        </h2>

        <p class="modal-description">
          اختر طريقة اللعب
        </p>

        <div class="game-options">

          <button
            id="friendBtn"
            class="game-option"
          >

            <span class="option-icon">
              ♟♟
            </span>

            <span class="option-text">

              <strong>
                العب مع صديق
              </strong>

              <small>
                أنشئ غرفة أو انضم باستخدام كود
              </small>

            </span>

          </button>


          <button
            id="aiBtn"
            class="game-option"
          >

            <span class="option-icon">
              ♛
            </span>

            <span class="option-text">

              <strong>
                العب ضد الكمبيوتر
              </strong>

              <small>
                اختر مستوى الصعوبة وتحدَّ الذكاء الاصطناعي
              </small>

            </span>

          </button>

        </div>

      </div>

    </div>
  `

  setupHomeEvents()
updateProfileUI()
supabase.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentAuthUser = session.user
    await loadCloudProfile(session.user)
    updateProfileUI()
  }
})

refreshAuthUI()
  // ========================================
// واجهة تسجيل الدخول وإنشاء الحساب
// ========================================

const guestAccountView =
  document.querySelector(
    '#guestAccountView'
  )

const loginAccountView =
  document.querySelector(
    '#loginAccountView'
  )

const registerAccountView =
  document.querySelector(
    '#registerAccountView'
  )


document
  .querySelector('#openLoginBtn')
  ?.addEventListener(
    'click',
    () => {

      guestAccountView.hidden = true
      registerAccountView.hidden = true
      loginAccountView.hidden = false
    }
  )


document
  .querySelector('#openRegisterBtn')
  ?.addEventListener(
    'click',
    () => {

      guestAccountView.hidden = true
      loginAccountView.hidden = true
      registerAccountView.hidden = false
    }
  )


document
  .querySelector('#backFromLoginBtn')
  ?.addEventListener(
    'click',
    () => {

      loginAccountView.hidden = true
      guestAccountView.hidden = false
    }
  )


document
  .querySelector('#backFromRegisterBtn')
  ?.addEventListener(
    'click',
    () => {

      registerAccountView.hidden = true
      guestAccountView.hidden = false
    }
  )
}

// ========================================
// أحداث الرئيسية
// ========================================
function updateProfileUI() {

  // ========================================
  // الاسم
  // ========================================

  const buttonName =
    document.querySelector(
      '#profileButtonName'
    )

  const pageName =
    document.querySelector(
      '#profilePageName'
    )

  const nameInput =
    document.querySelector(
      '#profileNameInput'
    )

  if (buttonName) {
    buttonName.textContent =
      playerProfile.name
  }

  if (pageName) {
    pageName.textContent =
      playerProfile.name
  }

  if (nameInput) {
    nameInput.value =
      playerProfile.name
  }

  const ratingState =
    getPlayerRatingState()

  const levelBadge =
    document.querySelector(
      '#profileLevelBadge'
    )

  const pageLevelBadge =
    document.querySelector(
      '#profilePageLevelBadge'
    )

  const xpText =
    document.querySelector(
      '#profileXpText'
    )

  const xpTotal =
    document.querySelector(
      '#profileXpTotal'
    )

  const xpFill =
    document.querySelector(
      '#profileXpFill'
    )

  if (levelBadge) {
    levelBadge.textContent =
      `${ratingState.rating}`

    levelBadge.title =
      ratingState.tier.label
  }

  if (pageLevelBadge) {
    pageLevelBadge.textContent =
      `${ratingState.tier.label} • ${ratingState.rating}`
  }

  if (xpText) {
    xpText.textContent =
      `${ratingState.rating} نقطة`
  }

  if (xpTotal) {
    xpTotal.textContent =
      ratingState.nextTier
        ? `التالي: ${ratingState.nextTier.label} عند ${ratingState.nextRating}`
        : 'أعلى تصنيف • 3000'
  }

  if (xpFill) {
    xpFill.style.width =
      `${ratingState.percent}%`
  }

  setRankCheckerElement(
    document.querySelector(
      '#profileRankPiece'
    ),
    ratingState
  )

  setRankCheckerElement(
    document.querySelector(
      '#profileRankPieceLarge'
    ),
    ratingState
  )



  // ========================================
  // الإحصائيات العامة
  // ========================================

  document.querySelector(
    '#profileGames'
  ).textContent =
    playerProfile.games

  document.querySelector(
    '#profileWins'
  ).textContent =
    playerProfile.wins

  document.querySelector(
    '#profileLosses'
  ).textContent =
    playerProfile.losses

  document.querySelector(
    '#profileMoves'
  ).textContent =
    playerProfile.totalMoves


  // ========================================
  // المستويات
  // ========================================

  updateLevelProfileStats(
    'easy'
  )

  updateLevelProfileStats(
    'medium'
  )

  updateLevelProfileStats(
    'hard'
  )

  updateLevelProfileStats(
    'impossible'
  )

  updateLevelProfileStats(
    'khaled'
  )

  updateLevelProfileStats(
    'online'
  )
  


  // ========================================
  // آخر المباريات
  // ========================================

  renderGameHistory()
}


function updateLevelProfileStats(
  level
) {
  const stats =
    playerProfile.levels[level]

  if (!stats) return

  const played =
    document.querySelector(
      `#${level}Played`
    )

  const wins =
    document.querySelector(
      `#${level}Wins`
    )

  const losses =
    document.querySelector(
      `#${level}Losses`
    )

  if (played) {
    played.textContent =
      `${stats.played} مباراة`
  }

  if (wins) {
    wins.textContent =
      `${stats.wins} فوز`
  }

  if (losses) {
    losses.textContent =
      `${stats.losses} خسارة`
  }
}


function renderGameHistory() {

  const historyBox =
    document.querySelector(
      '#gameHistory'
    )

  if (!historyBox) return

  historyBox.innerHTML = ''

  if (
    playerProfile.history.length === 0
  ) {

    const empty =
      document.createElement('p')

    empty.className =
      'empty-history'

    empty.textContent =
      'ما لعبت أي مباراة إلى الآن.'

    historyBox.appendChild(empty)

    return
  }


  playerProfile.history
    .forEach(game => {

      const item =
        document.createElement('div')

      item.className =
        'history-game-item'


      const result =
        document.createElement('div')

      result.className =
        game.result === 'win'
          ? 'history-result history-win'
          : 'history-result history-loss'

      result.textContent =
        game.result === 'win'
          ? '✓ فوز'
          : '✕ خسارة'


      const info =
        document.createElement('div')

      info.className =
        'history-game-info'


      const level =
        document.createElement('strong')

      level.textContent =
        getLevelName(game.level)


      const details =
        document.createElement('small')

      details.textContent =
        `${game.moves} حركة • ${game.date}`


      info.appendChild(level)
      info.appendChild(details)

      item.appendChild(result)
      item.appendChild(info)

      historyBox.appendChild(item)
    })
}
// ========================================
// ♛ لوحة الصدارة
// ========================================

let leaderboardPlayers = []

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getPublicPlayerRatingState(player) {
  return getPlayerRatingState({
    levels:
      player?.levels || {}
  })
}

async function loadLeaderboard() {
  const list =
    document.querySelector(
      '#leaderboardList'
    )

  if (!list) return

  list.innerHTML = `
    <div class="leaderboard-loading">
      جاري تحميل اللاعبين...
    </div>
  `

  const { data, error } =
    await supabase.rpc(
      'get_leaderboard'
    )

  if (error) {
    console.error(
      'خطأ في تحميل لوحة الصدارة:',
      error
    )

    list.innerHTML = `
      <div class="leaderboard-empty">
        تعذر تحميل لوحة الصدارة.
      </div>
    `

    return
  }

  leaderboardPlayers =
    (Array.isArray(data)
      ? data
      : [])
      .filter(player => {
        const online =
          getPublicLevelStat(
            player,
            'online'
          )

        return online.played > 0
      })
      .sort((a, b) => {
        const ratingDiff =
          getPublicPlayerRatingState(b)
            .rating -
          getPublicPlayerRatingState(a)
            .rating

        if (ratingDiff !== 0) {
          return ratingDiff
        }

        const aOnline =
          getPublicLevelStat(a, 'online')
        const bOnline =
          getPublicLevelStat(b, 'online')

        return (
          bOnline.wins -
          aOnline.wins
        )
      })

  renderLeaderboard()
}

function renderLeaderboard() {
  const list =
    document.querySelector(
      '#leaderboardList'
    )

  if (!list) return

  if (
    leaderboardPlayers.length === 0
  ) {
    list.innerHTML = `
      <div class="leaderboard-empty">
        ما فيه لاعبين في لوحة الصدارة إلى الآن.
      </div>
    `

    return
  }

  list.innerHTML =
    leaderboardPlayers
      .map((player, index) => {
        const rank =
          index + 1

        const ratingState =
          getPublicPlayerRatingState(
            player
          )

        const points =
          ratingState.rating

        const onlineStats =
          getPublicLevelStat(
            player,
            'online'
          )

        const rankText =
          rank === 1
            ? '🥇'
            : rank === 2
              ? '🥈'
              : rank === 3
                ? '🥉'
                : `#${rank}`

        return `
          <button
            class="leaderboard-row"
            type="button"
            data-player-id="${escapeHtml(player.id)}"
          >
            <span class="leaderboard-rank">
              ${rankText}
            </span>

            <span class="leaderboard-player-copy">
              <span class="leaderboard-player-name-line">
                <span
                  class="rank-checker rank-checker-mini ${getRankCheckerClass(ratingState)}"
                  aria-hidden="true"
                ></span>

                <strong>
                  ${escapeHtml(player.name || 'لاعب')}
                </strong>
              </span>

              <small>
                ${escapeHtml(ratingState.tier.label)}
                • ${onlineStats.played} مباراة أونلاين
              </small>
            </span>

            <span class="leaderboard-points">
              <strong>${points}</strong>
              <small>تصنيف</small>
            </span>
          </button>
        `
      })
      .join('')

  list
    .querySelectorAll(
      '.leaderboard-row'
    )
    .forEach(button => {
      button.addEventListener(
        'click',
        () => {
          const player =
            leaderboardPlayers
              .find(
                item =>
                  String(item.id) ===
                  String(
                    button.dataset.playerId
                  )
              )

          if (player) {
            openPublicPlayerProfile(
              player
            )
          }
        }
      )
    })
}

function getPublicLevelStat(
  player,
  level
) {
  const stats =
    player
      ?.levels
      ?.[level] || {
        played: 0,
        wins: 0,
        losses: 0
      }

  return {
    played:
      Number(stats.played) || 0,
    wins:
      Number(stats.wins) || 0,
    losses:
      Number(stats.losses) || 0
  }
}

function openPublicPlayerProfile(
  player
) {
  const main =
    document.querySelector(
      '#leaderboardMain'
    )

  const view =
    document.querySelector(
      '#publicPlayerView'
    )

  if (!main || !view) return

  const ratingState =
    getPublicPlayerRatingState(
      player
    )

  const easy =
    getPublicLevelStat(
      player,
      'easy'
    )

  const medium =
    getPublicLevelStat(
      player,
      'medium'
    )

  const hard =
    getPublicLevelStat(
      player,
      'hard'
    )

  const impossible =
    getPublicLevelStat(
      player,
      'impossible'
    )

  const khaled =
    getPublicLevelStat(
      player,
      'khaled'
    )

  const online =
    getPublicLevelStat(
      player,
      'online'
    )

  main.hidden = true
  view.hidden = false

  view.innerHTML = `
    <button
      id="publicProfileBackBtn"
      class="profile-back-btn public-profile-back-btn"
      type="button"
    >
      ← لوحة الصدارة
    </button>

    <div class="public-profile-card">
      <div class="public-profile-avatar">
        <span
          class="rank-checker rank-checker-large ${getRankCheckerClass(ratingState)}"
          aria-hidden="true"
        ></span>
      </div>

      <div class="public-profile-name-row">
        <h2>
          ${escapeHtml(player.name || 'لاعب')}
        </h2>

        <span class="player-level-badge">
          ${escapeHtml(ratingState.tier.label)} • ${ratingState.rating}
        </span>
      </div>

      <div class="public-profile-xp">
        <div class="profile-xp-head">
          <span>
            ${ratingState.rating} نقطة
          </span>

          <span>
            ${
              ratingState.nextTier
                ? `التالي: ${escapeHtml(ratingState.nextTier.label)} عند ${ratingState.nextRating}`
                : 'أعلى تصنيف • 3000'
            }
          </span>
        </div>

        <div class="profile-xp-track">
          <span
            class="profile-xp-fill"
            style="width: ${ratingState.percent}%"
          ></span>
        </div>
      </div>

      <div class="public-profile-stats">
        <div>
          <span>المباريات</span>
          <strong>${Number(player.games) || 0}</strong>
        </div>

        <div>
          <span>الانتصارات</span>
          <strong>${Number(player.wins) || 0}</strong>
        </div>

        <div>
          <span>الخسائر</span>
          <strong>${Number(player.losses) || 0}</strong>
        </div>

        <div>
          <span>التصنيف</span>
          <strong>${ratingState.rating}</strong>
        </div>
      </div>

      <div class="public-level-list">
        ${renderPublicLevelRow('سهل', easy)}
        ${renderPublicLevelRow('متوسط', medium)}
        ${renderPublicLevelRow('صعب', hard)}
        ${renderPublicLevelRow('☠️ أتحداك تفوز', impossible)}
        ${renderPublicLevelRow('🛡️ خالد', khaled)}
        ${renderPublicLevelRow('🌐 أونلاين', online)}
      </div>
    </div>
  `

  document
    .querySelector(
      '#publicProfileBackBtn'
    )
    ?.addEventListener(
      'click',
      () => {
        view.hidden = true
        view.innerHTML = ''
        main.hidden = false
      }
    )
}

function renderPublicLevelRow(
  title,
  stats
) {
  return `
    <div class="public-level-row">
      <div>
        <strong>${title}</strong>
        <small>
          ${stats.played} مباراة
        </small>
      </div>

      <div>
        <span>${stats.wins} فوز</span>
        <span>${stats.losses} خسارة</span>
      </div>
    </div>
  `
}


// ========================================
// تحديث واجهة الحساب
// ========================================

async function refreshAuthUI() {

  await pendingProfileSave
    .catch(() => {})

  const {
    data: { session }
  } = await supabase.auth.getSession()

  const user = session?.user || null

  currentAuthUser = user || null

  // نحافظ على الحساب بعد إغلاق الموقع أو الرجوع له
  // ولا نمسح الجلسة بسبب قراءة مؤقتة فارغة من المتصفح
  if (user) {
    await loadCloudProfile(user)
  }

  const guestView =
    document.querySelector('#guestAccountView')

  const loginView =
    document.querySelector('#loginAccountView')

  const registerView =
    document.querySelector('#registerAccountView')

  const loggedView =
    document.querySelector('#loggedAccountView')

  if (!guestView || !loggedView) {
    return
  }

  if (user) {

    guestView.hidden = true

    if (loginView) {
      loginView.hidden = true
    }

    if (registerView) {
      registerView.hidden = true
    }

    loggedView.hidden = false

    const name =
      playerProfile.name ||
      user.user_metadata?.name ||
      'لاعب'

    document.querySelector(
      '#loggedAccountName'
    ).textContent = name

    document.querySelector(
      '#loggedAccountEmail'
    ).textContent =
      user.email || ''

  }

  else {

    guestView.hidden = false
    loggedView.hidden = true
  }
}
function setupHomeEvents() {

  const modal =
    document.querySelector(
      '#gameModal'
    )

  const mainContent =
    document.querySelector(
      '#homeMainContent'
    )

  const profileView =
    document.querySelector(
      '#profileView'
    )

  const leaderboardView =
    document.querySelector(
      '#leaderboardView'
    )

  const leaderboardMain =
    document.querySelector(
      '#leaderboardMain'
    )

  const publicPlayerView =
    document.querySelector(
      '#publicPlayerView'
    )


  // ========================================
  // فتح الملف الشخصي
  // ========================================

  document
    .querySelector('#profileBtn')
    .addEventListener(
      'click',
      () => {

        mainContent.hidden = true
        profileView.hidden = false

        updateProfileUI()
      }
    )


  // ========================================
  // الرجوع من الملف الشخصي
  // ========================================

  document
    .querySelector('#profileBackBtn')
    .addEventListener(
      'click',
      () => {

        profileView.hidden = true
        mainContent.hidden = false
      }
    )


  // ========================================
  // لوحة الصدارة
  // ========================================

  document
    .querySelector('#leaderboardBtn')
    .addEventListener(
      'click',
      () => {
        mainContent.hidden = true
        profileView.hidden = true
        leaderboardView.hidden = false

        if (publicPlayerView) {
          publicPlayerView.hidden = true
          publicPlayerView.innerHTML = ''
        }

        if (leaderboardMain) {
          leaderboardMain.hidden = false
        }

        loadLeaderboard()
      }
    )

  document
    .querySelector('#leaderboardBackBtn')
    .addEventListener(
      'click',
      () => {
        leaderboardView.hidden = true

        if (publicPlayerView) {
          publicPlayerView.hidden = true
          publicPlayerView.innerHTML = ''
        }

        if (leaderboardMain) {
          leaderboardMain.hidden = false
        }

        mainContent.hidden = false
      }
    )


  // ========================================
  // حفظ الاسم
  // ========================================

  document
    .querySelector(
      '#saveProfileNameBtn'
    )
    .addEventListener(
      'click',
      () => {

        const input =
          document.querySelector(
            '#profileNameInput'
          )

        const message =
          document.querySelector(
            '#profileSaveMessage'
          )

        const saved =
          savePlayerName(
            input.value
          )

        if (!saved) {

          message.textContent =
            'اكتب اسم صحيح.'

          return
        }

        message.textContent =
          'تم حفظ الاسم ✓'

        updateProfileUI()

        setTimeout(() => {

          message.textContent = ''

        }, 1500)
      }
    )

  // ========================================
  // لعبة جديدة
  // ========================================

  document
    .querySelector('#newGameBtn')
    .addEventListener(
      'click',
      () => {

        modal.classList.add(
          'show'
        )
      }
    )


  document
    .querySelector('#closeModal')
    .addEventListener(
      'click',
      () => {

        modal.classList.remove(
          'show'
        )
      }
    )


  modal.addEventListener(
    'click',
    event => {

      if (event.target === modal) {

        modal.classList.remove(
          'show'
        )
      }
    }
  )


  // ========================================
  // ضد الكمبيوتر
  // ========================================

  document
    .querySelector('#aiBtn')
    .addEventListener(
      'click',
      showDifficulty
    )

  document
    .querySelector('#aiHomeBtn')
    ?.addEventListener(
      'click',
      showDifficulty
    )


  // ========================================
  // ضد صديق
  // ========================================

  document
  .querySelector('#friendBtn')
  .addEventListener(
    'click',
    showOnlineMenu
  )// ========================================
// إنشاء حساب فعلي
// ========================================

document
  .querySelector('#registerSubmitBtn')
  ?.addEventListener(
    'click',
    async () => {

      const name =
        document
          .querySelector('#registerName')
          .value
          .trim()

      const email =
        document
          .querySelector('#registerEmail')
          .value
          .trim()

      const password =
        document
          .querySelector('#registerPassword')
          .value

      const confirmPassword =
        document
          .querySelector(
            '#registerPasswordConfirm'
          )
          .value

      const message =
        document.querySelector(
          '#registerMessage'
        )

      if (
        !name ||
        !email ||
        !password
      ) {
        message.textContent =
          'عبّ جميع البيانات.'
        return
      }

      if (password.length < 6) {
        message.textContent =
          'كلمة المرور لازم تكون 6 أحرف على الأقل.'
        return
      }

      if (
        password !==
        confirmPassword
      ) {
        message.textContent =
          'كلمتا المرور غير متطابقتين.'
        return
      }

      message.textContent =
        'جاري إنشاء الحساب...'

      const {
        data,
        error
      } =
        await supabase.auth.signUp({
          email,
          password,

          options: {
            data: {
              name
            }
          }
        })

      if (error) {

        message.textContent =
          error.message

        return
      }

      if (data.session) {

        message.textContent =
          'تم إنشاء الحساب ✓'

        await refreshAuthUI()
      }

      else {

        message.textContent =
          'تم إنشاء الحساب. تقدر تسجل دخولك الآن.'
      }
    }
  )


// ========================================
// تسجيل الدخول
// ========================================

document
  .querySelector('#loginSubmitBtn')
  ?.addEventListener(
    'click',
    async () => {

      const email =
        document
          .querySelector('#loginEmail')
          .value
          .trim()

      const password =
        document
          .querySelector('#loginPassword')
          .value

      const message =
        document.querySelector(
          '#loginMessage'
        )

      if (!email || !password) {

        message.textContent =
          'اكتب البريد وكلمة المرور.'

        return
      }

      message.textContent =
        'جاري تسجيل الدخول...'

      const {
        error
      } =
        await supabase.auth
          .signInWithPassword({
            email,
            password
          })

      if (error) {

        message.textContent =
          'البريد أو كلمة المرور غير صحيحة.'

        return
      }

      message.textContent =
        'تم تسجيل الدخول ✓'

      await refreshAuthUI()
    }
  )


// ========================================
// تسجيل الخروج
// ========================================

document
  .querySelector('#logoutAccountBtn')
  ?.addEventListener(
    'click',
    async () => {

      await supabase.auth.signOut()

      currentAuthUser = null

      // نرجع لإحصائيات الزائر المحلية
      playerProfile =
        loadProfile()

      updateProfileUI()

      await refreshAuthUI()
    }
  )
      }
      // ========================================
// 🌐 قائمة اللعب مع صديق
// ========================================

function showOnlineMenu() {

  const modalBox =
    document.querySelector('.modal-box')

  modalBox.innerHTML = `
    <div class="online-modal-head">

      <button
        id="onlineBackBtn"
        class="back-btn modern-back-btn"
        type="button"
      >
        →
      </button>

      <div class="online-modal-badge">
        🌐 لعب أونلاين
      </div>

    </div>

    <div class="online-modal-copy">
      <h2>العب مع صديقك</h2>

      <p class="modal-description">
        أنشئ روم جديد أو ادخل بالكود اللي أرسله لك صديقك.
      </p>
    </div>

    <div class="online-choice-grid">

      <button
        id="createRoomBtn"
        class="online-choice-card create-room-card"
        type="button"
      >
        <span class="online-choice-icon">
          ＋
        </span>

        <span class="online-choice-copy">
          <strong>إنشاء روم</strong>
          <small>
            خذ كود من 5 أرقام وشاركه مع صديقك
          </small>
        </span>

        <span class="online-choice-arrow">←</span>
      </button>


      <button
        id="joinRoomBtn"
        class="online-choice-card join-room-card"
        type="button"
      >
        <span class="online-choice-icon">
          #
        </span>

        <span class="online-choice-copy">
          <strong>الانضمام إلى روم</strong>
          <small>
            عندك كود؟ ادخله وابدأ المباراة
          </small>
        </span>

        <span class="online-choice-arrow">←</span>
      </button>

    </div>
  `


  // رجوع
  document
    .querySelector('#onlineBackBtn')
    .addEventListener(
      'click',
      () => {

        showHome()

        setTimeout(() => {
          document
            .querySelector('#gameModal')
            .classList.add('show')
        }, 0)
      }
    )


  // إنشاء روم
  document
    .querySelector('#createRoomBtn')
    .addEventListener(
      'click',
      showRoomCustomization
    )


  // الانضمام
  document
    .querySelector('#joinRoomBtn')
    .addEventListener(
      'click',
      showJoinRoom
    )
}
// ========================================

// ========================================
// تخصيص الروم قبل الإنشاء
// ========================================

function showRoomCustomization() {

  const modalBox =
    document.querySelector('.modal-box')

  modalBox.innerHTML = `
    <div class="room-settings-page">

      <button id="roomSettingsBack" class="back-btn modern-back-btn">→</button>

      <div class="online-modal-badge">⚙️ تخصيص الروم</div>

      <h2>إعدادات المباراة</h2>
      <p class="modal-description">
        اختر طريقة اللعب قبل بدء الروم
      </p>

      <button type="button" class="room-setting-option selected" data-mode="no-time">
        <strong>♟️ اللعب بدون وقت</strong>
        <small>مباراة مفتوحة بدون مؤقت</small>
      </button>

      <button type="button" class="room-setting-option" data-mode="time">
        <strong>⏱️ اللعب مع وقت</strong>
        <small>كل لاعب لديه وقته الخاص مثل الشطرنج</small>
      </button>

      <div id="timeChoices" class="time-choices" hidden>
        <button type="button" data-min="1">1 دقيقة</button>
        <button type="button" data-min="5" class="active">5 دقائق</button>
        <button type="button" data-min="10">10 دقائق</button>
      </div>

      <button id="startRoomBtn" class="join-room-submit-btn">
        بدء المباراة ←
      </button>

    </div>
  `

  let mode = 'no-time'
  let minutes = 5

  document.querySelectorAll('.room-setting-option')
    .forEach(card => {
      card.onclick = () => {
        document.querySelectorAll('.room-setting-option')
          .forEach(c => c.classList.remove('selected'))

        card.classList.add('selected')
        mode = card.dataset.mode

        document.querySelector('#timeChoices').hidden = mode !== 'time'
      }
    })

  document.querySelectorAll('.time-choices button')
    .forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.time-choices button')
          .forEach(b => b.classList.remove('active'))

        btn.classList.add('active')
        minutes = Number(btn.dataset.min)
      }
    })

  document.querySelector('#roomSettingsBack').onclick =
    showOnlineMenu

  document.querySelector('#startRoomBtn').onclick = () => {
    onlineRoomSettings = {
      mode: mode,
      minutes: mode === 'time' ? minutes : null
    }

    createOnlineRoom()
  }
}

// إنشاء روم أونلاين
// ========================================

function createOnlineRoom() {
  // لو خرج اللاعب من روم سابق فصلنا السوكت عمدًا
  // حتى يصل إشعار الانسحاب حتى مع نسخة السيرفر القديمة.
  // نعيد الاتصال تلقائيًا عند إنشاء روم جديد.
  if (!socket.connected) {
    socket.connect()
  }

  socket.emit(
    'create-room',
    {
      ...onlineRoomSettings,
      playerName: playerProfile.name
    },
    response => {
      if (!response?.success) {
        alert(
          response?.message ||
          'تعذر إنشاء الروم'
        )
        return
      }

      onlineRoomCode = response.code
      onlinePlayerColor = response.color
      onlineMode = true
      onlineOpponentConnected = false
      onlineOpponentRating = null
      onlineOpponentName = 'صديقك'
      if(response.settings) onlineRoomSettings=response.settings
      currentLevel = 'online'

      // صاحب الروم يدخل اللوحة مباشرة
      // لكنه ينتظر صديقه قبل أن يستطيع الحركة.
      startOnlineGame()
    }
  )
}


// ========================================
// شاشة إدخال كود الروم
// ========================================

function showJoinRoom() {
  const modalBox =
    document.querySelector('.modal-box')

  modalBox.innerHTML = `
    <div class="online-modal-head">

      <button
        id="joinBackBtn"
        class="back-btn modern-back-btn"
        type="button"
      >
        →
      </button>

      <div class="online-modal-badge">
        # كود الجلسة
      </div>

    </div>

    <div class="join-room-modern">

      <div class="join-room-modern-icon">
        #
      </div>

      <div class="join-room-modern-copy">
        <h2>الانضمام إلى روم</h2>

        <p class="modal-description">
          اكتب كود الجلسة المكوّن من 5 أرقام.
        </p>
      </div>

      <label class="room-code-field">
        <span class="room-code-field-label">
          كود الروم
        </span>

        <span class="room-code-input-wrap">
          <span class="room-code-prefix">#</span>

          <input
            id="roomCodeInput"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="5"
            placeholder="12345"
            class="room-code-input"
            autocomplete="one-time-code"
            aria-label="كود الروم"
          >
        </span>
      </label>

      <div class="room-code-help">
        <span>●</span>
        الكود يتكون من 5 أرقام فقط
      </div>

      <button
        id="confirmJoinRoomBtn"
        class="join-room-submit-btn"
        type="button"
      >
        <span>دخول الروم</span>
        <span class="join-room-submit-arrow">←</span>
      </button>

      <p
        id="joinRoomError"
        class="join-room-error"
      ></p>

    </div>
  `

  const input =
    document.querySelector(
      '#roomCodeInput'
    )

  input?.focus()

  input?.addEventListener(
    'input',
    () => {
      input.value =
        input.value
          .replace(/\D/g, '')
          .slice(0, 5)
    }
  )

  input?.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Enter') {
        joinOnlineRoom()
      }
    }
  )

  document
    .querySelector('#joinBackBtn')
    .addEventListener(
      'click',
      showOnlineMenu
    )

  document
    .querySelector('#confirmJoinRoomBtn')
    .addEventListener(
      'click',
      joinOnlineRoom
    )
}


// ========================================
// دخول روم
// ========================================

function joinOnlineRoom() {
  const input =
    document.querySelector(
      '#roomCodeInput'
    )

  const error =
    document.querySelector(
      '#joinRoomError'
    )

  const code =
    input.value
      .trim()

  if (!/^\d{5}$/.test(code)) {
    error.textContent =
      'اكتب كود من 5 أرقام'

    return
  }

  if (!socket.connected) {
    socket.connect()
  }

  socket.emit(
    'join-room',
    code,
    playerProfile.name,
    response => {
      if (!response?.success) {
        error.textContent =
          response?.message ||
          'تعذر دخول الروم'

        return
      }

      onlineRoomCode = response.code
      onlinePlayerColor = response.color
      onlineMode = true
      onlineOpponentConnected = true
      onlineOpponentRating = null
      onlineOpponentName = response.opponentName || 'صديقك'
      if(response.settings) onlineRoomSettings=response.settings
      currentLevel = 'online'

      error.textContent = ''

      startOnlineGame()
    }
  )
}


// ========================================
// بدء مباراة الأونلاين
// ========================================

function startOnlineGame() {
  stopImpossibleWorker()
  stopKhaledWorker()
  resetMatchTimer()

  currentLevel = 'online'
  currentTurn = 'cream'
  selectedPiece = null
  mustContinueCapture = false
  gameOver = false
  currentGameMoves = 0
  currentGameRecorded = false

  const localColor =
    onlinePlayerColor || 'cream'

  const opponentColor =
    getOppositeColor(localColor)

  const localPieceClass =
    localColor === 'cream'
      ? 'cream-player'
      : 'black-player'

  const opponentPieceClass =
    opponentColor === 'cream'
      ? 'cream-player'
      : 'black-player'

  const localClockId =
    localColor === 'cream'
      ? 'creamClock'
      : 'blackClock'

  const opponentClockId =
    opponentColor === 'cream'
      ? 'creamClock'
      : 'blackClock'

  document.querySelector('#app').innerHTML = `
    <main class="game-page">

      <div class="game-header">

        <button
          id="exitGameBtn"
          class="exit-game-btn"
        >
          خروج
        </button>

        <div class="game-info">
          <h2>الدامة</h2>
          <p>
            أونلاين • كود الجلسة
            <strong id="onlineRoomCodeText">
              ${onlineRoomCode}
            </strong>
          </p>
        </div>

      </div>

      <div class="game-status-strip">
        <div class="match-timer-card">
          <span class="match-timer-icon">⏱</span>

          <div class="match-timer-copy">
            <small>مدة المباراة</small>
            <strong id="matchTimer">00:00</strong>
          </div>
        </div>

      <div class="turn-box">
          <span
            id="turnPiece"
            class="turn-piece"
          ></span>

          <span id="turnText">
            جاري تجهيز المباراة...
          </span>
        </div>
      </div>

      <div
        id="computerPlayer"
        class="player online-player-card online-opponent-player"
      >
        <span class="player-piece ${opponentPieceClass}"></span>

        <div>
          <strong id="onlineOpponentName">صديقك</strong>
        </div>

        <strong id="${opponentClockId}" class="player-clock" hidden>00:00</strong>
      </div>

      <div id="board" class="board"></div>

      <div class="players online-own-player">
        <div
          id="humanPlayer"
          class="player online-player-card"
        >
          <span class="player-piece ${localPieceClass}"></span>

          <div>
            <strong>${playerProfile.name}</strong>
          </div>

          <strong id="${localClockId}" class="player-clock" hidden>00:00</strong>
        </div>
      </div>

    </main>
  `

  const opponentNameLabel =
    document.querySelector('#onlineOpponentName')

  if (opponentNameLabel) {
    opponentNameLabel.textContent = onlineOpponentName
  }

  createBoard()

  // كل لاعب يشوف قطعه من أسفل الرقعة بدون تدوير الرقعة نفسها.
  // صاحب الروم (الحليبي) يبقى بالاتجاه الطبيعي،
  // والمنضم (الأسود) نعكس ترتيب المربعات بصريًا فقط.
  orientOnlineBoardForLocalPlayer()

  document
    .querySelector('#exitGameBtn')
    .addEventListener(
      'click',
      exitCurrentGameAsLoss
    )

  updatePlayerHighlight()
  updateOnlineTurnUI()
  renderOnlineClocks()

  if (onlineOpponentConnected) {
    startMatchTimer()
  }
  else {
    resetMatchTimer()
  }
}


// ========================================
// اتجاه الرقعة لكل لاعب أونلاين
// ========================================

function orientOnlineBoardForLocalPlayer() {
  const board =
    document.querySelector('#board')

  if (!board) return

  board.classList.remove(
    'board-black-view',
    'board-flipped'
  )

  // الحليبي موجود أصلًا أسفل الرقعة بالترتيب الطبيعي.
  if (
    !onlineMode ||
    onlinePlayerColor !== 'black'
  ) {
    return
  }

  // الأسود يبدأ في الصفوف العلوية منطقيًا.
  // نعكس ترتيب عناصر المربعات فقط حتى تظهر قطعه أسفل شاشته،
  // مع بقاء data-row / data-col كما هي، لذلك قوانين اللعب لا تتغير.
  const squares =
    Array.from(board.children)

  squares
    .reverse()
    .forEach(square => {
      board.appendChild(square)
    })

  board.classList.add(
    'board-black-view'
  )
}


// ========================================
// تحديث النص والدور في الأونلاين
// ========================================

function updateOnlineTurnUI() {
  if (!onlineMode) return

  const turnText =
    document.querySelector('#turnText')

  if (!turnText) return

  if (!onlineOpponentConnected) {
   turnText.innerHTML = `
  <span class="waiting-label">
    بانتظار صديقك
  </span>

  <span class="waiting-room-code">
    ${onlineRoomCode}
  </span>
`
    updatePlayerHighlight()
    return
  }

  if (currentTurn === onlinePlayerColor) {
    turnText.textContent = 'دورك'
  }

  else {
    turnText.textContent = ''
  }

  updatePlayerHighlight()
}


function getOppositeColor(color) {
  return color === 'cream'
    ? 'black'
    : 'cream'
}


// ========================================
// مغادرة الروم
// ========================================

function leaveOnlineRoom() {
  if (
    onlineMode &&
    onlineRoomCode
  ) {
    // السيرفر الحديث يتعامل مع leave-room مباشرة.
    socket.emit('leave-room')

    // فصل الاتصال بعد الإرسال يخلي حتى نسخة السيرفر القديمة
    // ترسل player-left للخصم عن طريق حدث disconnect.
    // عند إنشاء/دخول روم جديد نعيد الاتصال تلقائيًا.
    socket.disconnect()
  }

  onlineRoomCode = null
  onlinePlayerColor = null
  onlineMode = false
  onlineOpponentConnected = false
  onlineOpponentRating = null
}


// ========================================
// اختيار حجر اللاعب أونلاين
// ========================================

function selectOnlinePiece(piece) {
  if (gameOver) return
  if (!onlineOpponentConnected) return

  if (
    currentTurn !== onlinePlayerColor ||
    piece.dataset.color !== onlinePlayerColor
  ) {
    return
  }

  if (
    mustContinueCapture &&
    selectedPiece &&
    selectedPiece !== piece
  ) {
    showForcedCaptureHint(
      onlinePlayerColor,
      selectedPiece
    )
    return
  }

  const captures =
    getCaptureMoves(piece)

  if (
    hasAnyCapture(onlinePlayerColor) &&
    captures.length === 0
  ) {
    showForcedCaptureHint(
      onlinePlayerColor
    )
    return
  }

  clearHighlights()
  selectedPiece = piece

  // إزالة أي تحديد قديم قبل وضع التحديد الجديد
  document.querySelectorAll('.selected-piece')
    .forEach(p => p.classList.remove('selected-piece'))

  piece.classList.add(
    'selected-piece'
  )

  socket.emit('piece-selected', {
    row: Number(piece.parentElement.dataset.row),
    col: Number(piece.parentElement.dataset.col)
  })

  if (captures.length > 0) {
    captures.forEach(showPlayerMove)
    return
  }

  getNormalMoves(piece)
    .forEach(showPlayerMove)
}


// ========================================
// تنفيذ حركة اللاعب أونلاين
// ========================================

function moveSelectedPieceOnline(square) {
  if (gameOver) return
  if (!onlineOpponentConnected) return

  if (
    currentTurn !== onlinePlayerColor ||
    !selectedPiece ||
    selectedPiece.dataset.color !==
      onlinePlayerColor
  ) {
    return
  }

  if (
    !square.classList.contains(
      'possible-move'
    )
  ) {
    return
  }

  const piece = selectedPiece
  
  const fromSquare = piece.parentElement

  const fromRow =
    Number(fromSquare.dataset.row)

  const fromCol =
    Number(fromSquare.dataset.col)

  const row =
    Number(square.dataset.row)

  const col =
    Number(square.dataset.col)

  const captured =
    square.dataset.capture === 'true'

  const capturedRow = captured
    ? Number(square.dataset.capturedRow)
    : null

  const capturedCol = captured
    ? Number(square.dataset.capturedCol)
    : null

  const wasKing =
    piece.dataset.king === 'true'

  if (captured) {
    const capturedPiece =
      getPieceAt(
        capturedRow,
        capturedCol
      )

    if (capturedPiece) {
      capturedPiece.remove()
    }
  }

  square.appendChild(piece)
  playMoveSound()
  promoteIfNeeded(piece)

  currentGameMoves++

  const isKingNow =
    piece.dataset.king === 'true'

  const justBecameKing =
    !wasKing && isKingNow

  let continueCapture = false
  let nextTurn =
    getOppositeColor(
      onlinePlayerColor
    )

  if (
    captured &&
    !justBecameKing
  ) {
    const more =
      getCaptureMoves(piece)

    if (more.length > 0) {
      continueCapture = true
      nextTurn = onlinePlayerColor

      mustContinueCapture = true
      clearHighlights(false)

      piece.classList.add(
        'selected-piece'
      )

      more.forEach(showPlayerMove)

      setTurnText('أكمل الأكل')
    }
  }

  socket.emit(
    'game-move',
    {
      fromRow,
      fromCol,
      row,
      col,
      color: onlinePlayerColor,
      capture: captured,
      capturedRow,
      capturedCol,
      continueCapture,
      nextTurn,
      rating: getPlayerRating()
    }
  )

  if (continueCapture) {
    return
  }

  mustContinueCapture = false
  clearSelection()
  currentTurn = nextTurn

  updatePlayerHighlight()

  if (checkGameStatus()) {
    return
  }

  updateOnlineTurnUI()
}


// ========================================
// تطبيق حركة الخصم القادمة من السيرفر
// ========================================

function applyRemoteOnlineMove(move) {
  if (
    !onlineMode ||
    gameOver ||
    !move
  ) {
    return
  }

  if (
    move.rating != null &&
    Number.isFinite(
      Number(move.rating)
    )
  ) {
    onlineOpponentRating =
      normalizeRating(move.rating)
  }

  const fromRow = Number(move.fromRow)
  const fromCol = Number(move.fromCol)
  const row = Number(move.row)
  const col = Number(move.col)

  const piece =
    getPieceAt(
      fromRow,
      fromCol
    )

  const target =
    getSquare(row, col)

  if (
    !piece ||
    !target ||
    piece.dataset.color !== move.color
  ) {
    console.error(
      'تعذر تطبيق حركة الخصم:',
      move
    )

    return
  }

  if (move.capture) {
    const capturedPiece =
      getPieceAt(
        Number(move.capturedRow),
        Number(move.capturedCol)
      )

    if (capturedPiece) {
      capturedPiece.remove()
    }
  }

  target.appendChild(piece)
  playMoveSound()
  promoteIfNeeded(piece)

  clearSelection()
  mustContinueCapture = false

  currentTurn =
    move.nextTurn ||
    getOppositeColor(move.color)

  updatePlayerHighlight()

  if (checkGameStatus()) {
    return
  }

  updateOnlineTurnUI()
}

// ========================================
// اختيار الصعوبة
// ========================================

function showDifficulty() {
  const modalBox = document.querySelector('.modal-box')

  modalBox.innerHTML = `
    <button id="backBtn" class="back-btn">→</button>

    <h2 class="ai-title">♛ ضد الكمبيوتر</h2>

    <p class="modal-description">
      اختر مستوى الصعوبة
    </p>

    <div class="difficulty-options ai-difficulty-grid">

      <button class="difficulty-btn" data-level="easy">
        <span class="difficulty-title">سهل</span>
        <span class="difficulty-description">
          مناسب لتعلم اللعبة
        </span>
      </button>

      <button class="difficulty-btn" data-level="medium">
        <span class="difficulty-title">متوسط</span>
        <span class="difficulty-description">
          تحدي متوازن
        </span>
      </button>

      <button class="difficulty-btn" data-level="hard">
        <span class="difficulty-title">صعب</span>
        <span class="difficulty-description">
          خصم يفكر في خطواته
        </span>
      </button>
      <button class="difficulty-btn" data-level="impossible">
  <span class="difficulty-title">☠️ أتحداك تفوز</span>

  <span class="difficulty-description">
    ذكاء خارق • يفكر بعمق شديد
  </span>
</button>

<button class="difficulty-btn khaled-difficulty-btn" data-level="khaled">
  <span class="difficulty-title">🛡️ خالد</span>

  <span class="difficulty-description">
    المتصدر الأعلى وفوق الجميع ويعلو الممالك
  </span>
</button>

    </div>
  `

  document
    .querySelector('#backBtn')
    .addEventListener('click', () => {
      showHome()

      setTimeout(() => {
        document
          .querySelector('#gameModal')
          .classList.add('show')
      }, 0)
    })

  document
    .querySelectorAll('.difficulty-btn')
    .forEach((button) => {
      button.addEventListener('click', () => {
        startGame(button.dataset.level)
      })
    })
}

function getLevelName(level) {
  if (level === 'easy') return 'سهل'

  if (level === 'medium') {
    return 'متوسط'
  }

  if (level === 'hard') {
    return 'صعب'
  }

  if (level === 'impossible') {
    return '☠️ أتحداك تفوز'
  }

  if (level === 'khaled') {
    return '🛡️ خالد'
  }

  if (level === 'online') {
    return 'أونلاين'
  }

  return ''
}

// ========================================
// الخروج من مباراة جارية = خسارة
// ========================================

async function exitCurrentGameAsLoss() {

  // الأونلاين: الانسحاب يحتسب خسارة فورًا
  // ويصل للخصم حدث الخروج فيظهر له أنه فاز بالانسحاب.
  if (currentLevel === 'online') {
    const shouldRecordOnlineLoss =
      onlineMode &&
      onlineOpponentConnected &&
      !gameOver &&
      !currentGameRecorded

    if (shouldRecordOnlineLoss) {
      gameOver = true
      stopImpossibleWorker()
      stopKhaledWorker()
      stopMatchTimer(true)

      // التحديث المحلي للتصنيف والإحصائيات يحصل مباشرة،
      // والحفظ السحابي يكمل بدون تعطيل شاشة الخروج.
      recordGameResult(
        false,
        {
          forfeited: true
        }
      )
    }

    if (onlineMode) {
      leaveOnlineRoom()
    }

    showHome()
    return
  }

  // ضد الذكاء: الخروج يحتسب خسارة في الإحصائيات فقط.
  const shouldRecordLoss =
    !gameOver &&
    !currentGameRecorded &&
    currentLevel

  if (shouldRecordLoss) {

    gameOver = true
    stopImpossibleWorker()
    stopKhaledWorker()
    stopMatchTimer(true)

    await recordGameResult(
      false,
      {
        forfeited: true
      }
    )
  }

  showHome()
}


// ========================================
// بدء اللعبة
// ========================================

function startGame(level) {
  if (onlineMode) {
    leaveOnlineRoom()
  }

  stopImpossibleWorker()
  stopKhaledWorker()
  resetMatchTimer()

  currentLevel = level
  currentTurn = 'cream'
  selectedPiece = null
  mustContinueCapture = false
  gameOver = false
currentGameMoves = 0
currentGameRecorded = false

  document.querySelector('#app').innerHTML = `
    <main class="game-page">

      <div class="game-header">

        <button id="exitGameBtn" class="exit-game-btn">
          خروج
        </button>

        <div class="game-info">
          <h2>الدامة</h2>
          <p>
            ضد الكمبيوتر • ${getLevelName(level)}
          </p>
        </div>

      </div>

      <div class="game-status-strip">
        <div class="match-timer-card">
          <span class="match-timer-icon">⏱</span>

          <div class="match-timer-copy">
            <small>مدة المباراة</small>
            <strong id="matchTimer">00:00</strong>
          </div>
        </div>

        <div id="onlineClockContainer"></div>
      <div class="turn-box">
          <span
            id="turnPiece"
            class="turn-piece cream-turn"
          ></span>

          <span id="turnText">
            دورك
          </span>
        </div>
      </div>

      <div id="board" class="board"></div>

      <div class="players">

        <div
          id="humanPlayer"
          class="player active-player"
        >
          <span class="player-piece cream-player"></span>

          <div>
            <strong>أنت</strong>
            <small>الحليبي</small>
          </div>
        </div>

        <div class="vs">VS</div>

        <div
          id="computerPlayer"
          class="player"
        >
          <span class="player-piece black-player"></span>

          <div>
            <strong>الكمبيوتر</strong>
            <small>${getLevelName(level)}</small>
          </div>
        </div>

      </div>

    </main>
  `

  createBoard()
  startMatchTimer()

  document
    .querySelector('#exitGameBtn')
    .addEventListener(
      'click',
      exitCurrentGameAsLoss
    )
}

// ========================================
// إنشاء الرقعة
// ========================================

function createBoard() {
  const board = document.querySelector('#board')

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement('div')

      square.classList.add('square')

      square.dataset.row = row
      square.dataset.col = col

      const dark = (row + col) % 2 === 1

      square.classList.add(
        dark
          ? 'dark-square'
          : 'light-square'
      )

      // الأسود
      if (dark && row < 3) {
        square.appendChild(
          createPiece('black')
        )
      }

      // الحليبي
      if (dark && row > 4) {
        square.appendChild(
          createPiece('cream')
        )
      }

      square.addEventListener('click', () => {
        moveSelectedPiece(square)
      })

      board.appendChild(square)
    }
  }
}

// ========================================
// إنشاء حجر
// ========================================

function createPiece(color) {
  const piece = document.createElement('div')

  piece.classList.add(
    'checker-piece',
    color === 'cream'
      ? 'cream-checker'
      : 'black-checker'
  )

  piece.dataset.color = color
  piece.dataset.king = 'false'

  if (
    color === 'cream' ||
    onlineMode
  ) {
    piece.addEventListener(
      'click',
      event => {
        event.stopPropagation()
        selectPiece(piece)
      }
    )
  }

  return piece
}

// ========================================
// الحصول على خانة
// ========================================

function getSquare(row, col) {
  if (
    row < 0 ||
    row > 7 ||
    col < 0 ||
    col > 7
  ) {
    return null
  }

  return document.querySelector(
    `.square[data-row="${row}"][data-col="${col}"]`
  )
}

// ========================================
// الحصول على حجر
// ========================================

function getPieceAt(row, col) {
  const square = getSquare(row, col)

  if (!square) return null

  return square.querySelector(
    '.checker-piece'
  )
}

// ========================================
// الحركات العادية
// ========================================

function getNormalMoves(piece) {
  const moves = []

  const square = piece.parentElement

  const row = Number(square.dataset.row)
  const col = Number(square.dataset.col)

  const color = piece.dataset.color
  const king = piece.dataset.king === 'true'

  // ========================================
  // الملك الطائر
  // يتحرك أي مسافة على القطر
  // ========================================

  if (king) {
    const directions = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ]

    directions.forEach(([dr, dc]) => {
      let newRow = row + dr
      let newCol = col + dc

      while (true) {
        const target =
          getSquare(
            newRow,
            newCol
          )

        // خرجنا من الرقعة
        if (!target) {
          break
        }

        // وجدنا حجرًا
        // لا نستطيع المرور من خلاله
        if (
          getPieceAt(
            newRow,
            newCol
          )
        ) {
          break
        }

        // الخانة فاضية
        moves.push({
          row: newRow,
          col: newCol,
          capture: false
        })

        // نكمل على نفس القطر
        newRow += dr
        newCol += dc
      }
    })

    return moves
  }

  // ========================================
  // الحجر العادي
  // ========================================

  const directions =
    color === 'cream'
      ? [
          [-1, -1],
          [-1, 1]
        ]
      : [
          [1, -1],
          [1, 1]
        ]

  directions.forEach(([dr, dc]) => {
    const newRow = row + dr
    const newCol = col + dc

    const target =
      getSquare(
        newRow,
        newCol
      )

    if (
      target &&
      !getPieceAt(
        newRow,
        newCol
      )
    ) {
      moves.push({
        row: newRow,
        col: newCol,
        capture: false
      })
    }
  })

  return moves
}

// ========================================
// حركات الأكل
// ========================================

function getCaptureMoves(piece) {
  const moves = []

  const square = piece.parentElement

  const row = Number(
    square.dataset.row
  )

  const col = Number(
    square.dataset.col
  )

  const color =
    piece.dataset.color

  const isKing =
    piece.dataset.king === 'true'

  // ========================================
  // الملك
  // يرى الخصم من بعيد
  // لكن يهبط مربع واحد فقط بعده
  // ========================================

  if (isKing) {
    const directions = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ]

    for (const [dr, dc] of directions) {
      let checkRow = row + dr
      let checkCol = col + dc

      // نبحث على طول القطر
      while (
        checkRow >= 0 &&
        checkRow < 8 &&
        checkCol >= 0 &&
        checkCol < 8
      ) {
        const targetPiece =
          getPieceAt(
            checkRow,
            checkCol
          )

        // خانة فاضية قبل الخصم
        // نكمل البحث
        if (!targetPiece) {
          checkRow += dr
          checkCol += dc
          continue
        }

        // حجر من نفس اللون
        // يسكر الطريق
        if (
          targetPiece.dataset.color ===
          color
        ) {
          break
        }

        // ========================================
        // لقينا حجر خصم
        // الهبوط يكون أول مربع بعده فقط
        // ========================================

        const landingRow =
          checkRow + dr

        const landingCol =
          checkCol + dc

        const landingSquare =
          getSquare(
            landingRow,
            landingCol
          )

        // إذا ما فيه مربع بعد الخصم
        if (!landingSquare) {
          break
        }

        // إذا أول مربع بعد الخصم مشغول
        // ما نقدر نأكل
        if (
          getPieceAt(
            landingRow,
            landingCol
          )
        ) {
          break
        }

        // أكلة قانونية واحدة فقط
        moves.push({
          row: landingRow,
          col: landingCol,

          capture: true,

          capturedRow: checkRow,
          capturedCol: checkCol
        })

        // لا نضيف مربعات أبعد
        break
      }
    }

    return moves
  }

  // ========================================
  // الحجر العادي
  // الأكل للأمام فقط
  // ========================================

  const directions =
    color === 'cream'
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

    const enemy =
      getPieceAt(
        enemyRow,
        enemyCol
      )

    const landing =
      getSquare(
        landingRow,
        landingCol
      )

    if (!enemy || !landing) {
      continue
    }

    if (
      enemy.dataset.color ===
      color
    ) {
      continue
    }

    if (
      getPieceAt(
        landingRow,
        landingCol
      )
    ) {
      continue
    }

    moves.push({
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
// هل لدى اللون أكل؟
// ========================================

function hasAnyCapture(color) {
  const pieces =
    document.querySelectorAll(
      `.checker-piece[data-color="${color}"]`
    )

  for (const piece of pieces) {
    if (
      getCaptureMoves(piece).length > 0
    ) {
      return true
    }
  }

  return false
}

// ========================================
// جميع الحركات القانونية للون
// ========================================

function getAllMoves(color) {
  const pieces = [
    ...document.querySelectorAll(
      `.checker-piece[data-color="${color}"]`
    )
  ]

  const captureMoves = []

  // الأكل أولًا
  pieces.forEach((piece) => {
    getCaptureMoves(piece)
      .forEach((move) => {
        captureMoves.push({
          piece,
          ...move
        })
      })
  })

  // إذا فيه أكل فهو إجباري
  if (captureMoves.length > 0) {
    return captureMoves
  }

  const normalMoves = []

  pieces.forEach((piece) => {
    getNormalMoves(piece)
      .forEach((move) => {
        normalMoves.push({
          piece,
          ...move
        })
      })
  })

  return normalMoves
}

// ========================================
// اختيار حجر اللاعب
// ========================================

function selectPiece(piece) {
  if (onlineMode) {
    selectOnlinePiece(piece)
    return
  }

  if (gameOver) return

  // ليس دور اللاعب
  if (currentTurn !== 'cream') {
    return
  }

  if (
    mustContinueCapture &&
    selectedPiece &&
    selectedPiece !== piece
  ) {
    showForcedCaptureHint(
      'cream',
      selectedPiece
    )
    return
  }

  const captures =
    getCaptureMoves(piece)

  // إذا يوجد أكل إجباري بحجر آخر
  if (
    hasAnyCapture('cream') &&
    captures.length === 0
  ) {
    showForcedCaptureHint('cream')
    return
  }

  clearHighlights()
  piece.classList.add("selected-piece")

  selectedPiece = piece

  piece.classList.add(
    'selected-piece'
  )
  piece.classList.add(
    'piece-picked'
  )

  // إذا هذا الحجر عنده أكل
  // نظهر الأكل فقط
  if (captures.length > 0) {
    captures.forEach(showPlayerMove)
    return
  }

  // لا يوجد أكل
  // نظهر الحركة العادية
  getNormalMoves(piece)
    .forEach(showPlayerMove)
}

// ========================================
// إظهار حركة اللاعب على الرقعة
// ========================================

function showPlayerMove(move) {
  const square =
    getSquare(
      move.row,
      move.col
    )

  if (!square) {
    return
  }

  // نحدد الخانة كحركة ممكنة
  square.classList.add(
    'possible-move'
  )

  // هل الحركة أكل؟
  if (move.capture) {
    square.classList.add(
      'capture-move'
    )

    square.dataset.capture =
      'true'

    square.dataset.capturedRow =
      move.capturedRow

    square.dataset.capturedCol =
      move.capturedCol
  }

  else {
    square.dataset.capture =
      'false'

    delete square.dataset.capturedRow
    delete square.dataset.capturedCol
  }
}

// ========================================
// حركة اللاعب
// ========================================

function moveSelectedPiece(square) {
  if (onlineMode) {
    moveSelectedPieceOnline(square)
    return
  }

  if (gameOver) return

  if (currentTurn !== 'cream') {
    return
  }

  if (!selectedPiece) return

  if (
    !square.classList.contains(
      'possible-move'
    )
  ) {
    return
  }
// تسجيل حركة اللاعب
  currentGameMoves++
  const captured =
    square.dataset.capture === 'true'

  // هل كان ملك قبل الحركة؟
  const wasKing =
    selectedPiece.dataset.king === 'true'

  // حذف الحجر المأكول
  if (captured) {
    const capturedPiece =
      getPieceAt(
        Number(
          square.dataset.capturedRow
        ),
        Number(
          square.dataset.capturedCol
        )
      )

    if (capturedPiece) {
      capturedPiece.remove()
    }
  }

  // تحريك الحجر
  square.appendChild(
  selectedPiece
)

playMoveSound()

  // ترقية الحجر إذا وصل آخر صف
  promoteIfNeeded(
    selectedPiece
  )

  const isKingNow =
    selectedPiece.dataset.king === 'true'

  const justBecameKing =
    !wasKing && isKingNow

  // ========================================
  // إذا صار ملك الآن
  // تنتهي حركته فورًا
  // ولا يكمل أي أكل في نفس الدور
  // ========================================

  if (justBecameKing) {
    mustContinueCapture = false

    clearSelection()

    if (checkGameStatus()) {
      return
    }

    startComputerTurn()
    return
  }

  // ========================================
  // الأكل المتعدد
  // فقط إذا لم يترقَّ إلى ملك الآن
  // ========================================

  if (captured) {
    const more =
      getCaptureMoves(
        selectedPiece
      )

    if (more.length > 0) {
      mustContinueCapture = true

      clearHighlights(false)

      selectedPiece.classList.add(
        'selected-piece'
      )

      more.forEach(
        showPlayerMove
      )

      setTurnText(
        'أكمل الأكل'
      )

      return
    }
  }

  // انتهاء الدور
  mustContinueCapture = false

  clearSelection()

  if (checkGameStatus()) {
    return
  }

  startComputerTurn()
}

// ========================================
// سرعة حركة الكمبيوتر
// تأخير خفيف حتى تكون الحركة طبيعية وواضحة
// ========================================

const COMPUTER_MOVE_DELAY = 800
const COMPUTER_CAPTURE_DELAY = 650
const COMPUTER_PREVIEW_DELAY = 850

// ========================================
// بدء دور الكمبيوتر
// ========================================

function startComputerTurn() {
  currentTurn = 'black'

  setTurnText('')

  updatePlayerHighlight()

  // تأخير خفيف قبل حركة الكمبيوتر
  setTimeout(() => {
    computerMove()
  }, COMPUTER_MOVE_DELAY)
}

// ========================================
// حركة الكمبيوتر
// ========================================

function computerMove() {
  if (gameOver) return

  const moves = getAllMoves('black')

  // الكمبيوتر فعلًا ما عنده أي حركة
  if (moves.length === 0) {
    finishGame(
      'فزت! الكمبيوتر لا يملك أي حركة 👑'
    )
    return
  }

  // ========================================
  // ☠️ أتحداك تفوز
  // نشغله في Worker حتى ما تتجمد الصفحة
  // ========================================

  if (currentLevel === "impossible") {
    executeComputerMove(chooseHardMove(moves))
    return
}

  // ========================================
  // 🛡️ خالد
  // أبطأ وأعمق من مستوى أتحداك تفوز ويعمل داخل Worker
  // ========================================

  if (currentLevel === 'khaled') {
    startKhaledComputerMove(moves)
    return
  }

  // باقي المستويات
  const chosen =
    chooseComputerMove(moves)

  // حماية إضافية: لا يعلق دور الكمبيوتر بدون حركة
  if (!chosen) {
    executeComputerMove(moves[0])
    return
  }

  executeComputerMove(chosen)
}

// ========================================
// اختيار حركة الكمبيوتر
// ========================================


  // ========================================
// ☠️ تشغيل مستوى أتحداك تفوز
// ========================================

function startImpossibleComputerMove(moves) {
  // نقفل أي Worker قديم
  stopImpossibleWorker()

  setTurnText('')

  const startedAt = performance.now()

  // ========================================
  // عداد وقت التفكير
  // ========================================

  impossibleThinkTimer = setInterval(() => {
    if (
      gameOver ||
      currentTurn !== 'black'
    ) {
      return
    }

    const seconds = Math.floor(
      (
        performance.now() -
        startedAt
      ) / 1000
    )

    setTurnText(
      `${seconds}`
    )
  }, 1000)

  // ========================================
  // إنشاء الـ Worker
  // ========================================

  impossibleWorker = new Worker(
    new URL(
      './impossible-worker.js',
      import.meta.url
    ),
    {
      type: 'module'
    }
  )

  // ========================================
  // استقبال النتيجة من الذكاء
  // ========================================

  impossibleWorker.onmessage = (event) => {
    const data = event.data || {}

    // الذكاء ما زال يفكر
    if (data.type === 'progress') {
      if (
        !gameOver &&
        currentTurn === 'black'
      ) {
        setTurnText('')
      }

      return
    }

    // نتجاهل أي رسالة غير النتيجة
    if (data.type !== 'result') {
      return
    }

    stopImpossibleWorker()

    // يمكن اللاعب خرج من المباراة
    // أثناء تفكير الكمبيوتر
    if (
      gameOver ||
      currentTurn !== 'black'
    ) {
      return
    }

    const steps =
      Array.isArray(data.steps)
        ? data.steps
        : []

    // ========================================
    // حماية من نتيجة فارغة
    // ========================================

    if (steps.length === 0) {
      console.error(
        'Impossible AI returned no move:',
        data
      )

      // نتحقق من الرقعة الحقيقية
      const freshMoves =
        getAllMoves('black')

      if (freshMoves.length === 0) {
        finishGame(
          'فزت! الكمبيوتر لا يملك أي حركة 👑'
        )

        return
      }

      // إذا الـWorker أخطأ
      // نستخدم مستوى صعب كخطة احتياط
      const fallback =
        chooseHardMove(freshMoves)

      executeComputerMove(fallback)

      return
    }

    // ========================================
    // تنفيذ الدور الذي اختاره الذكاء
    // ========================================

    executeImpossibleTurn(
      steps,
      0
    )
  }

  // ========================================
  // لو صار خطأ في الـ Worker
  // ========================================

  impossibleWorker.onerror = (error) => {
    console.error(
      'Impossible Worker error:',
      error
    )

    stopImpossibleWorker()

    if (
      gameOver ||
      currentTurn !== 'black'
    ) {
      return
    }

    // نتأكد من الرقعة الحقيقية
    const freshMoves =
      getAllMoves('black')

    if (freshMoves.length === 0) {
      finishGame(
        'فزت! الكمبيوتر لا يملك أي حركة 👑'
      )

      return
    }

    // نرجع للصعب بدل تعليق اللعبة
    const fallback =
      chooseHardMove(freshMoves)

    executeComputerMove(fallback)
  }

  // ========================================
  // إرسال الرقعة للذكاء
  // الحد الأقصى 3 دقائق
  // ========================================

  impossibleWorker.postMessage({
    type: 'think',

    board:
      createAIBoard(),

    maxTimeMs:
      180000
  })
}


// ========================================
// إيقاف Worker
// ========================================

function stopImpossibleWorker() {
  // إيقاف عداد التفكير
  if (impossibleThinkTimer) {
    clearInterval(
      impossibleThinkTimer
    )

    impossibleThinkTimer = null
  }

  // إيقاف الذكاء
  if (impossibleWorker) {
    impossibleWorker.terminate()

    impossibleWorker = null
  }
}


// ========================================
// 🛡️ تشغيل مستوى خالد
// ========================================

function startKhaledComputerMove(moves) {
  stopKhaledWorker()

  setTurnText('')

  const startedAt =
    performance.now()

  khaledWorker =
    new Worker(
      new URL(
        './khaled-worker.js',
        import.meta.url
      ),
      {
        type: 'module'
      }
    )

  khaledWorker.onmessage =
    event => {
      const data =
        event.data || {}

      if (data.type === 'progress') {
        if (
          !gameOver &&
          currentTurn === 'black'
        ) {
          setTurnText('')
        }

        return
      }

      if (data.type !== 'result') {
        return
      }

      const elapsed =
        performance.now() -
        startedAt

      stopKhaledWorker()

      if (
        gameOver ||
        currentTurn !== 'black'
      ) {
        return
      }

      const steps =
        Array.isArray(data.steps)
          ? data.steps
          : []

      if (steps.length === 0) {
        console.error(
          'Khaled AI returned no move:',
          data
        )

        const freshMoves =
          getAllMoves('black')

        if (freshMoves.length === 0) {
          finishGame(
            'فزت! خالد لا يملك أي حركة 👑'
          )
          return
        }

        const fallback =
          chooseHardMove(
            freshMoves
          )

        const remaining =
          Math.max(
            0,
            KHALED_MIN_THINK_MS -
              elapsed
          )

        setTurnText('')

        khaledMoveDelayTimer =
          setTimeout(
            () => {
              khaledMoveDelayTimer = null

              if (
                gameOver ||
                currentTurn !== 'black'
              ) {
                return
              }

              executeComputerMove(
                fallback
              )
            },
            remaining
          )

        return
      }

      const remaining =
        Math.max(
          0,
          KHALED_MIN_THINK_MS -
            elapsed
        )

      setTurnText('')

      khaledMoveDelayTimer =
        setTimeout(
          () => {
            khaledMoveDelayTimer = null

            if (
              gameOver ||
              currentTurn !== 'black'
            ) {
              return
            }

            executeImpossibleTurn(
              steps,
              0
            )
          },
          remaining
        )
    }

  khaledWorker.onerror =
    error => {
      console.error(
        'Khaled Worker error:',
        error
      )

      const elapsed =
        performance.now() -
        startedAt

      stopKhaledWorker()

      if (
        gameOver ||
        currentTurn !== 'black'
      ) {
        return
      }

      const freshMoves =
        getAllMoves('black')

      if (freshMoves.length === 0) {
        finishGame(
          'فزت! خالد لا يملك أي حركة 👑'
        )
        return
      }

      const fallback =
        chooseHardMove(
          freshMoves
        )

      const remaining =
        Math.max(
          0,
          KHALED_MIN_THINK_MS -
            elapsed
        )

      setTurnText('')

      khaledMoveDelayTimer =
        setTimeout(
          () => {
            khaledMoveDelayTimer = null

            if (
              gameOver ||
              currentTurn !== 'black'
            ) {
              return
            }

            executeComputerMove(
              fallback
            )
          },
          remaining
        )
    }

  khaledWorker.postMessage({
    type: 'think',

    board:
      createAIBoard(),

    // أول عدة أدوار فقط تستخدم لتنويع الافتتاحية
    // بين حركات متقاربة جدًا بالقوة.
    moveNumber:
      currentGameMoves,

    // الحد الأعلى عشر دقائق للحركة الواحدة.
    maxTimeMs:
      2000
  })
}


// ========================================
// إيقاف Worker خالد
// ========================================

function stopKhaledWorker() {
  if (khaledMoveDelayTimer) {
    clearTimeout(
      khaledMoveDelayTimer
    )

    khaledMoveDelayTimer = null
  }

  if (khaledWorker) {
    khaledWorker.terminate()

    khaledWorker = null
  }
}


// ========================================
// تنفيذ الدور الكامل للذكاء
// ========================================

function executeImpossibleTurn(
  steps,
  index
) {
  if (gameOver) return

  if (currentTurn !== 'black') {
    return
  }

  // انتهت كل خطوات الدور
  if (index >= steps.length) {
    endComputerTurn()
    return
  }

  const step =
    steps[index]

  // ========================================
  // إيجاد الحجر الحقيقي
  // ========================================

  const piece =
    getPieceAt(
      step.fromRow,
      step.fromCol
    )

  if (
    !piece ||
    piece.dataset.color !== 'black'
  ) {
    console.error(
      'تعذر إيجاد حجر الكمبيوتر:',
      step
    )

    endComputerTurn()
    return
  }

  // هل كان ملكًا قبل الحركة؟
  const wasKing =
    piece.dataset.king === 'true'

  // ========================================
  // حذف الحجر المأكول
  // ========================================

  if (step.capture) {
    const capturedPiece =
      getPieceAt(
        step.capturedRow,
        step.capturedCol
      )

    if (capturedPiece) {
      capturedPiece.remove()
    }
  }

  // ========================================
  // الخانة الجديدة
  // ========================================

  const target =
    getSquare(
      step.row,
      step.col
    )

  if (!target) {
    console.error(
      'الخانة غير موجودة:',
      step
    )

    endComputerTurn()
    return
  }

  // تحريك الحجر
  target.appendChild(piece)
  playMoveSound()

  // ترقية إذا وصل للنهاية
  promoteIfNeeded(piece)

  const isKingNow =
    piece.dataset.king === 'true'

  const justBecameKing =
    !wasKing &&
    isKingNow

  // ========================================
  // فحص نهاية المباراة
  // ========================================

  if (checkGameStatus()) {
    return
  }

  // ========================================
  // قانوننا المهم:
  //
  // إذا كان عادي وصار ملك الآن
  // ينتهي دوره فورًا
  // حتى لو صار عنده أكل جديد
  // ========================================

  if (justBecameKing) {
    endComputerTurn()
    return
  }

  const nextIndex =
    index + 1

  // ========================================
  // أكلة ثانية في نفس الدور
  // ========================================

  if (nextIndex < steps.length) {
    setTurnText(
      ''
    )

    setTimeout(() => {
      executeImpossibleTurn(
        steps,
        nextIndex
      )
    }, COMPUTER_CAPTURE_DELAY)

    return
  }

  // ========================================
  // انتهى دور الكمبيوتر
  // ========================================

  endComputerTurn()
}
function chooseComputerMove(moves) {

  if (currentLevel === "easy") {
    return chooseEasyMove(moves);
  }

  if (currentLevel === "medium") {
    return chooseMediumMove(moves);
  }

  if (currentLevel === "hard") {
    return chooseHardMove(moves);
  }

  return moves[Math.floor(Math.random() * moves.length)];
}


// ========================================
// المستوى السهل
// حركة عشوائية
// ========================================

function chooseEasyMove(moves) {

  const randomIndex =
    Math.floor(
      Math.random() * moves.length
    )

  return moves[randomIndex]
}


// ========================================
// المستوى المتوسط
// يفحص الحركة ويعطيها نقاط
// ========================================

function chooseMediumMove(moves) {

  let bestScore = -Infinity

  let bestMoves = []

  moves.forEach((move) => {

    let score = 0

    const piece = move.piece

    const currentSquare =
      piece.parentElement

    const currentRow =
      Number(
        currentSquare.dataset.row
      )

    const currentCol =
      Number(
        currentSquare.dataset.col
      )


    // ==========================
    // الأكل مهم جدًا
    // ==========================

    if (move.capture) {
      score += 100
    }


    // ==========================
    // الاقتراب من الملك
    // ==========================

    if (
      piece.dataset.king !== 'true'
    ) {

      score += move.row * 8

    }


    // ==========================
    // الوصول إلى الملك
    // ==========================

    if (
      piece.dataset.king !== 'true' &&
      move.row === 7
    ) {

      score += 180

    }


    // ==========================
    // الملك قيمته أعلى
    // ==========================

    if (
      piece.dataset.king === 'true'
    ) {

      score += 45

    }


    // ==========================
    // الوسط أفضل
    // ==========================

    if (
      move.col >= 2 &&
      move.col <= 5
    ) {

      score += 12

    }


    // ==========================
    // الحواف فيها حماية
    // ==========================

    if (
      move.col === 0 ||
      move.col === 7
    ) {

      score += 10

    }


    // ==========================
    // هل الحركة تعرضه للأكل؟
    // ==========================

    if (
      computerMoveLooksDangerous(
        move,
        currentRow,
        currentCol
      )
    ) {

      score -= 80

    }


    // تنويع بسيط جدًا
    score += Math.random() * 10


    if (score > bestScore) {

      bestScore = score

      bestMoves = [move]

    }

    else if (
      Math.abs(
        score - bestScore
      ) < 0.001
    ) {

      bestMoves.push(move)

    }

  })


  return bestMoves[
    Math.floor(
      Math.random() *
      bestMoves.length
    )
  ]
}


// ========================================
// فحص خطر الحركة للمتوسط
// ========================================

function computerMoveLooksDangerous(
  move,
  oldRow,
  oldCol
) {

  const board =
    createAIBoard()

  const piece =
    board[oldRow][oldCol]

  if (!piece) {
    return false
  }


  board[oldRow][oldCol] = null


  if (move.capture) {

    board[
      move.capturedRow
    ][
      move.capturedCol
    ] = null

  }


  const movedPiece = {
    ...piece
  }


  if (
    !movedPiece.king &&
    move.row === 7
  ) {

    movedPiece.king = true

  }


  board[
    move.row
  ][
    move.col
  ] = movedPiece


  const playerMoves =
    getAIMoves(
      board,
      'cream'
    )


  return playerMoves.some(
    (playerMove) => {

      return (
        playerMove.capture &&
        playerMove.capturedRow ===
          move.row &&
        playerMove.capturedCol ===
          move.col
      )

    }
  )
}


// ========================================
// المستوى الصعب
// Minimax + Alpha Beta
// ========================================

function chooseHardMove(moves) {
  const board = createAIBoard()

  // نحسب الدور الكامل، بما فيه سلسلة الأكل المتتالي
  const allTurns = getHardTurns(board, 'black')

  if (allTurns.length === 0) {
    return chooseEasyMove(moves)
  }

  const pieceCount = countHardPieces(board)

  // كلما قلت القطع نسمح له يبحث أعمق
  const maxDepth =
    pieceCount <= 10
      ? 9
      : pieceCount <= 16
        ? 8
        : 7

  // حد زمني حتى ما يعلق المتصفح
  const deadline = performance.now() + 1400

  const table = new Map()

  let bestDomMove = moves[0]
  let completedDepth = 0

  // Iterative Deepening
  // يبدأ ببحث بسيط ثم يزيد العمق
  for (
    let depth = 3;
    depth <= maxDepth;
    depth++
  ) {
    let bestScore = -Infinity
    let bestTurn = null
    let aborted = false

    const ordered =
      orderHardTurns(
        board,
        allTurns,
        'black'
      )

    for (const turn of ordered) {
      if (
        performance.now() >= deadline
      ) {
        aborted = true
        break
      }

      const nextBoard =
        applyHardTurn(
          board,
          turn
        )

      const result =
        hardMinimax(
          nextBoard,
          depth - 1,
          'cream',
          -Infinity,
          Infinity,
          deadline,
          table
        )

      if (result.timeout) {
        aborted = true
        break
      }

      let score = result.score

      // كسر تعادل بسيط وثابت
      // بدون جعل الصعب عشوائي
      score +=
        hardTieBreaker(turn) *
        0.001

      if (score > bestScore) {
        bestScore = score
        bestTurn = turn
      }
    }

    // لا نعتمد نتيجة عمق
    // إذا انتهى الوقت قبل إكماله
    if (
      !aborted &&
      bestTurn
    ) {
      completedDepth = depth

      const first =
        bestTurn.steps[0]

      const match =
        findDOMMoveForHardStep(
          moves,
          first
        )

      if (match) {
        bestDomMove = match
      }
    }

    else {
      break
    }
  }

  console.log(
    `Hard AI depth: ${completedDepth}`
  )

  return bestDomMove
}
// ========================================
// ☠️ أتحداك تفوز
// مستوى شديد الصعوبة
// ========================================

function chooseImpossibleMove(moves) {
  const board = createAIBoard()

  const allTurns =
    getHardTurns(
      board,
      'black'
    )

  if (allTurns.length === 0) {
    return chooseHardMove(moves)
  }

  // إذا فيه حركة قانونية واحدة فقط
  // ما يحتاج نضيع وقت في التفكير
  if (allTurns.length === 1) {
    const first =
      allTurns[0].steps[0]

    return (
      findDOMMoveForHardStep(
        moves,
        first
      ) || moves[0]
    )
  }

  // ========================================
  // الوقت الأقصى = 3 دقائق
  // ========================================

  const MAX_TIME =
    3 * 60 * 1000

  const startTime =
    performance.now()

  const deadline =
    startTime + MAX_TIME

  // ذاكرة ضخمة مشتركة بين الأعماق
  const table = new Map()

  let bestDomMove = moves[0]
  let bestTurn = null
  let bestScore = -Infinity

  let completedDepth = 0

  // ========================================
  // نظام الثبات
  // إذا نفس أفضل حركة ثبتت عدة أعماق
  // وبفارق جيد عن المنافس
  // يمكنه اللعب قبل انتهاء 3 دقائق
  // ========================================

  let stableMoveKey = null
  let stableCount = 0

  // لا نسمح له بالاستعجال جدًا
  const MIN_THINK_TIME = 2500

  // ========================================
  // كلما قلت القطع
  // نسمح بعمق هائل
  // ========================================

  const pieceCount =
    countHardPieces(board)

  let maxDepth

  if (pieceCount <= 6) {
    maxDepth = 40
  }

  else if (pieceCount <= 10) {
    maxDepth = 30
  }

  else if (pieceCount <= 16) {
    maxDepth = 22
  }

  else {
    maxDepth = 18
  }

  // ========================================
  // Iterative Deepening
  // ========================================

  for (
    let depth = 4;
    depth <= maxDepth;
    depth++
  ) {
    if (
      performance.now() >= deadline
    ) {
      break
    }

    let depthBestTurn = null
    let depthBestScore = -Infinity

    let secondBestScore = -Infinity

    let aborted = false

    // أفضل الحركات أولًا
    const ordered =
      orderHardTurns(
        board,
        allTurns,
        'black'
      )

    // ========================================
    // إذا عندنا أفضل حركة من العمق السابق
    // نحاولها أولًا
    // ========================================

    if (bestTurn) {
      const previousKey =
        impossibleTurnKey(bestTurn)

      const index =
        ordered.findIndex(
          (turn) =>
            impossibleTurnKey(turn) ===
            previousKey
        )

      if (index > 0) {
        const previous =
          ordered.splice(
            index,
            1
          )[0]

        ordered.unshift(previous)
      }
    }

    // ========================================
    // تجربة جميع الحركات
    // ========================================

    for (const turn of ordered) {
      if (
        performance.now() >= deadline
      ) {
        aborted = true
        break
      }

      const nextBoard =
        applyHardTurn(
          board,
          turn
        )

      const result =
        impossibleMinimax(
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

      let score = result.score

      // كسر تعادل ثابت وصغير جدًا
      score +=
        hardTieBreaker(turn) *
        0.0001

      if (
        score >
        depthBestScore
      ) {
        secondBestScore =
          depthBestScore

        depthBestScore =
          score

        depthBestTurn =
          turn
      }

      else if (
        score >
        secondBestScore
      ) {
        secondBestScore =
          score
      }
    }

    // ========================================
    // إذا ما كمل العمق كامل
    // ما نعتمد نتيجته
    // ========================================

    if (
      aborted ||
      !depthBestTurn
    ) {
      break
    }

    completedDepth = depth

    bestTurn =
      depthBestTurn

    bestScore =
      depthBestScore

    // ========================================
    // تحويل أفضل حركة
    // للحركة الحقيقية في DOM
    // ========================================

    const first =
      bestTurn.steps[0]

    const match =
      findDOMMoveForHardStep(
        moves,
        first
      )

    if (match) {
      bestDomMove = match
    }

    // ========================================
    // فحص ثبات أفضل حركة
    // ========================================

    const currentKey =
      impossibleTurnKey(
        bestTurn
      )

    if (
      currentKey ===
      stableMoveKey
    ) {
      stableCount++
    }

    else {
      stableMoveKey =
        currentKey

      stableCount = 1
    }

    const elapsed =
      performance.now() -
      startTime

    const scoreGap =
      depthBestScore -
      secondBestScore

    console.log(
      `☠️ Impossible depth ${depth}`,
      {
        score:
          Math.round(
            depthBestScore
          ),

        gap:
          Math.round(
            scoreGap
          ),

        stable:
          stableCount,

        time:
          Math.round(elapsed)
      }
    )

    // ========================================
    // فوز مؤكد
    // لا يوجد سبب للانتظار
    // ========================================

    if (
      depthBestScore >
      800000 &&
      elapsed >
      MIN_THINK_TIME
    ) {
      break
    }

    // ========================================
    // أفضل حركة ثبتت
    //
    // لا ننتظر 3 دقائق بلا داعي
    // ========================================

    if (
      depth >= 10 &&
      stableCount >= 4 &&
      scoreGap >= 100 &&
      elapsed >
      MIN_THINK_TIME
    ) {
      break
    }

    // ========================================
    // في نهاية اللعب نكون أكثر صبرًا
    // ولا نتوقف بسهولة
    // ========================================

    if (
      pieceCount <= 10 &&
      stableCount >= 6 &&
      depth >= 14 &&
      scoreGap >= 80 &&
      elapsed >
      5000
    ) {
      break
    }
  }

  console.log(
    '☠️ أتحداك تفوز:',
    {
      depth:
        completedDepth,

      score:
        Math.round(bestScore),

      seconds:
        (
          (
            performance.now() -
            startTime
          ) / 1000
        ).toFixed(2),

      positions:
        table.size
    }
  )

  return bestDomMove
}


// ========================================
// Minimax الخاص بالمستوى المستحيل
// ========================================

function impossibleMinimax(
  board,
  depth,
  color,
  alpha,
  beta,
  deadline,
  table,
  ply
) {
  // ========================================
  // الوقت انتهى
  // ========================================

  if (
    performance.now() >= deadline
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

  // ========================================
  // فوز / خسارة
  // نفضل الفوز الأسرع
  // ونؤخر الخسارة قدر الإمكان
  // ========================================

  if (blackCount === 0) {
    return {
      score:
        -10000000 + ply,

      timeout: false
    }
  }

  if (creamCount === 0) {
    return {
      score:
        10000000 - ply,

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
          ? -9000000 + ply
          : 9000000 - ply,

      timeout: false
    }
  }

  // ========================================
  // وصلنا نهاية عمق البحث
  // ========================================

  if (depth <= 0) {
    return {
      score:
        evaluateImpossibleBoard(
          board
        ),

      timeout: false
    }
  }

  // ========================================
  // Transposition Table
  // ========================================

  const key =
    `${hardBoardKey(board)}|${color}|${depth}`

  const cached =
    table.get(key)

  if (
    cached !== undefined
  ) {
    return {
      score: cached,
      timeout: false
    }
  }

  // ========================================
  // ترتيب الحركات
  // مهم جدًا للـ Alpha Beta
  // ========================================

  const ordered =
    orderHardTurns(
      board,
      turns,
      color
    )

  let best =
    color === 'black'
      ? -Infinity
      : Infinity

  for (const turn of ordered) {
    if (
      performance.now() >= deadline
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
      impossibleMinimax(
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

    if (color === 'black') {
      if (
        result.score > best
      ) {
        best =
          result.score
      }

      if (best > alpha) {
        alpha = best
      }
    }

    else {
      if (
        result.score < best
      ) {
        best =
          result.score
      }

      if (best < beta) {
        beta = best
      }
    }

    // Alpha-Beta pruning
    if (beta <= alpha) {
      break
    }
  }

  table.set(
    key,
    best
  )

  return {
    score: best,
    timeout: false
  }
}


// ========================================
// تقييم أقوى للمستوى المستحيل
// ========================================

function evaluateImpossibleBoard(
  board
) {
  // نبدأ من تقييم الصعب الحالي
  let score =
    evaluateHardBoard(board)

  let blackKings = 0
  let creamKings = 0

  let blackNearKing = 0
  let creamNearKing = 0

  // ========================================
  // فحص القطع بتفصيل أكبر
  // ========================================

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

      // ========================================
      // الملوك مهمون جدًا
      // ========================================

      if (piece.king) {
        if (
          piece.color === 'black'
        ) {
          blackKings++

          score += 35
        }

        else {
          creamKings++

          score -= 35
        }

        continue
      }

      // ========================================
      // قرب الحجر من الترقية
      // ========================================

      if (
        piece.color === 'black'
      ) {
        const distance =
          7 - row

        if (distance === 1) {
          blackNearKing++

          score += 45
        }

        else if (
          distance === 2
        ) {
          score += 18
        }
      }

      else {
        const distance =
          row

        if (distance === 1) {
          creamNearKing++

          score -= 50
        }

        else if (
          distance === 2
        ) {
          score -= 20
        }
      }

      // ========================================
      // وسط الرقعة
      // ========================================

      if (
        row >= 2 &&
        row <= 5 &&
        col >= 2 &&
        col <= 5
      ) {
        score +=
          piece.color === 'black'
            ? 5
            : -5
      }
    }
  }

  // ========================================
  // فرق الملوك
  // ========================================

  score +=
    (
      blackKings -
      creamKings
    ) * 30

  // ========================================
  // القطع القريبة جدًا من الملك
  // ========================================

  score +=
    blackNearKing * 15

  score -=
    creamNearKing * 18

  // ========================================
  // التهديدات
  // ========================================

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
    blackThreatened * 35

  score +=
    creamThreatened * 32

  return score
}


// ========================================
// مفتاح ثابت للدور
// لمعرفة هل أفضل حركة ثبتت
// ========================================

function impossibleTurnKey(turn) {
  return turn.steps
    .map((step) => {
      return (
        `${step.fromRow},` +
        `${step.fromCol}>` +
        `${step.row},` +
        `${step.col}:` +
        `${step.capture ? 1 : 0}`
      )
    })
    .join('|')
}


// ========================================
// إنشاء الأدوار الكاملة للصعب
// ========================================

function getHardTurns(
  board,
  color
) {
  const captureTurns = []

  // أولًا نبحث عن الأكل
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

      for (
  const capture
  of captures
) {
  const captureWithState = {
    ...capture,

    wasKingBefore:
      piece.king
  }

  const nextBoard =
    applyAIMove(
      board,
      captureWithState
    )

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

  // إذا فيه أكل
  // الأكل إجباري
  if (
    captureTurns.length > 0
  ) {
    return captureTurns
  }

  // إذا ما فيه أكل
  // نولد الحركات العادية
  const turns = []

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

      const normalMoves =
        getAINormalMoves(
          board,
          row,
          col
        )

      for (
        const move
        of normalMoves
      ) {
        turns.push({
          steps: [move]
        })
      }
    }
  }

  return turns
}


// ========================================
// بناء سلسلة الأكل كاملة
// ========================================

function buildHardCaptureTurns(
  board,
  row,
  col,
  steps,
  result
) {
  const piece =
    board[row][col]

  if (!piece) {
    result.push({
      steps
    })

    return
  }

  // ========================================
  // قانون لعبتنا:
  // إذا الحجر العادي وصل للملك
  // في آخر حركة، ينتهي دوره فورًا
  // ========================================

  const lastMove =
    steps[
      steps.length - 1
    ]

  if (lastMove) {
    const reachedKingRow =
      piece.color === 'black'
        ? lastMove.row === 7
        : lastMove.row === 0

    // نعرف هل الحركة السابقة
    // بدأت بحجر عادي
    const previousBoard =
      copyAIBoard(board)

    const becameKing =
      piece.king &&
      reachedKingRow &&
      lastMove.wasKingBefore === false

    if (becameKing) {
      result.push({
        steps
      })

      return
    }
  }

  const more =
    getAICaptures(
      board,
      row,
      col
    )

  // انتهت سلسلة الأكل
  if (more.length === 0) {
    result.push({
      steps
    })

    return
  }

  // نجرب جميع احتمالات
  // الأكل التالي
  for (const move of more) {
    const movingPiece =
      board[row][col]

    const moveWithState = {
      ...move,

      wasKingBefore:
        movingPiece
          ? movingPiece.king
          : false
    }

    const nextBoard =
      applyAIMove(
        board,
        moveWithState
      )

    buildHardCaptureTurns(
      nextBoard,
      move.row,
      move.col,
      [
        ...steps,
        moveWithState
      ],
      result
    )
  }
}


// ========================================
// تنفيذ دور كامل داخل نسخة AI
// ========================================

function applyHardTurn(
  board,
  turn
) {
  let next =
    copyAIBoard(board)

  for (
    const step
    of turn.steps
  ) {
    next =
      applyAIMove(
        next,
        step
      )
  }

  return next
}


// ========================================
// Minimax قوي
// مع Alpha Beta
// ========================================

function hardMinimax(
  board,
  depth,
  color,
  alpha,
  beta,
  deadline,
  table
) {
  // انتهى الوقت
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

  // الكمبيوتر خسر
  if (blackCount === 0) {
    return {
      score:
        -1000000 -
        depth,

      timeout: false
    }
  }

  // اللاعب خسر
  if (creamCount === 0) {
    return {
      score:
        1000000 +
        depth,

      timeout: false
    }
  }

  const turns =
    getHardTurns(
      board,
      color
    )

  // ما عنده أي حركة
  if (turns.length === 0) {
    return {
      score:
        color === 'black'
          ? -900000 - depth
          : 900000 + depth,

      timeout: false
    }
  }

  // نهاية عمق البحث
  if (depth === 0) {
    return {
      score:
        evaluateHardBoard(
          board
        ),

      timeout: false
    }
  }

  // ========================================
  // Transposition Table
  // يحفظ الوضعيات المحسوبة
  // ========================================

  const key =
    `${hardBoardKey(board)}|${color}|${depth}`

  const cached =
    table.get(key)

  if (
    cached !== undefined
  ) {
    return {
      score: cached,
      timeout: false
    }
  }

  // ترتيب أفضل الحركات أولًا
  // يجعل Alpha Beta أقوى
  const ordered =
    orderHardTurns(
      board,
      turns,
      color
    )

  let best =
    color === 'black'
      ? -Infinity
      : Infinity

  for (
    const turn
    of ordered
  ) {
    const nextBoard =
      applyHardTurn(
        board,
        turn
      )

    const result =
      hardMinimax(
        nextBoard,
        depth - 1,

        color === 'black'
          ? 'cream'
          : 'black',

        alpha,
        beta,
        deadline,
        table
      )

    if (result.timeout) {
      return result
    }

    // دور الكمبيوتر
    if (
      color === 'black'
    ) {
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

    // دور اللاعب
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

    // Alpha Beta Pruning
    if (
      beta <= alpha
    ) {
      break
    }
  }

  table.set(
    key,
    best
  )

  return {
    score: best,
    timeout: false
  }
}


// ========================================
// تقييم قوي للرقعة
// ========================================

function evaluateHardBoard(
  board
) {
  let score = 0

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

      // ========================================
      // قيمة الحجر
      // ========================================

      let value =
        piece.king
          ? 210
          : 100

      // ========================================
      // الملك
      // ========================================

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
      }

      // ========================================
      // الحجر العادي
      // ========================================

      else {
        const progress =
          piece.color ===
          'black'
            ? row
            : 7 - row

        // كل ما قرب للملك
        // تزيد قيمته
        value +=
          progress * 8

        // قبل الترقية مباشرة
        if (
          progress === 6
        ) {
          value += 28
        }
      }

      // ========================================
      // السيطرة على الوسط
      // ========================================

      if (
        row >= 2 &&
        row <= 5 &&
        col >= 2 &&
        col <= 5
      ) {
        value += 12
      }

      // ========================================
      // الحافة
      // ========================================

      if (
        col === 0 ||
        col === 7
      ) {
        value += 5
      }

      // ========================================
      // حماية الصف الخلفي
      // ========================================

      if (!piece.king) {
        if (
          piece.color ===
            'black' &&
          row === 0
        ) {
          value += 8
        }

        if (
          piece.color ===
            'cream' &&
          row === 7
        ) {
          value += 8
        }
      }

      // ========================================
      // إضافة النتيجة
      // ========================================

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

  // ========================================
  // حرية الحركة
  // ========================================

  const blackTurns =
    getHardTurns(
      board,
      'black'
    )

  const creamTurns =
    getHardTurns(
      board,
      'cream'
    )

  score +=
    (
      blackTurns.length -
      creamTurns.length
    ) * 4

  // ========================================
  // فرق الملوك
  // ========================================

  score +=
    (
      blackKings -
      creamKings
    ) * 20

  // ========================================
  // سلاسل الأكل
  // ========================================

  score +=
    bestHardCaptureLength(
      blackTurns
    ) * 32

  score -=
    bestHardCaptureLength(
      creamTurns
    ) * 36

  // ========================================
  // القطع المعرضة للأكل
  // ========================================

  score -=
    countHardThreatened(
      board,
      'black'
    ) * 24

  score +=
    countHardThreatened(
      board,
      'cream'
    ) * 20

  return score
}


// ========================================
// ترتيب الحركات
// ========================================

function orderHardTurns(
  board,
  turns,
  color
) {
  return [
    ...turns
  ].sort(
    (a, b) => {
      return (
        hardTurnOrderScore(
          board,
          b,
          color
        ) -

        hardTurnOrderScore(
          board,
          a,
          color
        )
      )
    }
  )
}


// ========================================
// تقييم مبدئي لترتيب الحركة
// ========================================

function hardTurnOrderScore(
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

  // الأكل المتعدد
  // يوضع أولًا في البحث
  score +=
    turn.steps.length *
    120

  // الترقية إلى ملك
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

  // هل بعد الحركة
  // الخصم عنده أكل قوي؟
  const next =
    applyHardTurn(
      board,
      turn
    )

  const enemy =
    color === 'black'
      ? 'cream'
      : 'black'

  const enemyTurns =
    getHardTurns(
      next,
      enemy
    )

  score -=
    bestHardCaptureLength(
      enemyTurns
    ) * 45

  return score
}


// ========================================
// أطول سلسلة أكل
// ========================================

function bestHardCaptureLength(
  turns
) {
  let best = 0

  for (
    const turn
    of turns
  ) {
    if (
      turn.steps[0] &&
      turn.steps[0].capture
    ) {
      best =
        Math.max(
          best,
          turn.steps.length
        )
    }
  }

  return best
}


// ========================================
// عدد القطع المعرضة للأكل
// ========================================

function countHardThreatened(
  board,
  color
) {
  const enemy =
    color === 'black'
      ? 'cream'
      : 'black'

  const enemyTurns =
    getHardTurns(
      board,
      enemy
    )

  const threatened =
    new Set()

  for (
    const turn
    of enemyTurns
  ) {
    for (
      const step
      of turn.steps
    ) {
      if (!step.capture) {
        continue
      }

      const victim =
        board[
          step.capturedRow
        ]?.[
          step.capturedCol
        ]

      if (
        victim &&
        victim.color === color
      ) {
        threatened.add(
          `${step.capturedRow},${step.capturedCol}`
        )
      }
    }
  }

  return threatened.size
}


// ========================================
// تحويل الرقعة إلى مفتاح
// ========================================

function hardBoardKey(
  board
) {
  let key = ''

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
        key += '.'
      }

      else if (
        piece.color ===
        'black'
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


// ========================================
// عدد جميع القطع
// ========================================

function countHardPieces(
  board
) {
  return (
    countHardColor(
      board,
      'black'
    ) +

    countHardColor(
      board,
      'cream'
    )
  )
}


// ========================================
// عدد قطع لون معين
// ========================================

function countHardColor(
  board,
  color
) {
  let count = 0

  for (
    const row
    of board
  ) {
    for (
      const piece
      of row
    ) {
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


// ========================================
// كسر التعادل بين حركتين متساويتين
// ========================================

function hardTieBreaker(
  turn
) {
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


// ========================================
// ربط حركة AI بالحركة الحقيقية
// ========================================

function findDOMMoveForHardStep(
  moves,
  step
) {
  return (
    moves.find(
      (move) => {
        const square =
          move.piece
            ?.parentElement

        if (!square) {
          return false
        }

        return (
          Number(
            square.dataset.row
          ) === step.fromRow &&

          Number(
            square.dataset.col
          ) === step.fromCol &&

          move.row ===
            step.row &&

          move.col ===
            step.col &&

          Boolean(
            move.capture
          ) ===
            Boolean(
              step.capture
            )
        )
      }
    ) || null
  )
}


// ========================================
// إنشاء نسخة من الرقعة للذكاء
// ========================================

function createAIBoard() {

  const board =
    Array.from(
      { length: 8 },
      () =>
        Array(8).fill(null)
    )


  document
    .querySelectorAll(
      '.checker-piece'
    )
    .forEach((piece) => {

      const square =
        piece.parentElement

      const row =
        Number(
          square.dataset.row
        )

      const col =
        Number(
          square.dataset.col
        )


      board[row][col] = {

        color:
          piece.dataset.color,

        king:
          piece.dataset.king ===
          'true'

      }

    })


  return board
}


// ========================================
// نسخ الرقعة
// ========================================

function copyAIBoard(board) {

  return board.map(
    (row) =>

      row.map(
        (piece) => {

          if (!piece) {
            return null
          }

          return {
            ...piece
          }

        }
      )

  )
}


// ========================================
// التأكد أن الخانة داخل الرقعة
// ========================================

function isInsideBoard(
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


// ========================================
// جميع الحركات في نسخة الذكاء
// ========================================

function getAIMoves(
  board,
  color
) {

  const captures = []


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


      const pieceCaptures =
        getAICaptures(
          board,
          row,
          col
        )


      captures.push(
        ...pieceCaptures
      )

    }

  }


  // الأكل إجباري
  if (
    captures.length > 0
  ) {

    return captures

  }


  const moves = []


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


      moves.push(
        ...getAINormalMoves(
          board,
          row,
          col
        )
      )

    }

  }


  return moves
}


// ========================================
// الحركات العادية للذكاء
// ========================================

function getAINormalMoves(
  board,
  row,
  col
) {
  const piece =
    board[row][col]

  if (!piece) {
    return []
  }

  const moves = []

  // ========================================
  // الملك
  // يتحرك بحرية على الأقطار
  // ========================================

  if (piece.king) {
    const directions = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1]
    ]

    for (const [dr, dc] of directions) {
      let newRow =
        row + dr

      let newCol =
        col + dc

      while (
        isInsideBoard(
          newRow,
          newCol
        )
      ) {
        // وجود أي قطعة يوقف الطريق
        if (
          board[newRow][newCol]
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
  // خطوة واحدة للأمام
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
    const newRow =
      row + dr

    const newCol =
      col + dc

    if (
      !isInsideBoard(
        newRow,
        newCol
      )
    ) {
      continue
    }

    if (
      board[newRow][newCol]
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
// الأكل للذكاء
// ========================================

function getAICaptures(board, row, col) {
  const piece = board[row][col]

  if (!piece) {
    return []
  }

  const captures = []

  // ========================================
  // الملك
  // يرى الخصم من بعيد
  // لكنه يهبط أول مربع بعد الخصم فقط
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

      // نمشي على القطر حتى نجد أول قطعة
      while (
        isInsideBoard(
          checkRow,
          checkCol
        )
      ) {
        const target =
          board[checkRow][checkCol]

        // مربع فاضي قبل الخصم
        // نكمل البحث
        if (!target) {
          checkRow += dr
          checkCol += dc
          continue
        }

        // قطعة من نفس اللون
        // تسكر الطريق
        if (
          target.color ===
          piece.color
        ) {
          break
        }

        // ========================================
        // وجدنا قطعة خصم
        // ========================================

        const landingRow =
          checkRow + dr

        const landingCol =
          checkCol + dc

        // ما فيه مربع بعدها
        if (
          !isInsideBoard(
            landingRow,
            landingCol
          )
        ) {
          break
        }

        // أول مربع بعد الخصم مشغول
        // إذًا ما نقدر نأكل
        if (
          board[landingRow][landingCol]
        ) {
          break
        }

        // ========================================
        // أكلة صحيحة
        // الهبوط مربع واحد فقط بعد الخصم
        // ========================================

        captures.push({
          fromRow: row,
          fromCol: col,

          row: landingRow,
          col: landingCol,

          capture: true,

          capturedRow: checkRow,
          capturedCol: checkCol
        })

        // ما نضيف مربعات أبعد
        break
      }
    }

    return captures
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
      !isInsideBoard(
        enemyRow,
        enemyCol
      ) ||
      !isInsideBoard(
        landingRow,
        landingCol
      )
    ) {
      continue
    }

    const enemy =
      board[enemyRow][enemyCol]

    if (!enemy) {
      continue
    }

    if (
      enemy.color ===
      piece.color
    ) {
      continue
    }

    if (
      board[landingRow][landingCol]
    ) {
      continue
    }

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


// ========================================
// تنفيذ حركة داخل نسخة الذكاء
// ========================================

function applyAIMove(
  board,
  move
) {

  const newBoard =
    copyAIBoard(board)


  const piece =
    newBoard[
      move.fromRow
    ][
      move.fromCol
    ]


  if (!piece) {

    return newBoard

  }


  newBoard[
    move.fromRow
  ][
    move.fromCol
  ] = null


  if (move.capture) {

    newBoard[
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
    movedPiece.color ===
      'cream' &&
    !movedPiece.king &&
    move.row === 0
  ) {

    movedPiece.king = true

  }


  // ترقية الأسود
  if (
    movedPiece.color ===
      'black' &&
    !movedPiece.king &&
    move.row === 7
  ) {

    movedPiece.king = true

  }


  newBoard[
    move.row
  ][
    move.col
  ] = movedPiece


  return newBoard
}


// ========================================
// خوارزمية Minimax
// ========================================

function minimax(
  board,
  depth,
  maximizing,
  alpha,
  beta
) {

  const blackMoves =
    getAIMoves(
      board,
      'black'
    )


  const creamMoves =
    getAIMoves(
      board,
      'cream'
    )


  // الكمبيوتر خسر
  if (
    blackMoves.length === 0
  ) {

    return (
      -100000 -
      depth
    )

  }


  // اللاعب خسر
  if (
    creamMoves.length === 0
  ) {

    return (
      100000 +
      depth
    )

  }


  // وصلنا لنهاية البحث
  if (depth === 0) {

    return evaluateAIBoard(
      board
    )

  }


  // ==========================
  // دور الكمبيوتر
  // ==========================

  if (maximizing) {

    let best =
      -Infinity


    for (
      const move
      of blackMoves
    ) {

      const newBoard =
        applyAIMove(
          board,
          move
        )


      const score =
        minimax(
          newBoard,
          depth - 1,
          false,
          alpha,
          beta
        )


      best =
        Math.max(
          best,
          score
        )


      alpha =
        Math.max(
          alpha,
          best
        )


      // Alpha Beta
      if (
        beta <= alpha
      ) {

        break

      }

    }


    return best

  }


  // ==========================
  // دور اللاعب
  // ==========================

  else {

    let best =
      Infinity


    for (
      const move
      of creamMoves
    ) {

      const newBoard =
        applyAIMove(
          board,
          move
        )


      const score =
        minimax(
          newBoard,
          depth - 1,
          true,
          alpha,
          beta
        )


      best =
        Math.min(
          best,
          score
        )


      beta =
        Math.min(
          beta,
          best
        )


      // Alpha Beta
      if (
        beta <= alpha
      ) {

        break

      }

    }


    return best

  }
}


// ========================================
// تقييم الرقعة
// ========================================

function evaluateAIBoard(board) {

  let score = 0


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


      // الحجر العادي = 100
      // الملك = 180

      let value =
        piece.king
          ? 180
          : 100


      // ==========================
      // الاقتراب من الملك
      // ==========================

      if (!piece.king) {

        if (
          piece.color ===
          'black'
        ) {

          value +=
            row * 7

        }

        else {

          value +=
            (7 - row) * 7

        }

      }


      // ==========================
      // السيطرة على الوسط
      // ==========================

      if (
        row >= 2 &&
        row <= 5 &&
        col >= 2 &&
        col <= 5
      ) {

        value += 10

      }


      // ==========================
      // الحافة
      // ==========================

      if (
        col === 0 ||
        col === 7
      ) {

        value += 5

      }


      // ==========================
      // إضافة / خصم النقاط
      // ==========================

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


  // ==========================
  // عدد الحركات المتاحة
  // ==========================

  const blackMobility =
    getAIMoves(
      board,
      'black'
    ).length


  const creamMobility =
    getAIMoves(
      board,
      'cream'
    ).length


  score +=
    blackMobility * 3


  score -=
    creamMobility * 3


  return score
}

// ========================================
// تنفيذ حركة الكمبيوتر
// ========================================

function showComputerSelectedPiece(piece) {
  document
    .querySelectorAll('.computer-selected-piece')
    .forEach(p =>
      p.classList.remove('computer-selected-piece')
    )

  if (piece) {
    piece.classList.add('computer-selected-piece')
  }
}

function clearComputerSelectedPiece() {
  document
    .querySelectorAll('.computer-selected-piece')
    .forEach(p =>
      p.classList.remove('computer-selected-piece')
    )
}

function executeComputerMove(move) {
  if (!move) {
    endComputerTurn()
    return
  }

  const piece = move.piece

  if (
    !piece ||
    !document.body.contains(piece)
  ) {
    endComputerTurn()
    return
  }

  showComputerSelectedPiece(piece)

  setTimeout(() => {
    if (gameOver || currentTurn !== 'black') {
      clearComputerSelectedPiece()
      return
    }

    // لا توجد دالة شرح لخالد في هذا الملف، لا نوقف حركة الكمبيوتر بسببها

    // هل كان ملك قبل الحركة؟
    const wasKing =
      piece.dataset.king === 'true'

    // ========================================
    // حذف الحجر المأكول
    // ========================================

    if (move.capture) {
      const capturedPiece =
        getPieceAt(
          move.capturedRow,
          move.capturedCol
        )

      if (capturedPiece) {
        capturedPiece.remove()
      }
    }

    // ========================================
    // تحديد خانة الوصول
    // ========================================

    const target =
      getSquare(
        move.row,
        move.col
      )

    if (!target) {
      clearComputerSelectedPiece()
      endComputerTurn()
      return
    }

    // ========================================
    // تحريك الحجر الأسود
    // ========================================

    target.appendChild(piece)
    playMoveSound()
    clearComputerSelectedPiece()

    // ========================================
    // الترقية إلى ملك
    // ========================================

    promoteIfNeeded(piece)

    const isKingNow =
      piece.dataset.king === 'true'

    const justBecameKing =
      !wasKing && isKingNow

    // ========================================
    // فحص نهاية اللعبة
    // ========================================

    if (checkGameStatus()) {
      return
    }

    // ========================================
    // إذا صار ملك الآن
    // ينتهي دوره فورًا
    // حتى لو عنده أكلة جديدة
    // ========================================

    if (justBecameKing) {
      endComputerTurn()
      return
    }

    // ========================================
    // الأكل المتعدد
    // إذا كان ملك من قبل أو حجر عادي
    // ولم يترقَّ الآن
    // ========================================

    if (move.capture) {
      const moreCaptures =
        getCaptureMoves(piece)

      if (
        moreCaptures.length > 0
      ) {
        setTurnText(
          ''
        )

        setTimeout(() => {
          const possibleMoves =
            moreCaptures.map(
              (nextMove) => ({
                piece,
                ...nextMove
              })
            )

          const nextMove =
            chooseComputerMove(
              possibleMoves
            )

          executeComputerMove(
            nextMove
          )
        }, COMPUTER_CAPTURE_DELAY)

        return
      }
    }

    // ========================================
    // انتهى دور الكمبيوتر
    // ========================================

    endComputerTurn()
  }, COMPUTER_PREVIEW_DELAY)
}

// ========================================
// نهاية دور الكمبيوتر
// ========================================

function endComputerTurn() {
  clearComputerSelectedPiece()

  if (gameOver) return

  currentTurn = 'cream'

  selectedPiece = null

  clearHighlights()

  updatePlayerHighlight()

  if (
    getAllMoves('cream').length === 0
  ) {
    finishGame(
      'انتهت اللعبة — لا توجد لديك حركة متاحة'
    )

    return
  }

  setTurnText('دورك')
}

// ========================================
// ترقية الحجر
// ========================================

function promoteIfNeeded(piece) {
  if (
    piece.dataset.king === 'true'
  ) {
    return
  }

  const row = Number(
    piece.parentElement.dataset.row
  )

  if (
    piece.dataset.color === 'cream' &&
    row === 0
  ) {
    makeKing(piece)
  }

  if (
    piece.dataset.color === 'black' &&
    row === 7
  ) {
    makeKing(piece)
  }
}

// ========================================
// الملك
// ========================================

function makeKing(piece) {
  piece.dataset.king = 'true'

  piece.classList.add('king')

  const symbol =
    document.createElement('span')

  symbol.classList.add(
    'king-symbol'
  )

  symbol.textContent = '♛'

  piece.appendChild(symbol)

  // صوت خاص عند ترقية الحجر إلى ملك
  playKingSound()
}

// ========================================
// تغيير نص الدور
// ========================================

function setTurnText(text) {
  const element =
    document.querySelector(
      '#turnText'
    )

  if (element) {
    element.textContent = text
  }
}

// ========================================
// إبراز اللاعب الحالي
// ========================================

function updatePlayerHighlight() {
  const human =
    document.querySelector(
      '#humanPlayer'
    )

  const computer =
    document.querySelector(
      '#computerPlayer'
    )

  if (!human || !computer) {
    return
  }

  if (onlineMode) {
    human.classList.toggle(
      'active-player',
      currentTurn === onlinePlayerColor
    )

    computer.classList.toggle(
      'active-player',
      currentTurn !== onlinePlayerColor
    )

    return
  }

  human.classList.toggle(
    'active-player',
    currentTurn === 'cream'
  )

  computer.classList.toggle(
    'active-player',
    currentTurn === 'black'
  )
}

// ========================================
// تنبيه الأكل الإجباري
// تأثير أحمر بسيط حول الحجر المطلوب
// ========================================

let forcedCaptureHintTimer = null

function clearForcedCaptureHint() {
  if (forcedCaptureHintTimer) {
    clearTimeout(forcedCaptureHintTimer)
    forcedCaptureHintTimer = null
  }

  document
    .querySelectorAll(
      '.forced-capture-alert'
    )
    .forEach(piece => {
      piece.classList.remove(
        'forced-capture-alert'
      )
    })
}

function showForcedCaptureHint(
  color,
  onlyPiece = null,
  duration = 1050
) {
  clearForcedCaptureHint()

  if (gameOver || !color) {
    return
  }

  let pieces = []

  if (
    onlyPiece &&
    document.body.contains(onlyPiece) &&
    onlyPiece.dataset.color === color &&
    getCaptureMoves(onlyPiece).length > 0
  ) {
    pieces = [onlyPiece]
  }

  else {
    pieces = Array.from(
      document.querySelectorAll(
        `.checker-piece[data-color="${color}"]`
      )
    ).filter(piece =>
      getCaptureMoves(piece).length > 0
    )
  }

  if (pieces.length === 0) {
    return
  }

  pieces.forEach(piece => {
    piece.classList.add(
      'forced-capture-alert'
    )
  })

  forcedCaptureHintTimer =
    setTimeout(() => {
      pieces.forEach(piece => {
        piece.classList.remove(
          'forced-capture-alert'
        )
      })

      forcedCaptureHintTimer = null
    }, duration)
}

// ========================================
// إزالة علامات الحركة
// ========================================

function clearHighlights(
  removeSelected = true
) {
  if (removeSelected) {
    document
      .querySelectorAll(
        '.selected-piece'
      )
      .forEach((piece) => {
        piece.classList.remove(
          'selected-piece',
          'piece-picked',
          'selected-ring'
        )
      })
  }

  document
    .querySelectorAll(
      '.possible-move'
    )
    .forEach((square) => {
      square.classList.remove(
        'possible-move',
        'capture-move'
      )

      delete square.dataset.capture
      delete square.dataset.capturedRow
      delete square.dataset.capturedCol
    })
}

// ========================================
// إلغاء التحديد
// ========================================

function clearSelection() {
  clearHighlights()

  selectedPiece = null
}

// ========================================
// فحص الفوز
// ========================================

function checkGameStatus() {
  const creamCount =
    document.querySelectorAll(
      '.checker-piece[data-color="cream"]'
    ).length

  const blackCount =
    document.querySelectorAll(
      '.checker-piece[data-color="black"]'
    ).length

  if (onlineMode) {
    const localCount =
      onlinePlayerColor === 'cream'
        ? creamCount
        : blackCount

    const opponentCount =
      onlinePlayerColor === 'cream'
        ? blackCount
        : creamCount

    if (opponentCount === 0) {
      finishGame('فزت! 👑')
      return true
    }

    if (localCount === 0) {
      finishGame('خسرت المباراة')
      return true
    }

    if (
      onlineOpponentConnected &&
      getAllMoves(currentTurn).length === 0
    ) {
      const winnerColor =
        getOppositeColor(currentTurn)

      if (winnerColor === onlinePlayerColor) {
        finishGame(
          'فزت! خصمك لا يملك أي حركة 👑'
        )
      }

      else {
        finishGame(
          'خسرت! لا توجد لديك حركة متاحة'
        )
      }

      return true
    }

    return false
  }

  if (blackCount === 0) {
    finishGame('فزت! 👑')
    return true
  }

  if (creamCount === 0) {
    finishGame(
      'فاز الكمبيوتر'
    )

    return true
  }

  return false
}

// ========================================
// إنهاء اللعبة
// ========================================

function finishGame(message) {
  if (gameOver) return

  gameOver = true

  stopImpossibleWorker()
  stopKhaledWorker()
  stopMatchTimer(true)
  clearSelection()
  setTurnText(message)

  const playerWon =
    message.includes('فزت') ||
    message.includes('فوز')

  playResultSound(playerWon)

  recordGameResult(playerWon)

  const winChance =
    calculatePlayerWinChance()

  const overlay =
    document.createElement('div')

  overlay.className =
    'game-result-overlay'

  const box =
    document.createElement('div')

  box.className =
    'game-result-box'

  const title =
    document.createElement('h1')

  title.className = playerWon
    ? 'result-title win'
    : 'result-title lose'

  title.textContent = playerWon
    ? '👑 مبروك الانتصار!'
    : '💀 خسرت يا حمار 😂'

  const resultMessage =
    document.createElement('p')

  resultMessage.className =
    'result-message'

  if (onlineMode) {
    const opponentForfeited =
      message.includes('انسحب') ||
      message.includes('خرج')

    resultMessage.textContent =
      opponentForfeited
        ? 'خصمك انسحب من المباراة، وتم احتساب الفوز لك.'
        : playerWon
          ? 'قدرت تهزم خصمك!'
          : 'خصمك فاز هالمرة.'
  }

  else {
    resultMessage.textContent = playerWon
      ? 'فزت عليك'
      :'هطفهههه'
  }

  const chance =
    document.createElement('div')

  chance.className = 'win-chance'

  if (onlineMode) {
    const changeText =
      lastRatingChange > 0
        ? `+${lastRatingChange}`
        : `${lastRatingChange}`

    chance.innerHTML = `
      <span>تصنيفك • ${changeText}</span>
      <strong>${getPlayerRating()}</strong>
    `
  }

  else {
    chance.innerHTML = `
      <span>احتمالية فوزك</span>
      <strong>${winChance}%</strong>
    `
  }

  const buttons =
    document.createElement('div')

  buttons.className =
    'result-buttons'

  const replayButton =
    document.createElement('button')

  replayButton.className =
    'result-btn replay-btn'

  replayButton.textContent = onlineMode
    ? '🔄 مباراة جديدة'
    : playerWon
      ? '🔥 العب مرة ثانية'
      : '💪 حاول مرة ثانية'

  replayButton.onclick = () => {
    if (onlineMode) {
      if (!onlineOpponentConnected) {
        overlay.remove()
        showHome()
        return
      }

      replayButton.disabled = true
      replayButton.textContent =
        'بانتظار إعادة المباراة...'

      socket.emit('restart-game')
      return
    }

    overlay.remove()
    startGame(currentLevel)
  }

  const homeButton =
    document.createElement('button')

  homeButton.className =
    'result-btn home-btn'

  homeButton.textContent =
    '🏠 الرئيسية'

  homeButton.onclick = () => {
    overlay.remove()
    showHome()
  }

  buttons.appendChild(replayButton)
  buttons.appendChild(homeButton)

  box.appendChild(title)
  box.appendChild(resultMessage)
  box.appendChild(chance)
  box.appendChild(buttons)

  overlay.appendChild(box)

  document.body.appendChild(overlay)
}


// ========================================
// حساب احتمالية فوز اللاعب
// ========================================

function calculatePlayerWinChance() {
  const creamPieces =
    document.querySelectorAll(
      '.checker-piece[data-color="cream"]'
    )

  const blackPieces =
    document.querySelectorAll(
      '.checker-piece[data-color="black"]'
    )

  let creamScore = 0
  let blackScore = 0

  creamPieces.forEach(piece => {
    creamScore +=
      piece.dataset.king === 'true'
        ? 3
        : 1
  })

  blackPieces.forEach(piece => {
    blackScore +=
      piece.dataset.king === 'true'
        ? 3
        : 1
  })

  let playerScore = creamScore
  let opponentScore = blackScore
  let playerCount = creamPieces.length
  let opponentCount = blackPieces.length

  if (
    onlineMode &&
    onlinePlayerColor === 'black'
  ) {
    playerScore = blackScore
    opponentScore = creamScore
    playerCount = blackPieces.length
    opponentCount = creamPieces.length
  }

  const total =
    playerScore + opponentScore

  if (total === 0) {
    return 50
  }

  let chance =
    Math.round(
      (playerScore / total) * 100
    )

  chance = Math.max(
    1,
    Math.min(99, chance)
  )

  if (opponentCount === 0) {
    chance = 100
  }

  if (playerCount === 0) {
    chance = 0
  }

  return chance
}

// ========================================
// تشغيل الموقع
// ========================================

showHome()

