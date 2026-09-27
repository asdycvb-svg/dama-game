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
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin)

const socket = io(ONLINE_SERVER_URL, { autoConnect:true, reconnection:true, reconnectionAttempts:Infinity });

let onlineRoomCode = null
let onlinePlayerColor = null
let onlineMode = false
let spectatingMode = false
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

  if (spectatingMode) {
    setTurnText('انتهت المباراة')
    return
  }

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
  document.querySelector('#roomInviteDock')?.remove()
  document.querySelector('#roomInvitePage')?.remove()
  setActivePresenceRoom(onlineRoomCode, currentRoomWatchKey)
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
    startMatchTimer()
  }
})

socket.on('game-move', (move) => {
  if (!onlineMode) return

  if (spectatingMode) {
    applySpectatorMove(move)
  }
  else {
    applyRemoteOnlineMove(move)
  }
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
  if (spectatingMode) {
    resetSpectatorBoard()
    return
  }

  setActivePresenceRoom(onlineRoomCode, currentRoomWatchKey)
  startOnlineGame()
})

socket.on('player-left', () => {
  if (!onlineMode) return

  if (spectatingMode) {
    setTurnText('انتهت المباراة')
    return
  }

  onlineOpponentConnected = false

  if (!gameOver) {
    finishGame(
      'فزت! خصمك انسحب من المباراة 👑'
    )
  }
})

socket.on('spectated-game-finished', () => {
  if (spectatingMode) {
    setTurnText('انتهت المباراة')
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

let presenceInterval = null
let friendsRefreshInterval = null
let activePresenceRoom = null
let activePresenceWatchKey = null
let currentRoomWatchKey = null
let loadingFriends = false
let presencePageHideBound = false
let gameInviteRefreshInterval = null
let checkingGameInvites = false
let gameInvitesUnavailable = false
let lastGameInviteError = ''
let pendingGameInvites = []

async function publishPresence(isOnline) {
  if (!currentAuthUser) return

  const { error } = await supabase.rpc(
    'set_my_presence',
    {
      p_is_online: isOnline,
      p_active_room: isOnline ? activePresenceRoom : null,
      p_active_watch_key: isOnline ? activePresenceWatchKey : null
    }
  )

  if (error) {
    console.warn('تعذر تحديث حالة الاتصال:', error.message)
  }
}

function startPresenceTracking() {
  if (!currentAuthUser || presenceInterval) return

  publishPresence(true)
  presenceInterval = setInterval(
    () => publishPresence(true),
    25000
  )
  checkPendingGameInvites()
  gameInviteRefreshInterval = setInterval(
    checkPendingGameInvites,
    10000
  )

  if (!presencePageHideBound) {
    window.addEventListener('pagehide', () => {
      if (!currentAuthUser) return

      supabase.rpc('set_my_presence', {
        p_is_online: false,
        p_active_room: null,
        p_active_watch_key: null
      })
    })
    presencePageHideBound = true
  }
}

async function stopPresenceTracking() {
  if (presenceInterval) {
    clearInterval(presenceInterval)
    presenceInterval = null
  }

  if (gameInviteRefreshInterval) {
    clearInterval(gameInviteRefreshInterval)
    gameInviteRefreshInterval = null
  }

  pendingGameInvites = []
  renderGameInvitesList()

  await publishPresence(false)
}

function setActivePresenceRoom(roomCode, watchKey) {
  activePresenceRoom = roomCode || null
  activePresenceWatchKey = watchKey || null
  publishPresence(true)
}

async function checkPendingGameInvites() {
  if (!currentAuthUser || checkingGameInvites) return

  checkingGameInvites = true
  const { data, error } = await supabase.rpc('get_pending_game_invites')
  checkingGameInvites = false

  if (error) {
    gameInvitesUnavailable = true
    const errorKey = `${error.code || ''}:${error.message || ''}`
    if (errorKey !== lastGameInviteError) {
      console.warn('تعذر تحميل دعوات اللعب. تحقق من ترحيل الدعوات في Supabase:', error.message)
      lastGameInviteError = errorKey
    }
    renderGameInvitesList()
    return
  }

  gameInvitesUnavailable = false
  lastGameInviteError = ''
  pendingGameInvites = data || []
  renderGameInvitesList()
}

function renderGameInvitesList() {
  const list = document.querySelector('#gameInvitesList')
  const count = document.querySelector('#gameInvitesCount')
  if (count) count.textContent = pendingGameInvites.length
  if (!list) return

  list.replaceChildren()
  if (pendingGameInvites.length === 0) {
    list.append(createFriendEmptyState(
      gameInvitesUnavailable
        ? 'تعذر تحميل الطلبات. شغّل ترحيل الدعوات في Supabase.'
        : 'لا توجد طلبات لعب واردة'
    ))
    return
  }

  pendingGameInvites.forEach(invite => {
    const row = document.createElement('div')
    row.className = 'friend-list-item game-invite-list-item'

    const copy = document.createElement('div')
    copy.className = 'friend-list-copy'
    const name = document.createElement('strong')
    name.textContent = invite.sender_name
    const detail = document.createElement('small')
    const expiresInMinutes = Math.max(
      1,
      Math.ceil((new Date(invite.expires_at).getTime() - Date.now()) / 60000)
    )
    detail.textContent = `دعوة للعب • تنتهي خلال ${expiresInMinutes} د`
    copy.append(name, detail)

    const actions = document.createElement('div')
    actions.className = 'friend-request-actions'

    const accept = document.createElement('button')
    accept.type = 'button'
    accept.className = 'friend-accept-btn'
    accept.textContent = 'دخول'
    accept.addEventListener('click', async () => {
      if (document.querySelector('#board') && !gameOver) {
        setFriendMessage('أنه المباراة الحالية أولًا.')
        return
      }

      accept.disabled = true
      const joined = await joinInvitedRoom(invite, detail)
      if (!joined) {
        accept.disabled = false
        return
      }

      const { error } = await supabase.rpc('respond_game_invite', {
        p_invite_id: invite.invite_id,
        p_accept: true
      })
      if (error) console.warn('تعذر تحديث حالة الدعوة:', error.message)
      pendingGameInvites = pendingGameInvites.filter(
        pending => pending.invite_id !== invite.invite_id
      )
      renderGameInvitesList()
    })

    const decline = document.createElement('button')
    decline.type = 'button'
    decline.className = 'friend-decline-btn'
    decline.textContent = 'رفض'
    decline.addEventListener('click', async () => {
      decline.disabled = true
      const { error } = await supabase.rpc('respond_game_invite', {
        p_invite_id: invite.invite_id,
        p_accept: false
      })
      if (error) {
        setFriendMessage(error.message)
        decline.disabled = false
        return
      }
      pendingGameInvites = pendingGameInvites.filter(
        pending => pending.invite_id !== invite.invite_id
      )
      renderGameInvitesList()
    })

    actions.append(accept, decline)
    row.append(copy, actions)
    list.append(row)
  })
}

async function joinInvitedRoom(invite, messageElement) {
  if (!socket.connected) {
    try {
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('connect_error', reject)
        socket.connect()
      })
    }
    catch (error) {
      messageElement.textContent = 'تعذر الاتصال بسيرفر اللعب.'
      return false
    }
  }

  return new Promise(resolve => {
    socket.emit('join-room', invite.room_code, playerProfile.name, response => {
      if (!response?.success) {
        messageElement.textContent = response?.message || 'الروم لم يعد متاحًا.'
        resolve(false)
        return
      }

      onlineRoomCode = response.code
      currentRoomWatchKey = response.watchKey
      onlinePlayerColor = response.color
      onlineMode = true
      spectatingMode = false
      onlineOpponentConnected = true
      onlineOpponentRating = null
      onlineOpponentName = response.opponentName || invite.sender_name
      if (response.settings) onlineRoomSettings = response.settings
      currentLevel = 'online'
      setActivePresenceRoom(onlineRoomCode, currentRoomWatchKey)
      startOnlineGame()
      resolve(true)
    })
  })
}

function openFriendsView() {
  refreshFriendsView()
  stopFriendsRefresh()
  friendsRefreshInterval = setInterval(
    refreshFriendsView,
    12000
  )
}

function stopFriendsRefresh() {
  if (friendsRefreshInterval) {
    clearInterval(friendsRefreshInterval)
    friendsRefreshInterval = null
  }
}

function showFriendsInbox(view) {
  const homePanel = document.querySelector('#friendsHomePanel')
  const requestsPanel = document.querySelector('#friendRequestsPanel')
  const gameInvitesPanel = document.querySelector('#gameInvitesPanel')
  const friendsHeader = document.querySelector('.friends-page-header')

  homePanel.hidden = view !== 'home'
  requestsPanel.hidden = view !== 'friend-requests'
  gameInvitesPanel.hidden = view !== 'game-invites'
  friendsHeader.hidden = view !== 'home'

  if (view === 'friend-requests') {
    refreshFriendsView()
  }
  else if (view === 'game-invites') {
    checkPendingGameInvites()
  }
}

async function refreshFriendsView() {
  const authNotice = document.querySelector('#friendsAuthNotice')
  const content = document.querySelector('#friendsContent')
  const message = document.querySelector('#friendActionMessage')

  if (!currentAuthUser) {
    if (authNotice) authNotice.hidden = false
    if (content) content.hidden = true
    return
  }

  if (authNotice) authNotice.hidden = true
  if (content) content.hidden = false
  if (loadingFriends) return

  loadingFriends = true
  let [profileResult, codeResult, requestsResult, friendsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('friend_code')
      .eq('id', currentAuthUser.id)
      .maybeSingle(),
    supabase.rpc('get_my_friend_code'),
    supabase.rpc('get_friend_requests'),
    supabase.rpc('get_my_friends')
  ])

  if (
    currentAuthUser &&
    !profileResult.error &&
    !profileResult.data &&
    !codeResult.data
  ) {
    const profileUserId = currentAuthUser.id
    const profileLoaded = await loadCloudProfile(currentAuthUser)
    if (profileLoaded === false || !currentAuthUser) {
      loadingFriends = false
      await refreshAuthUI()
      return
    }

    ;[profileResult, codeResult] = await Promise.all([
      supabase
        .from('profiles')
        .select('friend_code')
        .eq('id', profileUserId)
        .maybeSingle(),
      supabase.rpc('get_my_friend_code')
    ])
  }

  loadingFriends = false

  const friendCode =
    profileResult.data?.friend_code || codeResult.data

  document.querySelector('#myFriendCode').textContent =
    friendCode || '-----'

  const codeError = friendCode
    ? null
    : profileResult.error || codeResult.error
  const listError = requestsResult.error || friendsResult.error

  if (codeError || !friendCode) {
    if (message) {
      message.textContent = codeError
        ? 'تعذر جلب معرّفك من قاعدة البيانات. تحقق من ترحيل الأصدقاء وإعدادات Supabase.'
        : 'ملف حسابك لا يحتوي معرّفًا بعد؛ أعد فتح قائمة الأصدقاء بعد لحظات.'
    }

    const error = codeError || listError
    if (error) {
      console.warn('تعذر تحميل بيانات الأصدقاء:', error.message)
    }
  }
  else if (listError) {
    if (message) message.textContent = 'المعرّف جاهز، لكن تعذر تحميل الطلبات أو الأصدقاء.'
    console.warn('تعذر تحميل قائمة الأصدقاء:', listError.message)
  }
  else if (message) {
    message.textContent = ''
  }

  const requests = requestsResult.data || []
  const friends = friendsResult.data || []
  document.querySelector('#friendRequestsCount').textContent = requests.length
  document.querySelector('#friendsOnlineCount').textContent =
    friends.filter(friend => friend.is_online).length

  renderFriendRequests(requests)
  renderFriendsList(friends)
}

function renderFriendRequests(requests) {
  const list = document.querySelector('#friendRequestsList')
  const count = document.querySelector('#friendRequestsCount')
  if (count) count.textContent = requests.length
  if (!list) return
  list.replaceChildren()

  if (requests.length === 0) {
    list.append(createFriendEmptyState('لا توجد طلبات جديدة'))
    return
  }

  requests.forEach(request => {
    const row = document.createElement('div')
    row.className = 'friend-list-item'

    const copy = document.createElement('div')
    copy.className = 'friend-list-copy'
    const name = document.createElement('strong')
    name.textContent = request.sender_name
    const code = document.createElement('small')
    code.textContent = `المعرّف ${request.sender_code}`
    copy.append(name, code)

    const actions = document.createElement('div')
    actions.className = 'friend-request-actions'
    actions.append(
      createRequestAction(request.request_id, true),
      createRequestAction(request.request_id, false)
    )
    row.append(copy, actions)
    list.append(row)
  })
}

function createRequestAction(requestId, accept) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = accept ? 'friend-accept-btn' : 'friend-decline-btn'
  button.textContent = accept ? 'قبول' : 'رفض'
  button.addEventListener('click', async () => {
    const { error } = await supabase.rpc('respond_friend_request', {
      p_request_id: requestId,
      p_accept: accept
    })
    if (error) {
      setFriendMessage(error.message)
      return
    }
    refreshFriendsView()
  })
  return button
}

function renderFriendsList(friends) {
  const list = document.querySelector('#friendsList')
  if (!list) return
  list.replaceChildren()

  if (friends.length === 0) {
    list.append(createFriendEmptyState('لم تضف أصدقاء بعد'))
    return
  }

  friends.forEach(friend => {
    const row = document.createElement('div')
    row.className = 'friend-list-item'

    const status = document.createElement('span')
    status.className = friend.is_online
      ? 'friend-presence-dot is-online'
      : 'friend-presence-dot'
    status.setAttribute('aria-label', friend.is_online ? 'متصل' : 'غير متصل')

    const copy = document.createElement('div')
    copy.className = 'friend-list-copy'
    const name = document.createElement('strong')
    name.textContent = friend.friend_name
    const presence = document.createElement('small')
    presence.textContent = friend.is_online
      ? 'متصل الآن'
      : formatFriendLastSeen(friend.last_seen)
    copy.append(name, presence)

    row.append(status, copy)
    if (friend.is_online && friend.active_room && friend.active_watch_key) {
      const watchButton = document.createElement('button')
      watchButton.type = 'button'
      watchButton.className = 'friend-watch-btn'
      watchButton.textContent = 'مشاهدة'
      watchButton.addEventListener('click', () => watchFriendMatch(friend))
      row.append(watchButton)
    }

    list.append(row)
  })
}

async function watchFriendMatch(friend) {
  stopFriendsRefresh()

  if (!socket.connected) {
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('connect_error', reject)
      socket.connect()
    })
  }

  socket.timeout(10000).emit(
    'spectate-room',
    {
      code: friend.active_room,
      watchKey: friend.active_watch_key
    },
    (socketError, response) => {
      if (socketError) {
        alert('لم يستجب سيرفر اللعب. تحقق من عنوان VITE_SOCKET_URL وتشغيل الخادم.');
        return
      }

      if (!response?.success) {
        setFriendMessage(response?.message || 'تعذرت مشاهدة المباراة')
        return
      }

      spectatingMode = true
      onlineMode = true
      onlineRoomCode = response.code
      onlinePlayerColor = null
      onlineOpponentConnected = true
      onlineRoomSettings = response.settings || { mode: 'no-time' }
      onlineClocks = response.clocks || { cream: 0, black: 0 }
      gameOver = false
      currentTurn = response.turn || 'cream'
      currentLevel = 'spectator'
      renderSpectatorGame(response)
    }
  )
}

async function openRoomInviteView() {
  if (document.querySelector('#roomInvitePage')) return

  const page = document.createElement('section')
  page.id = 'roomInvitePage'
  page.className = 'room-invite-page'
  page.innerHTML = `
    <div class="room-invite-page-content">
      <header class="room-invite-page-header">
        <button id="roomInviteBackBtn" class="profile-back-btn" type="button">← رجوع</button>
        <div>
          <h2>دعوة صديق للعب</h2>
          <p>اختر صديقًا لإرسال دعوة إلى الروم ${onlineRoomCode}.</p>
        </div>
      </header>
      <div id="roomInvitePicker" class="room-invite-picker"></div>
      <p id="roomInviteMessage" class="room-invite-message" aria-live="polite"></p>
    </div>
  `
  document.body.append(page)

  document.querySelector('#roomInviteBackBtn').onclick = () => page.remove()

  const picker = document.querySelector('#roomInvitePicker')
  picker.append(createFriendEmptyState('جاري تحميل الأصدقاء...'))

  if (!currentAuthUser) {
    picker.replaceChildren(createFriendEmptyState('سجّل الدخول لإرسال دعوة.'))
    return
  }

  const { data, error } = await supabase.rpc('get_my_friends')
  if (!page.isConnected) return
  picker.replaceChildren()

  if (error) {
    picker.append(createFriendEmptyState('تعذر تحميل قائمة الأصدقاء.'))
    return
  }

  const friends = data || []
  if (friends.length === 0) {
    picker.append(createFriendEmptyState('أضف صديقًا أولًا من قائمة الأصدقاء.'))
    return
  }

  friends.forEach(friend => {
    const row = document.createElement('div')
    row.className = 'room-invite-friend'

    const copy = document.createElement('div')
    copy.className = 'friend-list-copy'
    const name = document.createElement('strong')
    name.textContent = friend.friend_name
    const status = document.createElement('small')
    status.textContent = friend.is_online ? 'متصل الآن' : 'غير متصل'
    copy.append(name, status)

    const inviteButton = document.createElement('button')
    inviteButton.type = 'button'
    inviteButton.className = 'friend-watch-btn'
    inviteButton.textContent = 'إرسال'
    inviteButton.addEventListener('click', async () => {
      inviteButton.disabled = true
      const { error: inviteError } = await supabase.rpc('send_game_invite', {
        p_friend_code: friend.friend_code,
        p_room_code: onlineRoomCode,
        p_watch_key: currentRoomWatchKey
      })

      if (inviteError) {
        inviteButton.disabled = false
        const functionMissing =
          inviteError.code === 'PGRST202' || inviteError.status === 404

        setFriendMessage(
          functionMissing
            ? 'دعوات اللعب غير مفعّلة على قاعدة البيانات. شغّل ترحيل game_invites في Supabase ثم أعد المحاولة.'
            : inviteError.message
        )
        return
      }

      inviteButton.textContent = 'تم الإرسال'
      setFriendMessage(`أُرسلت الدعوة إلى ${friend.friend_name}، وصلاحيتها 10 دقائق.`)
    })

    row.append(copy, inviteButton)
    picker.append(row)
  })
}

function renderSpectatorGame(match) {
  document.querySelector('#app').innerHTML = `
    <main class="game-page spectator-game-page">
      <div class="game-header">
        <button id="exitSpectatingBtn" class="exit-game-btn" type="button">رجوع</button>
        <div class="game-info">
          <h2>مشاهدة مباراة</h2>
          <p>روم ${match.code}</p>
        </div>
      </div>

      <div class="spectator-player-row">
        <div class="spectator-player-info">
          <span class="player-piece cream-player"></span>
          <strong id="spectatorCreamName"></strong>
          <strong id="creamClock" class="player-clock" hidden>00:00</strong>
        </div>
        <div class="spectator-player-info">
          <span class="player-piece black-player"></span>
          <strong id="spectatorBlackName"></strong>
          <strong id="blackClock" class="player-clock" hidden>00:00</strong>
        </div>
      </div>

      <div id="board" class="board"></div>

      <div class="turn-box spectator-turn-box">
        <span id="turnText">المشاهدة مباشرة</span>
      </div>
    </main>
  `

  document.querySelector('#spectatorCreamName').textContent =
    match.hostName || 'الحليبي'
  document.querySelector('#spectatorBlackName').textContent =
    match.guestName || 'الأسود'

  document.querySelector('#exitSpectatingBtn').onclick = () => {
    socket.emit('stop-spectating')
    spectatingMode = false
    onlineMode = false
    onlineRoomCode = null
    onlineOpponentConnected = false
    showHome()
  }

  createBoard()
  ;(match.moveHistory || []).forEach(move => {
    applySpectatorMove(move, false)
  })
  renderOnlineClocks()
}

function resetSpectatorBoard() {
  document.querySelector('#board').replaceChildren()
  createBoard()
  currentTurn = 'cream'
  setTurnText('المشاهدة مباشرة')
}

function applySpectatorMove(move, playSound = true) {
  if (!move) return

  const piece = getPieceAt(
    Number(move.fromRow),
    Number(move.fromCol)
  )
  const target = getSquare(
    Number(move.row),
    Number(move.col)
  )

  if (!piece || !target) return

  if (move.capture) {
    getPieceAt(
      Number(move.capturedRow),
      Number(move.capturedCol)
    )?.remove()
  }

  target.appendChild(piece)
  if (playSound) playMoveSound()
  promoteIfNeeded(piece)
  currentTurn = move.nextTurn || getOppositeColor(move.color)
}

function createFriendEmptyState(text) {
  const empty = document.createElement('p')
  empty.className = 'friend-empty-state'
  empty.textContent = text
  return empty
}

function formatFriendLastSeen(value) {
  if (!value) return 'لا يوجد ظهور سابق'
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(elapsed / 60000)
  if (minutes < 1) return 'آخر ظهور قبل لحظات'
  if (minutes < 60) return `آخر ظهور قبل ${minutes} د`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `آخر ظهور قبل ${hours} س`
  return `آخر ظهور ${new Date(value).toLocaleDateString('ar')}`
}

async function sendFriendRequestFromForm(event) {
  event.preventDefault()
  const input = document.querySelector('#friendCodeInput')
  const code = input.value.trim()
  if (!/^\d{5}$/.test(code)) {
    setFriendMessage('أدخل معرّفًا من 5 أرقام')
    return
  }

  const { data, error } = await supabase.rpc('send_friend_request', {
    p_friend_code: code
  })
  if (error) {
    setFriendMessage(error.message)
    return
  }

  input.value = ''
  setFriendMessage(`تم إرسال الطلب إلى ${data}`)
  refreshFriendsView()
}

function setFriendMessage(text) {
  const message =
    document.querySelector('#roomInviteMessage') ||
    document.querySelector('#friendActionMessage')
  if (message) message.textContent = text
}

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
      if (
        insertError.code === '23503' &&
        insertError.message?.includes('profiles_id_fkey')
      ) {
        const accountNotice =
          document.querySelector('#accountSessionNotice')

        if (accountNotice) {
          accountNotice.hidden = false
          accountNotice.textContent =
            'جلسة الدخول هذه لم تعد مرتبطة بحساب صالح. سجّل الدخول مجددًا.'
        }

        await stopPresenceTracking()
        await supabase.auth.signOut({ scope: 'local' })
        currentAuthUser = null
        activePresenceRoom = null
        activePresenceWatchKey = null
        return false
      }

      console.error(
        'خطأ في إنشاء ملف اللاعب:',
        insertError
      )

      return
    }

    playerProfile = freshProfile

    updateProfileUI()

    return true
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
      easy: {
        ...defaults.levels.easy,
        ...(data.levels?.easy || {})
      },
      medium: {
        ...defaults.levels.medium,
        ...(data.levels?.medium || {})
      },
      hard: {
        ...defaults.levels.hard,
        ...(data.levels?.hard || {})
      },
      impossible: {
        ...defaults.levels.impossible,
        ...(data.levels?.impossible || {})
      },
      khaled: {
        ...defaults.levels.khaled,
        ...(data.levels?.khaled || {})
      },
      online: {
        ...defaults.levels.online,
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

  if (
    data
      .levels
      ?.progress
      ?.rating == null
  ) {
    await saveCloudProfile()
  }

  updateProfileUI()
  return true
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
let currentGameReview = null
let trainingUndoSnapshots = []
let trainingTurnStartSnapshot = null
let trainingLastMoveExplanation = ''
let pendingProfileSave =
  Promise.resolve()

function captureGameReviewPosition(move = null) {
  const reviewMove = move
    ? {
        color: move.color,
        fromRow: Number(move.fromRow),
        fromCol: Number(move.fromCol),
        row: Number(move.row),
        col: Number(move.col),
        capture: Boolean(move.capture),
        capturedRow: move.capturedRow == null ? null : Number(move.capturedRow),
        capturedCol: move.capturedCol == null ? null : Number(move.capturedCol),
        continueCapture: Boolean(move.continueCapture)
      }
    : null

  return {
    move: reviewMove,
    turn: currentTurn,
    pieces: Array.from(
      document.querySelectorAll('.checker-piece')
    ).map(piece => ({
      row: Number(piece.parentElement.dataset.row),
      col: Number(piece.parentElement.dataset.col),
      color: piece.dataset.color,
      king: piece.dataset.king === 'true'
    }))
  }
}

function resetGameReview() {
  currentGameReview = {
    positions: [captureGameReviewPosition()]
  }
}

function recordGameReviewMove(move) {
  if (!currentGameReview) resetGameReview()
  currentGameReview.positions.push(
    captureGameReviewPosition(move)
  )
}

function paintGameReviewPosition(board, position) {
  board.replaceChildren()

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement('div')
      square.className = `square ${(row + col) % 2 ? 'dark-square' : 'light-square'}`
      square.dataset.row = row
      square.dataset.col = col

      const state = position.pieces.find(
        piece => piece.row === row && piece.col === col
      )
      if (state) {
        const piece = createPiece(state.color)
        if (state.king) {
          piece.dataset.king = 'true'
          piece.classList.add('king')
          const symbol = document.createElement('span')
          symbol.className = 'king-symbol'
          symbol.textContent = '♛'
          piece.append(symbol)
        }
        square.append(piece)
      }

      board.append(square)
    }
  }

  if (currentLevel === 'online' && onlinePlayerColor === 'black') {
    Array.from(board.children)
      .reverse()
      .forEach(square => board.append(square))
  }
}

function renderGameReviewPosition(overlay, index) {
  const positions = currentGameReview?.positions || []
  if (!positions.length) return

  const safeIndex = Math.max(0, Math.min(index, positions.length - 1))
  const position = positions[safeIndex]
  const board = overlay.querySelector('#reviewBoard')
  if (!board) return

  paintGameReviewPosition(board, position)
  overlay.querySelector('#reviewMoveCount').textContent =
    `${safeIndex} / ${positions.length - 1}`
  overlay.querySelector('#reviewMoveDescription').textContent =
    safeIndex === 0
      ? 'بداية المباراة'
      : describeGameReviewMove(position.move, safeIndex)
  overlay.querySelector('#reviewStartBtn').disabled = safeIndex === 0
  overlay.querySelector('#reviewPrevBtn').disabled = safeIndex === 0
  overlay.querySelector('#reviewNextBtn').disabled = safeIndex === positions.length - 1
  overlay.querySelector('#reviewEndBtn').disabled = safeIndex === positions.length - 1
  overlay.dataset.position = safeIndex
}

function describeGameReviewMove(move, index) {
  if (!move) return `النقلة ${index}`
  const color = move.color === 'cream' ? 'الحليبي' : 'الأسود'
  const from = `${Number(move.fromRow) + 1},${Number(move.fromCol) + 1}`
  const to = `${Number(move.row) + 1},${Number(move.col) + 1}`
  const action = move.capture ? 'أكل' : 'نقل'
  const continuation = move.continueCapture ? ' • يتبعها أكل متصل' : ''
  return `${color}: ${action} من ${from} إلى ${to}${continuation}`
}

function openGameReview() {
  const positions = currentGameReview?.positions || []
  if (positions.length < 2) return

  document.querySelector('.game-review-overlay')?.remove()
  const overlay = document.createElement('div')
  overlay.className = 'game-review-overlay'
  overlay.innerHTML = `
    <section class="game-review-panel" role="dialog" aria-modal="true" aria-labelledby="gameReviewTitle">
      <header class="game-review-header">
        <div>
          <small>إعادة المباراة</small>
          <h2 id="gameReviewTitle">مراجعة المباراة</h2>
        </div>
        <button id="closeGameReviewBtn" class="game-review-close" type="button" aria-label="إغلاق المراجعة">×</button>
      </header>
      <p id="reviewMoveDescription" class="review-move-description"></p>
      <div id="reviewBoard" class="board review-board" aria-label="لوح مراجعة المباراة"></div>
      <footer class="game-review-controls">
        <button id="reviewStartBtn" type="button" title="بداية المباراة" aria-label="بداية المباراة">|◀</button>
        <button id="reviewPrevBtn" type="button" title="النقلة السابقة" aria-label="النقلة السابقة">◀</button>
        <output id="reviewMoveCount" aria-live="polite"></output>
        <button id="reviewNextBtn" type="button" title="النقلة التالية" aria-label="النقلة التالية">▶</button>
        <button id="reviewEndBtn" type="button" title="نهاية المباراة" aria-label="نهاية المباراة">▶|</button>
      </footer>
    </section>
  `
  document.body.append(overlay)

  let positionIndex = positions.length - 1
  const navigate = offset => {
    positionIndex += offset
    renderGameReviewPosition(overlay, positionIndex)
  }

  overlay.querySelector('#closeGameReviewBtn').onclick = () => overlay.remove()
  overlay.querySelector('#reviewStartBtn').onclick = () => {
    positionIndex = 0
    renderGameReviewPosition(overlay, positionIndex)
  }
  overlay.querySelector('#reviewPrevBtn').onclick = () => navigate(-1)
  overlay.querySelector('#reviewNextBtn').onclick = () => navigate(1)
  overlay.querySelector('#reviewEndBtn').onclick = () => {
    positionIndex = positions.length - 1
    renderGameReviewPosition(overlay, positionIndex)
  }
  renderGameReviewPosition(overlay, positionIndex)
}

// ========================================
// ♛ نظام التصنيف بالنقاط - أونلاين فقط
// ========================================

const RATING_START = 0
const RATING_MIN = 0
const RATING_MAX = Infinity
const RATING_K = 14
const LOCAL_RATING_RESET_KEY = 'damagame_rating_zero_reset_v1'

const RATING_TIERS = [
  {
    key: 'beginner',
    label: 'مبتدئ',
    min: 0,
    max: 40
  },
  {
    key: 'intermediate',
    label: 'متوسط',
    min: 41,
    max: 70
  },
  {
    key: 'grandmaster',
    label: 'جراند ماستر',
    min: 71,
    max: Infinity
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

  else {
    percent = 100
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
  return {
    moves: currentGameMoves,
    pieceAdvantage: capturedDifference,
    margin,
    elapsedMs
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
  const elapsedMs = Number(performance.elapsedMs || 0)

  if (elapsedMs < 30000) {
    return {
      before: playerRating,
      after: playerRating,
      change: 0,
      opponent: safeOpponentRating
    }
  }

  let bonus = 0
  let penalty = 0

  if (playerWon) {
    if (elapsedMs < 120000) bonus += 7
    else if (elapsedMs < 300000) bonus += 3
    bonus += Math.min(8, pieceAdvantage * 2)
  }

  else {
    penalty += Math.min(8, Math.max(2, margin))
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
        losses: 0,
        winStreak: 0,
        bestWinStreak: 0
      },

      medium: {
        played: 0,
        wins: 0,
        losses: 0,
        winStreak: 0,
        bestWinStreak: 0
      },

      hard: {
        played: 0,
        wins: 0,
        losses: 0,
        winStreak: 0,
        bestWinStreak: 0
      },

      impossible: {
  played: 0,
  wins: 0,
        losses: 0,
        winStreak: 0,
        bestWinStreak: 0
},

khaled: {
  played: 0,
  wins: 0,
  losses: 0,
  winStreak: 0,
  bestWinStreak: 0
},

online: {
  played: 0,
  wins: 0,
  losses: 0,
  winStreak: 0,
  bestWinStreak: 0
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
      localStorage.setItem(LOCAL_RATING_RESET_KEY, 'done')
      return defaultProfile
    }

    const data =
      JSON.parse(saved)

    const resetLocalRating =
      localStorage.getItem(LOCAL_RATING_RESET_KEY) !== 'done'

    const profile = {
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
          rating: resetLocalRating
            ? RATING_START
            : normalizeRating(
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

      if (resetLocalRating) {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
        localStorage.setItem(LOCAL_RATING_RESET_KEY, 'done')
      }

      return profile
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
      losses: 0,
      winStreak: 0,
      bestWinStreak: 0
    }
  }

  const levelStats = playerProfile.levels[level]
  levelStats.winStreak = Number(levelStats.winStreak) || 0
  levelStats.bestWinStreak = Number(levelStats.bestWinStreak) || 0

  playerProfile.games++
  playerProfile.totalMoves +=
    currentGameMoves

  playerProfile
    .levels[level]
    .played++

  if (playerWon) {
    playerProfile.wins++
    levelStats.wins++
    levelStats.winStreak++
    levelStats.bestWinStreak = Math.max(
      levelStats.bestWinStreak,
      levelStats.winStreak
    )
  }

  else {
    playerProfile.losses++
    levelStats.losses++
    levelStats.winStreak = 0
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
      new Date().toISOString()
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

      <div class="home-account-actions">
        <button id="profileBtn" class="profile-top-btn" type="button">
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
            0
          </span>
        </button>

        <button
          id="friendsBtn"
          class="friends-top-btn"
          type="button"
        >
          <span aria-hidden="true">♙</span>
          <span>الأصدقاء</span>
          <span id="friendsOnlineCount" class="friends-online-count">0</span>
        </button>
      </div>


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

          <button id="trainingHomeBtn" class="secondary-btn home-action-btn training-action-btn" type="button">
            تدريب احترافي
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

              <button
                id="editProfileNameBtn"
                class="profile-name-edit-trigger"
                type="button"
                aria-label="تعديل الاسم"
                title="تعديل الاسم"
              >#</button>

              <span
                id="profilePageLevelBadge"
                class="player-level-badge profile-page-level-badge"
              >
                مبتدئ • 400
              </span>
            </div>

            <div id="profileNameEditorPanel" class="profile-name-editor-panel" hidden>
              <input
                id="profileNameInput"
                type="text"
                maxlength="20"
                placeholder="اكتب اسمك الجديد"
                aria-label="الاسم الجديد"
              >
              <button id="saveProfileNameBtn" class="profile-save-btn" type="button">حفظ</button>
              <p id="profileSaveMessage" class="profile-save-message" aria-live="polite"></p>
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

    <p id="accountSessionNotice" class="account-session-notice" hidden></p>

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

    <button
      id="accountDetailsToggle"
      class="account-signed-card"
      type="button"
      aria-expanded="false"
      aria-controls="logoutAccountBtn"
    >

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

      <span class="account-details-indicator" aria-hidden="true">⌄</span>

    </button>

    <button
      id="logoutAccountBtn"
      class="logout-account-btn"
      type="button"
      hidden
    >
      <span>تسجيل الخروج</span>
      <span>↗</span>
    </button>

  </div>

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
                <small id="easyStreak" class="level-streak-badge" hidden></small>
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
                <small id="mediumStreak" class="level-streak-badge" hidden></small>
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
                <small id="hardStreak" class="level-streak-badge" hidden></small>
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
                <small id="impossibleStreak" class="level-streak-badge" hidden></small>
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
                <small id="khaledStreak" class="level-streak-badge" hidden></small>
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
                  <small id="onlineStreak" class="level-streak-badge" hidden></small>
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

      <section id="friendsView" class="profile-view friends-view" hidden>
        <div class="friends-page-header">
          <button id="friendsBackBtn" class="profile-back-btn" type="button">
            ← رجوع
          </button>
          <h2>الأصدقاء</h2>
          <div class="my-friend-code">
            <small>معرّفك</small>
            <strong id="myFriendCode">-----</strong>
          </div>
        </div>

        <p id="friendsAuthNotice" class="friends-auth-notice" hidden>
          سجّل الدخول لإنشاء معرّف وإدارة قائمة أصدقائك.
        </p>

        <div id="friendsContent">
          <div id="friendsHomePanel">
          <form id="addFriendForm" class="add-friend-form">
            <label for="friendCodeInput">إضافة صديق</label>
            <div class="add-friend-controls">
              <input
                id="friendCodeInput"
                type="text"
                inputmode="numeric"
                pattern="[0-9]{5}"
                maxlength="5"
                placeholder="معرّف من 5 أرقام"
                autocomplete="off"
              >
              <button type="submit" class="primary-btn">إرسال الطلب</button>
            </div>
            <p id="friendActionMessage" class="friend-action-message" aria-live="polite"></p>
          </form>

          <div class="friends-inbox-actions">
            <button id="openFriendRequestsBtn" class="friends-inbox-button" type="button">
              <span>طلبات الصداقة</span>
              <span id="friendRequestsCount" class="friends-inbox-count">0</span>
            </button>
            <button id="openGameInvitesBtn" class="friends-inbox-button" type="button">
              <span>طلبات اللعب</span>
              <span id="gameInvitesCount" class="friends-inbox-count">0</span>
            </button>
          </div>

          <section class="friends-section">
            <h3>قائمة الأصدقاء</h3>
            <div id="friendsList" class="friend-list"></div>
          </section>
          </div>

          <section id="friendRequestsPanel" class="friends-section friends-inbox-panel" hidden>
            <div class="friends-inbox-header">
              <button id="backFromFriendRequestsBtn" class="profile-back-btn" type="button">← رجوع</button>
              <h3>طلبات الصداقة</h3>
            </div>
            <div id="friendRequestsList" class="friend-list"></div>
          </section>

          <section id="gameInvitesPanel" class="friends-section friends-inbox-panel" hidden>
            <div class="friends-inbox-header">
              <button id="backFromGameInvitesBtn" class="profile-back-btn" type="button">← رجوع</button>
              <h3>طلبات اللعب</h3>
            </div>
            <div id="gameInvitesList" class="friend-list"></div>
          </section>
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
supabase.auth.onAuthStateChange((event, session) => {
  window.setTimeout(async () => {
    if (session?.user) {
      currentAuthUser = session.user
      await loadCloudProfile(session.user)
      startPresenceTracking()
      updateProfileUI()
      await refreshAuthUI()
      return
    }

    if (event === 'SIGNED_OUT') {
      await stopPresenceTracking()
      currentAuthUser = null
      activePresenceRoom = null
      activePresenceWatchKey = null
      updateProfileUI()
      await refreshAuthUI()
    }
  }, 0)
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
        : 'جراند ماستر • بلا حد أعلى'
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

  const streakBadge =
    document.querySelector(`#${level}Streak`)

  const currentStreak = Number(stats.winStreak) || 0
  const bestStreak = Number(stats.bestWinStreak) || 0

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

  if (streakBadge) {
    streakBadge.hidden = currentStreak < 3
    streakBadge.textContent = currentStreak >= 3
      ? `🔥 سلسلة ${currentStreak}`
      : ''
    streakBadge.title = bestStreak > 0
      ? `أفضل سلسلة: ${bestStreak} انتصارات`
      : ''
  }
}

function formatGameHistoryDate(value) {
  let date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    const arabicDigits = '٠١٢٣٤٥٦٧٨٩'
    const normalized = String(value || '')
      .replace(/[٠-٩]/g, digit => arabicDigits.indexOf(digit))
      .replace(/[\u061c\u200e\u200f]/g, '')
      .replace('،', ',')
    const legacyDate = normalized.match(
      /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*,?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([صم])/u
    )

    if (legacyDate) {
      const [, day, month, year, rawHour, minute, period] = legacyDate
      const hour12 = Number(rawHour) % 12
      const hour = period === 'م' ? hour12 + 12 : hour12
      date = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        hour,
        Number(minute)
      )
    }
  }

  if (Number.isNaN(date.getTime())) return String(value || '')

  return new Intl.DateTimeFormat('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date).replace(',', '')
}


function renderGameHistory() {

  const historyBox =
    document.querySelector(
      '#gameHistory'
    )

  if (!historyBox) return

  historyBox.innerHTML = ''

  const visibleHistory =
    playerProfile.history.filter(game =>
      ['online', 'impossible', 'khaled'].includes(game.level)
    )

  if (visibleHistory.length === 0) {

    const empty =
      document.createElement('p')

    empty.className =
      'empty-history'

    empty.textContent =
      'لا توجد مباريات أونلاين أو في مستويي أتحداك تفوز وخالد بعد.'

    historyBox.appendChild(empty)

    return
  }


  visibleHistory
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
        formatGameHistoryDate(game.date)

      const moves =
        document.createElement('span')

      moves.className = 'history-moves'
      moves.textContent = `${Number(game.moves) || 0} حركة`
      moves.setAttribute('aria-label', `${Number(game.moves) || 0} حركة`)


      info.appendChild(level)
      info.appendChild(details)

      item.appendChild(moves)
      item.appendChild(result)
      item.appendChild(info)

      historyBox.appendChild(item)
    })
}
// ========================================
// ♛ لوحة الصدارة
// ========================================

let leaderboardPlayers = []
let publicProfileHistoryRequestId = 0

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
      Number(stats.losses) || 0,
    winStreak:
      Number(stats.winStreak) || 0,
    bestWinStreak:
      Number(stats.bestWinStreak) || 0
  }
}

async function openPublicPlayerProfile(
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

  const requestId = ++publicProfileHistoryRequestId
  const { data: recentHistory, error: historyError } =
    await supabase.rpc('get_public_match_history', {
      p_player_id: player.id
    })

  if (requestId !== publicProfileHistoryRequestId) return

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
  const leaderboardHeader =
    document.querySelector('.leaderboard-page-header')

  if (leaderboardHeader) {
    leaderboardHeader.hidden = true
  }

  view.innerHTML = `
    <button
      id="publicProfileBackBtn"
      class="profile-back-btn public-profile-back-btn"
      type="button"
    >
      ← رجوع للوحة الصدارة
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
                : 'جراند ماستر • بلا حد أعلى'
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

      <section class="public-profile-history">
        <h3>آخر المباريات</h3>
        <div id="publicPlayerHistory" class="public-history-list"></div>
      </section>
    </div>
  `

  renderPublicGameHistory(recentHistory, historyError)

  document
    .querySelector(
      '#publicProfileBackBtn'
    )
    ?.addEventListener(
      'click',
      () => {
        publicProfileHistoryRequestId++
        view.hidden = true
        view.innerHTML = ''
        main.hidden = false
        if (leaderboardHeader) {
          leaderboardHeader.hidden = false
        }
      }
    )
}

function renderPublicGameHistory(games, error) {
  const historyBox = document.querySelector('#publicPlayerHistory')
  if (!historyBox) return
  historyBox.replaceChildren()

  if (error) {
    historyBox.append(createFriendEmptyState('تعذر تحميل سجل المباريات.'))
    console.warn('تعذر تحميل سجل اللاعب العام:', error.message)
    return
  }

  const recentGames = (games || []).filter(game =>
    ['online', 'impossible', 'khaled'].includes(game.level)
  )

  if (recentGames.length === 0) {
    historyBox.append(createFriendEmptyState('لا توجد مباريات مسجلة بعد.'))
    return
  }

  recentGames.forEach(game => {
    const item = document.createElement('div')
    item.className = 'history-game-item'

    const moves = document.createElement('span')
    moves.className = 'history-moves'
    moves.textContent = `${Number(game.moves) || 0} حركة`

    const result = document.createElement('div')
    result.className = game.result === 'win'
      ? 'history-result history-win'
      : 'history-result history-loss'
    result.textContent = game.result === 'win' ? '✓ فوز' : '✕ خسارة'

    const info = document.createElement('div')
    info.className = 'history-game-info'
    const level = document.createElement('strong')
    level.textContent = getLevelName(game.level)
    const date = document.createElement('small')
    date.textContent = formatGameHistoryDate(game.date)
    info.append(level, date)

    item.append(moves, result, info)
    historyBox.append(item)
  })
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
        ${stats.winStreak >= 3 ? `<small class="public-level-streak">🔥 سلسلة ${stats.winStreak}</small>` : ''}
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

  if (!user && currentAuthUser?.id) {
    return
  }

  if (currentAuthUser?.id && currentAuthUser.id !== user?.id) {
    await stopPresenceTracking()
    activePresenceRoom = null
    activePresenceWatchKey = null
  }

  currentAuthUser = user || null

  // نحافظ على الحساب بعد إغلاق الموقع أو الرجوع له
  // ولا نمسح الجلسة بسبب قراءة مؤقتة فارغة من المتصفح
  if (user) {
    const profileLoaded = await loadCloudProfile(user)
    if (profileLoaded === false) {
      await refreshAuthUI()
      return
    }
    startPresenceTracking()
  }
  else {
    await stopPresenceTracking()
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

    const sessionNotice =
      document.querySelector('#accountSessionNotice')

    if (sessionNotice) {
      sessionNotice.hidden = true
      sessionNotice.textContent = ''
    }

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

  const friendsView =
    document.querySelector('#friendsView')

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
        friendsView.hidden = true
        leaderboardView.hidden = true
        stopFriendsRefresh()

        updateProfileUI()
      }
    )

  document
    .querySelector('#friendsBtn')
    .addEventListener('click', () => {
      mainContent.hidden = true
      profileView.hidden = true
      leaderboardView.hidden = true
      friendsView.hidden = false
      openFriendsView()
    })

  document
    .querySelector('#friendsBackBtn')
    .addEventListener('click', () => {
      friendsView.hidden = true
      mainContent.hidden = false
      stopFriendsRefresh()
    })

  document
    .querySelector('#accountDetailsToggle')
    .addEventListener('click', () => {
      const logoutButton = document.querySelector('#logoutAccountBtn')
      logoutButton.hidden = !logoutButton.hidden
      document.querySelector('#accountDetailsToggle')
        .setAttribute('aria-expanded', String(!logoutButton.hidden))
    })

  document
    .querySelector('#addFriendForm')
    .addEventListener('submit', sendFriendRequestFromForm)

  document
    .querySelector('#openFriendRequestsBtn')
    .addEventListener('click', () => showFriendsInbox('friend-requests'))

  document
    .querySelector('#openGameInvitesBtn')
    .addEventListener('click', () => showFriendsInbox('game-invites'))

  document
    .querySelector('#backFromFriendRequestsBtn')
    .addEventListener('click', () => showFriendsInbox('home'))

  document
    .querySelector('#backFromGameInvitesBtn')
    .addEventListener('click', () => showFriendsInbox('home'))


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

  document
    .querySelector('#editProfileNameBtn')
    .addEventListener('click', () => {
      const editor = document.querySelector('#profileNameEditorPanel')
      editor.hidden = !editor.hidden
      if (!editor.hidden) {
        document.querySelector('#profileNameInput').focus()
      }
    })


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
        friendsView.hidden = true
        stopFriendsRefresh()
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
          const editor = document.querySelector('#profileNameEditorPanel')
          if (editor) editor.hidden = true
          message.textContent = ''
        }, 1400)

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
    .querySelector('#trainingHomeBtn')
    .addEventListener('click', () => startGame('training'))


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

      await stopPresenceTracking()
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

  socket.timeout(10000).emit(
    'create-room',
    {
      ...onlineRoomSettings,
      playerName: playerProfile.name
    },
    (socketError, response) => {
      if (socketError) {
        error.textContent = 'لم يستجب سيرفر اللعب. تحقق من عنوان VITE_SOCKET_URL وتشغيل الخادم.'
        return
      }

      if (!response?.success) {
        alert(
          response?.message ||
          'تعذر إنشاء الروم'
        )
        return
      }

      onlineRoomCode = response.code
      currentRoomWatchKey = response.watchKey
      setActivePresenceRoom(null, null)
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
      currentRoomWatchKey = response.watchKey
      setActivePresenceRoom(onlineRoomCode, currentRoomWatchKey)
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

      ${localColor === 'cream' && !onlineOpponentConnected ? `
        <div class="room-invite-dock">
          <button id="inviteFriendBtn" class="room-invite-trigger" type="button">
            دعوة صديق للعب
          </button>
        </div>
      ` : ''}

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

  document
    .querySelector('#inviteFriendBtn')
    ?.addEventListener('click', openRoomInviteView)

  createBoard()
  resetGameReview()

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
  if (spectatingMode) {
    socket.emit('stop-spectating')
    spectatingMode = false
  }

  setActivePresenceRoom(null, null)
  currentRoomWatchKey = null

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

  recordGameReviewMove({
    color: onlinePlayerColor,
    fromRow,
    fromCol,
    row,
    col,
    capture: captured,
    capturedRow,
    capturedCol,
    continueCapture,
    nextTurn
  })

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
  recordGameReviewMove(move)

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
          مناسب للمبتدئين
        </span>
      </button>

      <button class="difficulty-btn" data-level="medium">
        <span class="difficulty-title">متوسط</span>
        <span class="difficulty-description">
          تحدٍ متوازن
        </span>
      </button>

      <button class="difficulty-btn" data-level="hard">
        <span class="difficulty-title">صعب</span>
        <span class="difficulty-description">
          خصم قوي يخطط لكل نقلة
        </span>
      </button>
      <button class="difficulty-btn" data-level="impossible">
  <span class="difficulty-title">☠️ أتحداك تفوز</span>

  <span class="difficulty-description">
    يبحث بعمق عن أفضل نقلاته
  </span>
</button>

<button class="difficulty-btn khaled-difficulty-btn" data-level="khaled">
  <span class="difficulty-title">🛡️ خالد</span>

  <span class="difficulty-description">
    منافس قوي من أعلى المستويات
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

  if (level === 'training') {
    return 'تدريب احترافي'
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
  const elapsedMatchMs = matchTimerStartedAt
    ? matchTimerElapsedMs + performance.now() - matchTimerStartedAt
    : matchTimerElapsedMs

  const shouldRecordLoss =
    !gameOver &&
    !currentGameRecorded &&
    currentLevel &&
    currentLevel !== 'training' &&
    elapsedMatchMs >= 60000

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
  trainingUndoSnapshots = []
  trainingTurnStartSnapshot = null
  trainingLastMoveExplanation = ''

  document.querySelector('#app').innerHTML = `
    <main class="game-page">

      <div class="game-header">

        <button id="exitGameBtn" class="exit-game-btn">
          خروج
        </button>

        <div class="game-info">
          <h2>الدامة</h2>
          <p>
            ${level === 'training' ? 'تدريب تفاعلي' : 'ضد الكمبيوتر'} • ${getLevelName(level)}
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

      ${level === 'training' ? `
        <div class="training-board-frame" aria-label="إحداثيات رقعة التدريب">
          <div class="training-file-labels" aria-hidden="true">
            ${[1,2,3,4,5,6,7,8].map(number => `<span>${number}</span>`).join('')}
          </div>
          <div class="training-board-row">
            <div class="training-rank-labels" aria-hidden="true">
              ${[1,2,3,4,5,6,7,8].map(number => `<span>${number}</span>`).join('')}
            </div>
            <div id="board" class="board"></div>
            <div class="training-rank-labels" aria-hidden="true">
              ${[1,2,3,4,5,6,7,8].map(number => `<span>${number}</span>`).join('')}
            </div>
          </div>
          <div class="training-file-labels" aria-hidden="true">
            ${[1,2,3,4,5,6,7,8].map(number => `<span>${number}</span>`).join('')}
          </div>
        </div>
      ` : '<div id="board" class="board"></div>'}

      ${level === 'training' ? `
        <section id="trainingCoach" class="training-coach" aria-live="polite">
          <div class="training-coach-copy">
            <small>المدرب</small>
            <p id="trainingAdvice">أحلل وضع الرقعة...</p>
            <p id="trainingPreviousMove" class="training-previous-move" hidden></p>
          </div>
          <div class="training-coach-actions">
            <button id="trainingExplainPrevBtn" class="training-explain-btn" type="button" disabled>شرح النقلة السابقة</button>
            <button id="trainingUndoBtn" class="training-undo-btn" type="button" title="الرجوع لما قبل نقلة دورك" aria-label="الرجوع لما قبل نقلة دورك" disabled>↶ رجوع خطوة</button>
          </div>
        </section>
      ` : ''}

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
  resetGameReview()
  startMatchTimer()

  if (level === 'training') {
    trainingTurnStartSnapshot = captureTrainingSnapshot()
    renderTrainingAdvice()
    updateTrainingUndoButton()
    document.querySelector('#trainingUndoBtn')
      ?.addEventListener('click', undoTrainingTurn)
    document.querySelector('#trainingExplainPrevBtn')
      ?.addEventListener('click', showTrainingPreviousMove)
  }

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
  const trainingFromRow = Number(selectedPiece.parentElement.dataset.row)
  const trainingFromCol = Number(selectedPiece.parentElement.dataset.col)
  const trainingToRow = Number(square.dataset.row)
  const trainingToCol = Number(square.dataset.col)
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
  recordGameReviewMove({
    color: 'cream',
    fromRow: trainingFromRow,
    fromCol: trainingFromCol,
    row: trainingToRow,
    col: trainingToCol,
    capture: captured,
    capturedRow: captured ? Number(square.dataset.capturedRow) : null,
    capturedCol: captured ? Number(square.dataset.capturedCol) : null
  })

  const isKingNow =
    selectedPiece.dataset.king === 'true'

  const justBecameKing =
    !wasKing && isKingNow

  if (currentLevel === 'training') {
    const reason = captured
      ? 'تأكل قطعة من الخصم وتكسب أفضلية مادية.'
      : justBecameKing
        ? 'ترقّي حجرك إلى ملك، فيحصل على حركة أوسع.'
        : trainingToRow >= 2 && trainingToRow <= 5 && trainingToCol >= 2 && trainingToCol <= 5
          ? 'تقترب من الوسط وتفتح للحجر مسارات أكثر.'
          : 'تحافظ على تشكيلتك وتجهز خياراتك للنقلة التالية.'
    const explanation =
      `نقلتك من ${trainingFromRow + 1},${trainingFromCol + 1} إلى ${trainingToRow + 1},${trainingToCol + 1}: ${reason}`
    setTrainingPreviousMoveExplanation(explanation)
    setTrainingAdvice(explanation)
  }

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

      if (currentLevel === 'training') {
        setTrainingAdvice('الأكل إجباري؛ أكمل سلسلة الأكل قبل انتهاء دورك.')
      }

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

function captureTrainingSnapshot() {
  return {
    turn: currentTurn,
    moves: currentGameMoves,
    previousExplanation: trainingLastMoveExplanation,
    pieces: Array.from(
      document.querySelectorAll('.checker-piece')
    ).map(piece => ({
      row: Number(piece.parentElement.dataset.row),
      col: Number(piece.parentElement.dataset.col),
      color: piece.dataset.color,
      king: piece.dataset.king === 'true'
    }))
  }
}

function restoreTrainingSnapshot(snapshot) {
  const board = document.querySelector('#board')
  if (!board || !snapshot) return

  board.replaceChildren()
  createBoard()
  board.querySelectorAll('.checker-piece').forEach(piece => piece.remove())

  snapshot.pieces.forEach(state => {
    const square = getSquare(state.row, state.col)
    if (!square) return

    const piece = createPiece(state.color)
    if (state.king) {
      piece.dataset.king = 'true'
      piece.classList.add('king')
      const symbol = document.createElement('span')
      symbol.classList.add('king-symbol')
      symbol.textContent = '♛'
      piece.append(symbol)
    }
    square.append(piece)
  })

  currentTurn = snapshot.turn
  currentGameMoves = snapshot.moves
  trainingLastMoveExplanation = snapshot.previousExplanation || ''
  const previousMove = document.querySelector('#trainingPreviousMove')
  if (previousMove) {
    previousMove.textContent = trainingLastMoveExplanation
    previousMove.hidden = true
  }
  selectedPiece = null
  mustContinueCapture = false
  gameOver = false
  clearSelection()
  clearForcedCaptureHint()
  document.querySelector('.game-result-overlay')?.remove()
  updatePlayerHighlight()
  updateTrainingUndoButton()
  renderTrainingAdvice()
}

function updateTrainingUndoButton() {
  const button = document.querySelector('#trainingUndoBtn')
  if (button) {
    button.disabled =
      trainingUndoSnapshots.length === 0 ||
      (!gameOver && currentTurn !== 'cream')
  }

  const explainButton = document.querySelector('#trainingExplainPrevBtn')
  if (explainButton) {
    explainButton.disabled = !trainingLastMoveExplanation
  }
}

function setTrainingPreviousMoveExplanation(text) {
  trainingLastMoveExplanation = text
  const previousMove = document.querySelector('#trainingPreviousMove')
  if (previousMove) {
    previousMove.textContent = text
    previousMove.hidden = true
  }
  updateTrainingUndoButton()
}

function showTrainingPreviousMove() {
  const previousMove = document.querySelector('#trainingPreviousMove')
  if (!previousMove || !trainingLastMoveExplanation) return
  previousMove.textContent = trainingLastMoveExplanation
  previousMove.hidden = !previousMove.hidden
}

function undoTrainingTurn() {
  if (
    currentLevel !== 'training' ||
    (!gameOver && currentTurn !== 'cream') ||
    trainingUndoSnapshots.length === 0
  ) return

  trainingTurnStartSnapshot =
    trainingUndoSnapshots.pop()
  restoreTrainingSnapshot(trainingTurnStartSnapshot)
}

function getBestTrainingMove(color) {
  let moves = getAllMoves(color)
  if (moves.length === 0) return null
  if (color === 'cream' && mustContinueCapture && selectedPiece) {
    moves = moves.filter(move => move.piece === selectedPiece)
  }
  if (moves.length === 1) return { move: moves[0], gap: 0 }

  const board = createAIBoard()
  let turns = getHardTurns(board, color)
  if (color === 'cream' && mustContinueCapture && selectedPiece) {
    const square = selectedPiece.parentElement
    const row = Number(square.dataset.row)
    const col = Number(square.dataset.col)
    turns = turns.filter(turn =>
      turn.steps[0]?.fromRow === row && turn.steps[0]?.fromCol === col
    )
  }
  const deadline = performance.now() + 300
  const table = new Map()
  const maximizing = color === 'black'
  let bestScore = maximizing ? -Infinity : Infinity
  let secondScore = bestScore
  let bestMove = null

  for (const turn of turns) {
    if (performance.now() >= deadline) break

    const result = hardMinimax(
      applyHardTurn(board, turn),
      3,
      getOppositeColor(color),
      -Infinity,
      Infinity,
      deadline,
      table
    )
    if (result.timeout) break

    const firstStep = turn.steps[0]
    const move = findDOMMoveForHardStep(moves, firstStep)
    if (!move) continue

    const improves = maximizing
      ? result.score > bestScore
      : result.score < bestScore

    if (improves) {
      secondScore = bestScore
      bestScore = result.score
      bestMove = move
    }
    else if (
      maximizing ? result.score > secondScore : result.score < secondScore
    ) {
      secondScore = result.score
    }
  }

  return {
    move: bestMove || moves[0],
    gap: Number.isFinite(secondScore)
      ? Math.abs(bestScore - secondScore)
      : 0
  }
}

function explainTrainingMove(move, color, scoreGap = 0) {
  const reasons = []
  if (move.capture) reasons.push('تأكل قطعة من الخصم')

  const reachesKing =
    move.piece.dataset.king !== 'true' &&
    ((color === 'cream' && move.row === 0) ||
      (color === 'black' && move.row === 7))
  if (reachesKing) reasons.push('ترقّي الحجر إلى ملك')

  if (move.row >= 2 && move.row <= 5 && move.col >= 2 && move.col <= 5) {
    reasons.push('تسيطر على وسط الرقعة وتفتح مسارات أكثر')
  }

  if (reasons.length === 0) {
    reasons.push(
      scoreGap > 30
        ? 'تتفوق على البديل التالي في تقييم الوضع والتهديدات'
        : 'تحافظ على توازن القطع وتبقي خياراتك مفتوحة'
    )
  }

  const from = move.piece.parentElement
  const start = `${Number(from.dataset.row) + 1},${Number(from.dataset.col) + 1}`
  const destination = `${move.row + 1},${move.col + 1}`
  return `من ${start} إلى ${destination}: ${reasons.join('، ')}.`
}

function setTrainingAdvice(text) {
  const advice = document.querySelector('#trainingAdvice')
  if (advice) advice.textContent = text
}

function renderTrainingAdvice() {
  if (currentLevel !== 'training' || currentTurn !== 'cream') return

  const result = getBestTrainingMove('cream')
  if (!result) {
    setTrainingAdvice('لا توجد نقلة قانونية متاحة.')
    return
  }

  setTrainingAdvice(
    `أفضل نقلة لك: ${explainTrainingMove(result.move, 'cream', result.gap)}`
  )
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

  if (currentLevel === 'training') {
    const chosen = chooseHardMove(moves)
    if (chosen) {
      setTrainingAdvice(
        `أفضل رد للكمبيوتر: ${explainTrainingMove(chosen, 'black')}`
      )
    }
    executeComputerMove(chosen || moves[0])
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
  recordGameReviewMove({
    color: 'black',
    fromRow: step.fromRow,
    fromCol: step.fromCol,
    row: step.row,
    col: step.col,
    capture: step.capture,
    capturedRow: step.capturedRow,
    capturedCol: step.capturedCol
  })

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

  if (currentLevel === 'training') {
    return chooseHardMove(moves)
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

  const trainingFromRow = Number(piece.parentElement.dataset.row)
  const trainingFromCol = Number(piece.parentElement.dataset.col)
  const trainingToRow = Number(move.row)
  const trainingToCol = Number(move.col)

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
    recordGameReviewMove({
      color: 'black',
      fromRow: trainingFromRow,
      fromCol: trainingFromCol,
      row: trainingToRow,
      col: trainingToCol,
      capture: move.capture,
      capturedRow: move.capturedRow,
      capturedCol: move.capturedCol
    })

    const isKingNow =
      piece.dataset.king === 'true'

    const justBecameKing =
      !wasKing && isKingNow

    if (currentLevel === 'training') {
      const reason = move.capture
        ? 'تأكل قطعة من الخصم وتكسب أفضلية مادية.'
        : justBecameKing
          ? 'ترقّي حجرك إلى ملك، فيحصل على حركة أوسع.'
          : trainingToRow >= 2 && trainingToRow <= 5 && trainingToCol >= 2 && trainingToCol <= 5
            ? 'تقترب من الوسط وتفتح للحجر مسارات أكثر.'
            : 'تحافظ على تشكيلتك وتجهز خياراتك للنقلة التالية.'
      const explanation =
        `رد الكمبيوتر من ${trainingFromRow + 1},${trainingFromCol + 1} إلى ${trainingToRow + 1},${trainingToCol + 1}: ${reason}`
      setTrainingPreviousMoveExplanation(explanation)
      setTrainingAdvice(explanation)
    }

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

  if (currentLevel === 'training') {
    if (trainingTurnStartSnapshot) {
      trainingUndoSnapshots.push(trainingTurnStartSnapshot)
    }
    trainingTurnStartSnapshot = captureTrainingSnapshot()
    updateTrainingUndoButton()
    renderTrainingAdvice()
  }
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

  if (
    currentLevel === 'training' &&
    trainingTurnStartSnapshot
  ) {
    trainingUndoSnapshots.push(trainingTurnStartSnapshot)
    updateTrainingUndoButton()
  }

  stopImpossibleWorker()
  stopKhaledWorker()
  stopMatchTimer(true)
  clearSelection()
  setTurnText(message)

  if (onlineMode && !spectatingMode) {
    socket.emit('game-finished')
    setActivePresenceRoom(null, null)
  }

  const playerWon =
    message.includes('فزت') ||
    message.includes('فوز')

  playResultSound(playerWon)

  if (currentLevel !== 'training') {
    recordGameResult(playerWon)
  }

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
    : '💔 لم يحالفك الحظ هذه المرة'

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
      ? 'أحسنت، فزت بالمباراة.'
      : 'لم يحالفك الحظ هذه المرة.'
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

  if ((currentGameReview?.positions.length || 0) > 1) {
    const reviewButton = document.createElement('button')
    reviewButton.className = 'result-btn review-btn'
    reviewButton.textContent = 'مراجعة المباراة'
    reviewButton.onclick = openGameReview
    buttons.appendChild(reviewButton)
  }

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

