import path from 'path'
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
    return 'cream'
  }

  if (room.guest === socketId) {
    return 'black'
  }

  return null
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
      callback => {

        // لو اللاعب داخل روم قديم
        // نخرجه منه أولًا.
        closeRoomForSocket(socket)

        const code =
          generateRoomCode()

        rooms.set(
          code,
          {
            host: socket.id,
            guest: null,
            turn: 'cream'
          }
        )

        socket.join(code)

        socket.data.roomCode = code
        socket.data.playerColor =
          'cream'

        callback({
          success: true,
          code,
          color: 'cream'
        })

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
        callback
      ) => {

        const code =
          String(rawCode || '')
            .trim()

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

        room.guest = socket.id
        room.turn = 'cream'

        socket.join(code)

        socket.data.roomCode = code
        socket.data.playerColor =
          'black'

        callback({
          success: true,
          code,
          color: 'black'
        })

        io
          .to(code)
          .emit(
            'player-joined',
            { code }
          )

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

        const nextTurn =
          move?.nextTurn

        if (
          nextTurn !== 'cream' &&
          nextTurn !== 'black'
        ) {
          return
        }

        room.turn = nextTurn

        socket
          .to(code)
          .emit(
            'game-move',
            move
          )
      }
    )



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
          !Number.isInteger(data.col)
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

        io
          .to(code)
          .emit(
            'restart-game'
          )
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
