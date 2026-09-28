import path from 'path'
import { randomBytes } from 'crypto'
import { fileURLToPath } from 'url'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'

const app = express()
app.use(cors())
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(
  express.static(
    path.join(__dirname, 'dist')
  )
)

const httpServer = createServer(app)

const io = new Server(
  httpServer,
  {
    cors: {
      origin: '*'
    }
  }
)

// ========================================
// الرومات
// ========================================

const rooms = new Map()


// ========================================
// كود روم من 5 أرقام
// ========================================

function generateRoomCode() {
  let code

  do {
    code = String(
      Math.floor(
        10000 +
        Math.random() * 90000
      )
    )
  }
  while (rooms.has(code))

  return code
}


function getPlayerColor(room, socketId) {
  if (room.host === socketId) {
    return room.hostColor
  }

  if (room.guest === socketId) {
    return room.hostColor === 'cream' ? 'black' : 'cream'
  }

  return null
}


// اختيار عشوائي فعلي 50/50 للون منشئ الروم، لا يعتمد على ترتيب الدخول.
function pickRandomHostColor() {
  return Math.random() < 0.5 ? 'cream' : 'black'
}


function normalizeRoomSettings(settings) {
  const mode = settings?.mode === 'time'
    ? 'time'
    : 'no-time'
  const requestedMinutes = Number(settings?.minutes)
  const minutes = [1, 5, 10].includes(requestedMinutes)
    ? requestedMinutes
    : 5

  return {
    mode,
    minutes: mode === 'time' ? minutes : null
  }
}


function normalizePlayerName(name) {
  const cleanName = String(name || '').trim().slice(0, 32)
  return cleanName || 'لاعب'
}


function clearRoomClock(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval)
    room.timerInterval = null
  }
}


function emitRoomClock(room, code) {
  io.to(code).emit('clock-update', {
    cream: Math.ceil(room.timers.cream / 1000),
    black: Math.ceil(room.timers.black / 1000),
    turn: room.timerStarted
  })
}


function endRoomOnTime(room, code, loser) {
  clearRoomClock(room)
  room.finished = true
  room.timerStarted = null
  emitRoomClock(room, code)
  io.to(code).emit('time-ended', {
    winner: loser === 'cream' ? 'black' : 'cream',
    loser
  })
}


function updateRoomClock(room, code) {
  if (!room.timerStarted || !room.timerLastTick) return false

  const now = Date.now()
  const elapsed = now - room.timerLastTick
  room.timerLastTick = now
  room.timers[room.timerStarted] = Math.max(
    0,
    room.timers[room.timerStarted] - elapsed
  )

  if (room.timers[room.timerStarted] === 0) {
    endRoomOnTime(room, code, room.timerStarted)
    return true
  }

  return false
}


function startRoomClock(room, code, color = room.turn) {
  if (
    room.settings?.mode !== 'time' ||
    !room.guest ||
    room.finished
  ) return

  clearRoomClock(room)
  room.timerStarted = color
  room.timerLastTick = Date.now()
  emitRoomClock(room, code)

  room.timerInterval = setInterval(() => {
    if (updateRoomClock(room, code)) return
    emitRoomClock(room, code)
  }, 250)
}


function clearSocketRoomData(socket) {
  socket.data.roomCode = null
  socket.data.playerColor = null
}


function closeRoomForSocket(socket) {
  const code = socket.data.roomCode

  if (!code) return

  const room = rooms.get(code)

  if (!room) {
    socket.leave(code)
    clearSocketRoomData(socket)
    return
  }

  clearRoomClock(room)

  const otherId =
    room.host === socket.id
      ? room.guest
      : room.host

  socket
    .to(code)
    .emit('player-left')

  if (otherId) {
    const otherSocket =
      io.sockets.sockets.get(otherId)

    if (otherSocket) {
      otherSocket.leave(code)
      clearSocketRoomData(
        otherSocket
      )
    }
  }

  const roomMembers =
    io.sockets.adapter.rooms.get(code)

  for (const memberId of roomMembers || []) {
    if (memberId === socket.id || memberId === otherId) continue

    const spectator =
      io.sockets.sockets.get(memberId)

    if (spectator) {
      spectator.leave(code)
      spectator.data.spectatingRoomCode = null
    }
  }

  socket.leave(code)
  clearSocketRoomData(socket)

  rooms.delete(code)

  console.log(
    `Room deleted: ${code}`
  )
}


// ========================================
// اتصال لاعب
// ========================================

io.on(
  'connection',
  socket => {

    console.log(
      'Player connected:',
      socket.id
    )


    // ========================================
    // إنشاء روم
    // ========================================

    socket.on(
      'create-room',
      (settings, callback) => {

        if (typeof settings === 'function') {
          callback = settings
          settings = {}
        }

        // لو اللاعب داخل روم قديم
        // نخرجه منه أولًا.
        closeRoomForSocket(socket)

        const code =
          generateRoomCode()

        const roomSettings =
          normalizeRoomSettings(settings)
        const watchKey = randomBytes(24).toString('hex')
        const hostColor = pickRandomHostColor()

        rooms.set(
          code,
          {
            host: socket.id,
            hostName: normalizePlayerName(settings?.playerName),
            hostColor,
            watchKey,
            moveHistory: [],
            guest: null,
            turn: 'cream',
            settings: roomSettings,
            timers: {
              cream: (roomSettings.minutes || 0) * 60_000,
              black: (roomSettings.minutes || 0) * 60_000
            },
            timerStarted: null,
            timerLastTick: null,
            timerInterval: null,
            finished: false
          }
        )

        socket.join(code)

        socket.data.roomCode = code
        socket.data.playerColor = hostColor

        if (typeof callback === "function") {
  callback({
    success: true,
    code,
    color: hostColor,
    settings: rooms.get(code)?.settings,
    watchKey
  });
}

        console.log(
          `Room created: ${code}`
        )
      }
    )


    // ========================================
    // دخول روم
    // ========================================

    socket.on(
      'join-room',
      (
        rawCode,
        playerNameOrCallback,
        callback
      ) => {

        const playerName =
          typeof playerNameOrCallback === 'string'
            ? normalizePlayerName(playerNameOrCallback)
            : 'لاعب'

        if (typeof playerNameOrCallback === 'function') {
          callback = playerNameOrCallback
        }

        const code =
          String(rawCode).trim()

        const room =
          rooms.get(code)

        if (!room) {
          callback({
            success: false,
            message:
              'الروم غير موجود'
          })

          return
        }

        if (room.host === socket.id) {
          callback({
            success: false,
            message:
              'أنت صاحب هذا الروم'
          })

          return
        }

        if (room.guest) {
          callback({
            success: false,
            message:
              'الروم ممتلئ'
          })

          return
        }

        closeRoomForSocket(socket)

        const guestColor = room.hostColor === 'cream' ? 'black' : 'cream'

        room.guest = socket.id
        room.guestName = playerName
        room.turn = 'cream'

        socket.join(code)

        socket.data.roomCode = code
        socket.data.playerColor = guestColor

if (typeof callback === "function") {
  callback({
    success: true,
    code: code,
    color: guestColor,
    settings: room.settings,
    opponentName: room.hostName,
    watchKey: room.watchKey
  });
}

        socket.to(code).emit('player-joined', {
          code,
          settings: room.settings,
          playerName: room.guestName
        })

        startRoomClock(room, code, 'cream')

        console.log(
          `Player joined: ${code}`
        )
      }
    )


// ========================================
    // حركة لاعب
    // ========================================

    socket.on(
      'game-move',
      move => {

        const code =
          socket.data.roomCode

        if (!code) return

        const room =
          rooms.get(code)

        if (!room || !room.guest) {
          return
        }

        if (room.finished) return

        const playerColor =
          getPlayerColor(
            room,
            socket.id
          )

        if (!playerColor) return

        // حماية أساسية للدور.
        if (room.turn !== playerColor) {
          return
        }

        if (
          move?.color !==
          playerColor
        ) {
          return
        }

        const coordinates = [
          move.fromRow,
          move.fromCol,
          move.row,
          move.col
        ]

        if (
          coordinates.some(value =>
            !Number.isInteger(value) || value < 0 || value > 7
          ) ||
          typeof move.capture !== 'boolean' ||
          typeof move.continueCapture !== 'boolean'
        ) {
          return
        }

        if (
          move.capture &&
          (!Number.isInteger(move.capturedRow) ||
            !Number.isInteger(move.capturedCol) ||
            move.capturedRow < 0 ||
            move.capturedRow > 7 ||
            move.capturedCol < 0 ||
            move.capturedCol > 7)
        ) {
          return
        }

        if (move.continueCapture && !move.capture) return

        if (room.settings?.mode === 'time') {
          if (updateRoomClock(room, code)) return
          if (room.timerStarted !== playerColor) return
        }

        const nextTurn =
          move?.nextTurn

        if (
          nextTurn !== 'cream' &&
          nextTurn !== 'black'
        ) {
          return
        }

        const expectedNextTurn = move.continueCapture
          ? playerColor
          : playerColor === 'cream' ? 'black' : 'cream'

        if (nextTurn !== expectedNextTurn) return

        room.moveHistory.push(move)

        room.turn = nextTurn
        if (room.settings?.mode === 'time') {
          startRoomClock(room, code, nextTurn)
        }

        socket
          .to(code)
          .emit(
            'game-move',
            move
          )
      }
    )

    socket.on('spectate-room', (request, callback) => {
      const code = String(request?.code || '')
      const room = rooms.get(code)

      if (
        !room ||
        !room.guest ||
        room.watchKey !== request?.watchKey ||
        room.finished
      ) {
        callback?.({
          success: false,
          message: 'المباراة غير متاحة للمشاهدة'
        })
        return
      }

      if (socket.id === room.host || socket.id === room.guest) {
        callback?.({
          success: false,
          message: 'أنت أحد لاعبي هذه المباراة'
        })
        return
      }

      if (
        room.settings?.mode === 'time' &&
        updateRoomClock(room, code)
      ) {
        callback?.({
          success: false,
          message: 'انتهى وقت المباراة'
        })
        return
      }

      socket.join(code)
      socket.data.spectatingRoomCode = code
      callback?.({
        success: true,
        code,
        hostName: room.hostName,
        guestName: room.guestName,
        settings: room.settings,
        turn: room.turn,
        moveHistory: room.moveHistory,
        clocks: {
          cream: Math.ceil(room.timers.cream / 1000),
          black: Math.ceil(room.timers.black / 1000)
        }
      })
    })

    socket.on('stop-spectating', () => {
      const code = socket.data.spectatingRoomCode
      if (!code) return
      socket.leave(code)
      socket.data.spectatingRoomCode = null
    })

    socket.on('game-finished', () => {
      const code = socket.data.roomCode
      const room = code && rooms.get(code)
      if (!room) return
      room.finished = true
      clearRoomClock(room)
      io.to(code).emit('spectated-game-finished')
    })



    // ========================================
    // تحديد قطعة اللاعب
    // ========================================

    socket.on(
      'piece-selected',
      data => {
        const code = socket.data.roomCode

        if (!code) return

        if (
          !data ||
          !Number.isInteger(data.row) ||
          !Number.isInteger(data.col) ||
          data.row < 0 ||
          data.row > 7 ||
          data.col < 0 ||
          data.col > 7
        ) {
          return
        }

        socket
          .to(code)
          .emit('piece-selected', data)
      }
    )

    // ========================================
    // إعادة المباراة
    // ========================================

    socket.on(
      'restart-game',
      () => {

        const code =
          socket.data.roomCode

        if (!code) return

        const room =
          rooms.get(code)

        if (
          !room ||
          !room.guest
        ) {
          return
        }

        room.turn = 'cream'
        room.finished = false
        room.moveHistory = []
        clearRoomClock(room)
        room.timers = {
          cream: (room.settings.minutes || 0) * 60_000,
          black: (room.settings.minutes || 0) * 60_000
        }

        io
          .to(code)
          .emit(
            'restart-game'
          )

        startRoomClock(room, code, 'cream')
      }
    )


    // ========================================
    // خروج من الروم بدون إغلاق الاتصال
    // ========================================

    socket.on(
      'leave-room',
      () => {
        closeRoomForSocket(socket)
      }
    )


    // ========================================
    // انقطاع اللاعب
    // ========================================

    socket.on(
      'disconnect',
      () => {
        closeRoomForSocket(socket)

        console.log(
          'Player disconnected:',
          socket.id
        )
      }
    )
  }
)


// ========================================
// تشغيل السيرفر
// ========================================

const PORT =
  process.env.PORT || 3001

httpServer.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `Online server running on port ${PORT}`
    )
  }
)
