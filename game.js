import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  runTransaction,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDVkeLT4chg6nPCdzpec-XAqPVgrj_-w3A",
  authDomain: "porker-31a39.firebaseapp.com",
  projectId: "porker-31a",
  storageBucket: "porker-31a.firebasestorage.app",
  messagingSenderId: "506584003822",
  appId: "1:506584003822:web:260f5d4dba999e4e74efff",
  measurementId: "G-N6H6HVT0F4",
  databaseURL: "https://porker-31a39-default-rtdb.firebaseio.com"
};

const AVATARS = [
  { id: "fox", glyph: "🦊", label: "キツネ" },
  { id: "cat", glyph: "🐱", label: "ネコ" },
  { id: "dog", glyph: "🐶", label: "イヌ" },
  { id: "owl", glyph: "🦉", label: "フクロウ" },
  { id: "gentleman", glyph: "🎩", label: "紳士" },
  { id: "robot", glyph: "🤖", label: "ロボ" },
  { id: "dragon", glyph: "🐉", label: "ドラゴン" },
  { id: "rabbit", glyph: "🐰", label: "ウサギ" }
];

const TABLE_SEAT_COORDS = [
  { left: 50, top: 91 },
  { left: 16, top: 82 },
  { left: 8,  top: 50 },
  { left: 16, top: 18 },
  { left: 50, top: 9  },
  { left: 84, top: 18 },
  { left: 92, top: 50 },
  { left: 84, top: 82 }
];

const app = initializeApp(firebaseConfig);
const db = getDatabase(app, firebaseConfig.databaseURL);

let myId = sessionStorage.getItem("cardBattleTabPlayerId");
if (!myId) {
  myId = crypto.randomUUID();
  sessionStorage.setItem("cardBattleTabPlayerId", myId);
}

let selectedAvatar = sessionStorage.getItem("pokerSelectedAvatar") || AVATARS[0].id;
let myName = "";
let roomId = "";
let roomPath = "";
let isHost = false;
let roomListener = null;
let busy = false;
let latestRoom = null;

const SB_AMOUNT = 10;
const BB_AMOUNT = 20;
const $ = id => document.getElementById(id);

function getAvatarById(id) {
  return AVATARS.find(a => a.id === id || a.glyph === id) || AVATARS[0];
}

function renderAvatarPicker() {
  const picker = $("avatarPicker");
  if (!picker) return;
  picker.innerHTML = "";
  AVATARS.forEach(av => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "avatar-option" + (av.id === selectedAvatar ? " selected" : "");
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(av.id === selectedAvatar));
    btn.innerHTML = `<span class="avatar-option-glyph">${av.glyph}</span><span>${av.label}</span>`;
    btn.addEventListener("click", () => {
      selectedAvatar = av.id;
      sessionStorage.setItem("pokerSelectedAvatar", selectedAvatar);
      renderAvatarPicker();
    });
    picker.appendChild(btn);
  });
}

function status(t) {
  $("gameStatus").textContent = t;
}

function message(t) {
  $("message").textContent = t;
}

function normalizeRoomId(v) {
  return String(v || "").trim().replace(/\s+/g, "").toUpperCase();
}

function roomRef() {
  if (!roomId) throw new Error("ルームIDが設定されていません");
  if (!roomPath) roomPath = roomId;
  return ref(db, roomPath);
}

async function findRoomPath(code) {
  const root = await get(ref(db, code));
  if (root.exists()) return { path: code, snapshot: root, format: "root" };
  const legacyPath = "rooms/" + code;
  const legacy = await get(ref(db, legacyPath));
  if (legacy.exists()) return { path: legacyPath, snapshot: legacy, format: "rooms" };
  return { path: code, snapshot: root, format: "missing" };
}

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function deckCreate() {
  const suits = [
    { s: "♠", c: "black" },
    { s: "♥", c: "red" },
    { s: "♦", c: "red" },
    { s: "♣", c: "black" }
  ];
  const ranks = [
    { v: "2", n: 2 }, { v: "3", n: 3 }, { v: "4", n: 4 }, { v: "5", n: 5 },
    { v: "6", n: 6 }, { v: "7", n: 7 }, { v: "8", n: 8 }, { v: "9", n: 9 },
    { v: "10", n: 10 }, { v: "J", n: 11 }, { v: "Q", n: 12 }, { v: "K", n: 13 },
    { v: "A", n: 14 }
  ];
  const deck = [];
  suits.forEach(s => ranks.forEach(r => deck.push({
    suit: s.s, color: s.c, value: r.v, rank: r.n
  })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardHtml(card) {
  if (!card) return '<div class="empty-card"></div>';
  const red = card.color === "red" ? " red" : "";
  return `<div class="playing-card${red}"><span class="rank">${card.value}</span><span class="suit">${card.suit}</span></div>`;
}

function renderCards(container, cards, count = cards.length) {
  container.innerHTML = "";
  for (let i = 0; i < count; i++) {
    container.insertAdjacentHTML("beforeend", cardHtml(cards[i] || null));
  }
}

function combinations(arr, k) {
  const out = [];
  function walk(start, path) {
    if (path.length === k) {
      out.push(path.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      path.push(arr[i]);
      walk(i + 1, path);
      path.pop();
    }
  }
  walk(0, []);
  return out;
}

function scoreFive(cards) {
  const vals = cards.map(c => c.rank).sort((a, b) => b - a);
  const counts = {};
  cards.forEach(c => counts[c.rank] = (counts[c.rank] || 0) + 1);
  const groups = Object.entries(counts)
    .map(([r, n]) => ({ rank: Number(r), count: n }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);
  const flush = cards.every(c => c.suit === cards[0].suit);
  const uniq = [...new Set(vals)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.includes(14)) uniq.push(1);
  for (let i = 0; i <= uniq.length - 5; i++) {
    if (uniq[i] - uniq[i + 4] === 4) {
      straightHigh = uniq[i] === 1 ? 5 : uniq[i];
      break;
    }
  }
  const tiebreak = [];
  let category = 0, label = "ハイカード";
  if (flush && straightHigh === 14) {
    category = 9; label = "ロイヤルフラッシュ"; tiebreak.push(14);
  } else if (flush && straightHigh) {
    category = 8; label = "ストレートフラッシュ"; tiebreak.push(straightHigh);
  } else if (groups[0].count === 4) {
    category = 7; label = "フォーカード"; tiebreak.push(groups[0].rank, groups[1].rank);
  } else if (groups[0].count === 3 && groups[1].count === 2) {
    category = 6; label = "フルハウス"; tiebreak.push(groups[0].rank, groups[1].rank);
  } else if (flush) {
    category = 5; label = "フラッシュ"; tiebreak.push(...vals);
  } else if (straightHigh) {
    category = 4; label = "ストレート"; tiebreak.push(straightHigh);
  } else if (groups[0].count === 3) {
    category = 3; label = "スリーカード"; tiebreak.push(groups[0].rank, ...groups.slice(1).map(g => g.rank));
  } else if (groups[0].count === 2 && groups[1].count === 2) {
    category = 2; label = "ツーペア"; tiebreak.push(groups[0].rank, groups[1].rank, groups[2].rank);
  } else if (groups[0].count === 2) {
    category = 1; label = "ワンペア"; tiebreak.push(groups[0].rank, ...groups.slice(1).map(g => g.rank));
  } else {
    category = 0; label = "ハイカード"; tiebreak.push(...vals);
  }
  return { category, label, tiebreak };
}

function compareScore(a, b) {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const x = a.tiebreak[i] || 0, y = b.tiebreak[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function bestHand(cards) {
  let best = null;
  for (const five of combinations(cards, 5)) {
    const s = scoreFive(five);
    if (!best || compareScore(s, best.score) > 0) best = { score: s, cards: five };
  }
  return best;
}

function getSeatOrder(room) {
  const players = room.players || {};
  const raw = Array.isArray(room.seatOrder) ? room.seatOrder : Object.values(room.seatOrder || {});
  const ids = Object.keys(players);
  const valid = raw.filter(id => typeof id === "string" && players[id]);
  ids.forEach(id => {
    if (!valid.includes(id)) valid.push(id);
  });
  return valid;
}

function getSeatByOffset(seats, startIndex, offset) {
  if (!seats.length) return null;
  const len = seats.length;
  return seats[(((startIndex + offset) % len) + len) % len];
}

function getNextActingId(room, startId) {
  const players = room.players || {};
  const seats = getSeatOrder(room);
  const actingSeats = seats.filter(id => {
    const p = players[id];
    return p && !p.folded && !p.allIn;
  });
  if (!actingSeats.length) return null;

  const startIdx = seats.indexOf(startId);
  if (startIdx >= 0) {
    for (let offset = 1; offset <= seats.length; offset++) {
      const candidate = getSeatByOffset(seats, startIdx, offset);
      if (actingSeats.includes(candidate)) {
        return candidate;
      }
    }
  }
  return actingSeats[0];
}

function postBlind(room, playerId, amount, label) {
  const p = room.players?.[playerId];
  if (!p) return 0;
  p.chips = Number(p.chips ?? 1000);
  p.roundBet = Number(p.roundBet || 0);
  p.handBet = Number(p.handBet || 0);
  room.pot = Number(room.pot || 0);
  room.maxBet = Number(room.maxBet || 0);

  const pay = Math.min(Math.max(0, amount), p.chips);
  p.chips -= pay;
  p.roundBet += pay;
  p.handBet += pay;
  room.pot += pay;
  if (p.chips === 0) {
    p.allIn = true;
  }
  if (p.roundBet > room.maxBet) {
    room.maxBet = p.roundBet;
  }
  room.blinds = room.blinds || {};
  room.blinds[playerId] = label;
  return pay;
}

function activePlayerIds(room) {
  const players = room.players || {};
  return Object.keys(players).filter(id => !players[id].folded);
}

function canActPlayerIds(room) {
  const players = room.players || {};
  return Object.keys(players).filter(id => !players[id].folded && !players[id].allIn);
}

function computeSidePots(room) {
  const players = room.players || {};
  const allIds = Object.keys(players);
  const levels = [
    ...new Set(
      allIds
        .map(id => Number(players[id]?.handBet || 0))
        .filter(v => v > 0)
    )
  ].sort((a, b) => a - b);

  const pots = [];
  let prevLevel = 0;

  for (const level of levels) {
    const slice = level - prevLevel;
    if (slice <= 0) continue;
    const contributors = allIds.filter(id => Number(players[id]?.handBet || 0) >= level);
    const amount = slice * contributors.length;
    const eligible = contributors.filter(id => !players[id]?.folded);
    if (amount > 0) {
      if (eligible.length > 0) {
        pots.push({ amount, eligible, cap: level });
      } else if (pots.length > 0) {
        pots[pots.length - 1].amount += amount;
      } else {
        pots.push({ amount, eligible: activePlayerIds(room), cap: level });
      }
    }
    prevLevel = level;
  }

  const totalPot = Number(room.pot || 0);
  const summed = pots.reduce((s, p) => s + p.amount, 0);
  if (totalPot > summed) {
    const diff = totalPot - summed;
    if (pots.length > 0) {
      pots[pots.length - 1].amount += diff;
    } else {
      pots.push({ amount: diff, eligible: activePlayerIds(room), cap: 0 });
    }
  }
  return pots;
}

function distributePots(room, scores) {
  const players = room.players || {};
  const rawPots = computeSidePots(room);
  const pots = rawPots.map(pot => ({
    amount: pot.amount,
    eligible: pot.eligible.filter(id => Boolean(scores[id]))
  })).filter(pot => pot.amount > 0 && pot.eligible.length > 0);

  const gainedByPlayer = {};
  const summaries = [];

  pots.forEach((pot, idx) => {
    let leaderId = pot.eligible[0];
    for (const id of pot.eligible.slice(1)) {
      if (compareScore(scores[id].score, scores[leaderId].score) > 0) {
        leaderId = id;
      }
    }
    const winners = pot.eligible.filter(
      id => compareScore(scores[id].score, scores[leaderId].score) === 0
    );
    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount % winners.length;

    winners.forEach((id, i) => {
      const gain = share + (i === 0 ? remainder : 0);
      players[id].chips = Number(players[id].chips ?? 1000) + gain;
      gainedByPlayer[id] = (gainedByPlayer[id] || 0) + gain;
    });

    const label = idx === 0 ? "メインポット" : `サイドポット${idx}`;
    const winnerText = winners
      .map(id => `${players[id].name}（${scores[id].score.label}）`)
      .join("、");
    summaries.push(`${label} ${pot.amount.toLocaleString("ja-JP")}pt → ${winnerText}`);
  });

  return { gainedByPlayer, summaries };
}

function startBettingRound(room) {
  const players = room.players || {};
  Object.keys(players).forEach(id => {
    players[id].roundBet = 0;
  });
  room.maxBet = 0;
  room.actions = {};

  const seats = getSeatOrder(room);
  room.turnOrder = seats.filter(id => players[id] && !players[id].folded);
  const nextId = getNextActingId(room, room.dealerId);
  room.activeTurn = nextId || room.turnOrder[0] || null;
}

function finishByFold(room, remaining) {
  const players = room.players || {};
  const winner = remaining[0];
  const pot = Number(room.pot || 0);
  if (winner) {
    players[winner].chips = Number(players[winner].chips ?? 1000) + pot;
    room.chipHistory = Array.isArray(room.chipHistory) ? room.chipHistory : [];
    room.chipHistory.push({
      round: room.round || 1,
      winners: [players[winner].name],
      points: pot,
      at: Date.now(),
      reason: "フォールドによるポット獲得"
    });
    room.chipHistory = room.chipHistory.slice(-20);
    room.result = `${players[winner].name} の勝利（他プレイヤーがフォールド） +${pot.toLocaleString("ja-JP")}pt`;
  } else {
    room.result = "勝者を決定できませんでした";
  }
  room.pot = 0;
  room.maxBet = 0;
  room.stage = "showdown";
  room.activeTurn = null;
  room.actions = {};
}

function settleShowdown(room) {
  const players = room.players || {}, community = room.community || [], scores = {};
  Object.keys(players).forEach(id => {
    const p = players[id];
    if (p.folded) return;
    const seven = (p.hole || []).concat(community);
    if (seven.length === 7) {
      const best = bestHand(seven);
      scores[id] = best;
      p.handLabel = best.score.label;
    }
  });
  const ids = Object.keys(scores);
  const totalPot = Number(room.pot || 0);
  if (!ids.length) {
    room.result = "判定できるプレイヤーがいません";
    room.stage = "showdown";
    room.activeTurn = null;
    room.pot = 0;
    room.maxBet = 0;
    return;
  }

  const { gainedByPlayer, summaries } = distributePots(room, scores);
  const winnerIds = Object.keys(gainedByPlayer).filter(id => gainedByPlayer[id] > 0);

  room.pot = 0;
  room.maxBet = 0;
  room.chipHistory = Array.isArray(room.chipHistory) ? room.chipHistory : [];
  if (winnerIds.length > 0) {
    room.chipHistory.push({
      round: room.round || 1,
      winners: winnerIds.map(id => `${players[id].name}(+${gainedByPlayer[id].toLocaleString("ja-JP")}pt)`),
      points: totalPot,
      at: Date.now()
    });
    room.chipHistory = room.chipHistory.slice(-20);
  }
  room.result = summaries.length > 0 ? summaries.join("\n") : "分配対象がありませんでした";

  room.stage = "showdown";
  room.activeTurn = null;
  room.actions = {};
}

function dealNextCommunityStage(room) {
  const deck = room.deck;
  if (!deck) {
    room.result = "カードデッキが見つかりません";
    room.stage = "finished";
    room.activeTurn = null;
    return false;
  }
  if (room.stage === "preflop") {
    deck.splice(0, 1);
    room.community = deck.splice(0, 3);
    room.stage = "flop";
  } else if (room.stage === "flop") {
    deck.splice(0, 1);
    room.community.push(deck.pop());
    room.stage = "turn";
  } else if (room.stage === "turn") {
    deck.splice(0, 1);
    room.community.push(deck.pop());
    room.stage = "river";
  } else if (room.stage === "river") {
    settleShowdown(room);
    return false;
  }
  return true;
}

function advanceAfterActions(room) {
  const players = room.players || {};
  const alive = activePlayerIds(room);
  if (alive.length <= 1) {
    finishByFold(room, alive);
    return;
  }

  const seats = getSeatOrder(room);
  const order = seats.filter(id => players[id] && !players[id].folded);
  room.turnOrder = order;

  const actingIds = canActPlayerIds(room);
  const maxBet = Number(room.maxBet || 0);
  const pending = actingIds.filter(id => {
    const p = players[id];
    const pBet = Number(p.roundBet || 0);
    return !room.actions?.[id] || pBet < maxBet;
  });
  if (pending.length > 0) {
    const currentIndex = Math.max(0, order.indexOf(room.activeTurn));
    for (let offset = 1; offset <= order.length; offset++) {
      const candidate = order[(currentIndex + offset) % order.length];
      if (pending.includes(candidate)) {
        room.activeTurn = candidate;
        return;
      }
    }
    room.activeTurn = pending[0];
    return;
  }
  if (actingIds.length < 2) {
    while (["preflop", "flop", "turn", "river"].includes(room.stage)) {
      const moved = dealNextCommunityStage(room);
      if (!moved) break;
    }
    if (room.stage !== "showdown" && room.stage !== "finished") {
      settleShowdown(room);
    }
    return;
  }
  const moved = dealNextCommunityStage(room);
  if (moved) {
    startBettingRound(room);
  }
}

async function submitBetAction(action, targetRoundBet = 0) {
  if (!["check", "call", "raise", "fold"].includes(action) || busy || !roomId) return;
  busy = true;
  try {
    const tx = await runTransaction(roomRef(), room => {
      if (!room || !["preflop", "flop", "turn", "river"].includes(room.stage)) return;
      const p = room.players?.[myId];
      if (!p || room.activeTurn !== myId || p.folded || p.allIn) return;

      room.pot = Number(room.pot || 0);
      room.maxBet = Number(room.maxBet || 0);
      p.chips = Number(p.chips ?? 1000);
      p.roundBet = Number(p.roundBet || 0);
      p.handBet = Number(p.handBet || 0);
      room.actions = room.actions || {};

      const toCall = Math.max(0, room.maxBet - p.roundBet);

      if (action === "fold") {
        p.folded = true;
        room.actions[myId] = "fold";
      } else if (action === "check") {
        if (toCall > 0) return;
        room.actions[myId] = "check";
      } else if (action === "call") {
        if (toCall <= 0) return;
        const pay = Math.min(toCall, p.chips);
        p.chips -= pay;
        p.roundBet += pay;
        p.handBet += pay;
        room.pot += pay;
        if (p.chips === 0) p.allIn = true;
        room.actions[myId] = p.allIn ? "allin" : "call";
      } else if (action === "raise") {
        const desired = Math.floor(Number(targetRoundBet || 0));
        const maxPossible = p.roundBet + p.chips;
        const actualTarget = Math.min(desired, maxPossible);
        if (actualTarget <= room.maxBet && actualTarget < maxPossible) return;
        const addChips = actualTarget - p.roundBet;
        if (addChips <= 0 || addChips > p.chips) return;

        const isOpeningBet = room.maxBet === 0;
        p.chips -= addChips;
        p.roundBet += addChips;
        p.handBet += addChips;
        room.pot += addChips;
        if (p.chips === 0) p.allIn = true;

        if (p.roundBet > room.maxBet) {
          room.maxBet = p.roundBet;
          Object.keys(room.players).forEach(otherId => {
            if (otherId !== myId) {
              delete room.actions[otherId];
            }
          });
        }
        room.actions[myId] = p.allIn ? "allin" : (isOpeningBet ? "bet" : "raise");
      }

      advanceAfterActions(room);
      return room;
    }, { applyLocally: false });
    if (!tx.committed) status("行動を送信できませんでした。ベット額やターンを確認してください。");
  } catch (err) {
    console.error(err);
    status("行動同期エラー：" + (err.code || err.message));
  } finally {
    busy = false;
    if (latestRoom) setControls(latestRoom);
  }
}

function actionLabelText(act) {
  return ({
    check: "チェック済",
    call: "コール済",
    bet: "ベット済",
    raise: "レイズ済",
    allin: "オールイン！",
    fold: "フォールド済"
  })[act] || "未行動";
}

function renderChipStackVisual(amount) {
  const visual = $("stackVisual");
  if (!visual) return;
  visual.innerHTML = "";
  let rem = Math.max(0, Math.floor(Number(amount || 0)));
  const denoms = [
    { unit: 100, cls: "c100" },
    { unit: 50,  cls: "c50" },
    { unit: 25,  cls: "c25" },
    { unit: 10,  cls: "c10" }
  ];

  denoms.forEach(d => {
    const count = Math.min(6, Math.floor(rem / d.unit));
    rem -= count * d.unit;
    if (count > 0) {
      const col = document.createElement("div");
      col.className = "mini-stack-col";
      for (let i = 0; i < count; i++) {
        const disc = document.createElement("span");
        disc.className = `mini-chip-disc ${d.cls}`;
        col.appendChild(disc);
      }
      visual.appendChild(col);
    }
  });

  if (!visual.children.length && amount > 0) {
    const col = document.createElement("div");
    col.className = "mini-stack-col";
    const disc = document.createElement("span");
    disc.className = "mini-chip-disc c10";
    col.appendChild(disc);
    visual.appendChild(col);
  }
}

function updateChipReadout(room) {
  const betInput = $("betAmountInput");
  const val = Math.max(0, Math.floor(Number(betInput ? betInput.value : 0)));
  $("selectedBetReadout").textContent = val.toLocaleString("ja-JP");
  $("pushChipTargetLabel").textContent = `${val.toLocaleString("ja-JP")}pt`;
  renderChipStackVisual(val);

  const toCall = room ? Math.max(0, Number(room.maxBet || 0) - Number(room.players?.[myId]?.roundBet || 0)) : 0;
  const isRaise = toCall > 0;
  $("pushActionVerb").textContent = isRaise ? "チップを押してレイズ" : "チップを押してベット";
  $("pushActionSub").textContent = isRaise
    ? `合計 ${val.toLocaleString("ja-JP")}pt まで押し込み確定`
    : `合計 ${val.toLocaleString("ja-JP")}pt を卓へ押し込み確定`;
}

function syncMobileQuickBar(room, ctrl) {
  const bar = $("mobileQuickBar");
  const statusEl = $("mobileQuickStatus");
  const mCheck = $("mobileCheckOrCallBtn");
  const mBet = $("mobileBetOrRaiseBtn");
  const mFold = $("mobileFoldBtn");
  if (!bar || !statusEl || !mCheck || !mBet || !mFold) return;

  const inRoom = room && !$("gamePanel").classList.contains("hidden");
  if (!inRoom) {
    bar.classList.add("hidden");
    return;
  }

  bar.classList.remove("hidden");
  const players = room.players || {};
  const activeName = room.activeTurn ? (players[room.activeTurn]?.name || "プレイヤー") : "";

  if (!ctrl.isLive) {
    statusEl.textContent = room.stage === "waiting" ? "開始待ち" : "ラウンド終了";
  } else if (room.activeTurn === myId) {
    statusEl.textContent = ctrl.toCall > 0
      ? `あなたの番！ コール ${ctrl.toCall}pt / 基準 ${ctrl.maxBet}pt`
      : "あなたの番！ チェックまたはチップを押してベット";
  } else {
    statusEl.textContent = `${activeName || "他プレイヤー"} の行動中...`;
  }

  mCheck.textContent = $("checkOrCallBtn").textContent;
  mBet.textContent = $("betOrRaiseBtn").textContent;
  mCheck.disabled = $("checkOrCallBtn").disabled;
  mBet.disabled = $("betOrRaiseBtn").disabled;
  mFold.disabled = $("foldActionBtn").disabled;
}

function setControls(room) {
  const host = room.host === myId, stage = room.stage || "waiting";
  const liveStages = ["preflop", "flop", "turn", "river"];
  const isLive = liveStages.includes(stage);
  const me = room.players?.[myId];
  const isMyActiveTurn = isLive && room.activeTurn === myId;
  const isFolded = !!me?.folded;
  const isAllIn = !!me?.allIn;
  const maxBet = Number(room.maxBet || 0);
  const myRoundBet = Number(me?.roundBet || 0);
  const myChips = Number(me?.chips ?? 1000);
  const toCall = Math.max(0, maxBet - myRoundBet);
  const alreadyActed = !!room.actions?.[myId] && toCall === 0;
  const canAct = isMyActiveTurn && !isFolded && !isAllIn && !alreadyActed && !busy;

  $("startBtn").disabled = !host || stage !== "waiting" || Object.keys(room.players || {}).length < 2;
  $("resetBtn").disabled = !host || !(["showdown", "finished"].includes(stage));

  const checkOrCallBtn = $("checkOrCallBtn");
  const betOrRaiseBtn = $("betOrRaiseBtn");
  const pushChipBtn = $("pushChipActionBtn");
  const betInput = $("betAmountInput");

  if (toCall > 0) {
    const callPay = Math.min(toCall, myChips);
    checkOrCallBtn.textContent = callPay >= myChips ? `オールインでコール (${callPay}pt)` : `コール (${callPay}pt)`;
    betOrRaiseBtn.textContent = "レイズ確定";
  } else {
    checkOrCallBtn.textContent = "チェック";
    betOrRaiseBtn.textContent = "ベット確定";
  }

  checkOrCallBtn.disabled = !canAct;
  $("foldActionBtn").disabled = !canAct;

  const canRaise = canAct && (myRoundBet + myChips > maxBet);
  betOrRaiseBtn.disabled = !canRaise;
  pushChipBtn.disabled = !canRaise;
  $("clearChipsBtn").disabled = !canRaise;
  betInput.disabled = !canRaise;
  $("allInSetBtn").disabled = !canRaise;
  document.querySelectorAll(".poker-chip[data-chip]").forEach(btn => btn.disabled = !canRaise);

  if (canRaise) {
    const minTarget = maxBet + BB_AMOUNT;
    const maxTarget = myRoundBet + myChips;
    const currentVal = Number(betInput.value || 0);
    if (currentVal <= maxBet || currentVal > maxTarget) {
      betInput.value = Math.min(minTarget, maxTarget);
    }
  }

  updateChipReadout(room);

  const info = { isLive, isMyActiveTurn, isFolded, isAllIn, alreadyActed, canAct, toCall, maxBet };
  syncMobileQuickBar(room, info);
  return info;
}

function buildPlayerCardElement(id, p, room, stage) {
  const box = document.createElement("div");
  box.className = "player" + (id === myId ? " me" : "") + (id === room.activeTurn ? " turn" : "") + (p.folded ? " folded" : "");

  const av = getAvatarById(p.avatar);
  const avatarEl = document.createElement("div");
  avatarEl.className = "player-avatar";
  avatarEl.textContent = av.glyph;
  box.appendChild(avatarEl);

  const badges = [];
  if (id === room.dealerId) badges.push("D");
  if (id === room.sbId) badges.push("SB");
  if (id === room.bbId) badges.push("BB");
  const posTag = badges.length ? ` [${badges.join("/")}]` : "";

  const nm = document.createElement("div");
  nm.className = "player-name";
  nm.textContent = p.name + posTag + (id === room.host ? " 👑" : "");

  const meta = document.createElement("div");
  meta.className = "player-meta";
  const stateText = p.folded ? "フォールド" : p.allIn ? "オールイン" : (room.actions?.[id] ? actionLabelText(room.actions[id]) : "未行動");
  meta.textContent = (id === myId ? "あなた" : av.label) + " · " + stateText;
  box.append(nm, meta);

  const chipDisplay = document.createElement("div");
  chipDisplay.className = "chip-count";
  chipDisplay.innerHTML = '<span class="chip-icon">🟡</span><span>' + Number(p.chips ?? 1000).toLocaleString("ja-JP") + " pt</span>";
  box.appendChild(chipDisplay);

  if (["preflop", "flop", "turn", "river"].includes(stage)) {
    const rb = document.createElement("div");
    rb.className = "round-bet-badge";
    rb.textContent = "今R: " + Number(p.roundBet || 0).toLocaleString("ja-JP") + " pt";
    const hb = document.createElement("div");
    hb.className = "hand-bet-badge";
    hb.textContent = "累計: " + Number(p.handBet || 0).toLocaleString("ja-JP") + " pt";
    box.append(rb, hb);
  }

  if (stage === "showdown" || stage === "finished") {
    const cards = document.createElement("div");
    cards.className = "cards";
    cards.innerHTML = (p.hole || []).map(cardHtml).join("");
    box.appendChild(cards);
    if (p.handLabel) {
      const rank = document.createElement("p");
      rank.className = "status";
      rank.textContent = p.handLabel;
      box.appendChild(rank);
    }
  } else {
    const backs = document.createElement("div");
    backs.className = "cards";
    backs.innerHTML = '<div class="playing-card back">◆</div><div class="playing-card back">◆</div>';
    box.appendChild(backs);
  }

  return box;
}

function renderSeatsAroundTable(room, ids, players, stage) {
  const container = $("players");
  container.innerHTML = "";

  const myIndex = ids.indexOf(myId);
  const rotateOffset = myIndex >= 0 ? myIndex : 0;

  const orderedForView = ids.map((_, idx) => ids[(idx + rotateOffset) % ids.length]);

  TABLE_SEAT_COORDS.forEach((coord, slotIdx) => {
    const slot = document.createElement("div");
    slot.className = "seat-slot";
    slot.style.left = `${coord.left}%`;
    slot.style.top = `${coord.top}%`;

    const pid = orderedForView[slotIdx];
    const p = pid ? players[pid] : null;
    if (p) {
      slot.appendChild(buildPlayerCardElement(pid, p, room, stage));
    } else {
      const empty = document.createElement("div");
      empty.className = "seat-empty";
      empty.textContent = `SEAT ${slotIdx + 1}`;
      slot.appendChild(empty);
    }

    container.appendChild(slot);
  });
}

function render(room) {
  try {
    latestRoom = room;
    const players = room.players || {}, ids = getSeatOrder(room), stage = room.stage || "waiting";
    if ($("hudPot")) $("hudPot").textContent = Number(room.pot || 0).toLocaleString("ja-JP");
    if ($("hudMaxBet")) $("hudMaxBet").textContent = Number(room.maxBet || 0).toLocaleString("ja-JP");
    if ($("hudMyChips")) $("hudMyChips").textContent = Number(players[myId]?.chips ?? 1000).toLocaleString("ja-JP");
    if ($("hudTurn")) {
      if (!["preflop", "flop", "turn", "river"].includes(stage)) {
        $("hudTurn").textContent = stage === "waiting" ? "待機" : "終了";
      } else if (room.activeTurn === myId) {
        $("hudTurn").textContent = "自分！";
      } else {
        $("hudTurn").textContent = room.activeTurn ? (players[room.activeTurn]?.name || "他") : "-";
      }
    }

    $("potAmount").textContent = Number(room.pot || 0).toLocaleString("ja-JP");
    $("maxBetAmount").textContent = Number(room.maxBet || 0).toLocaleString("ja-JP");

    const sidePotList = $("sidePotList");
    sidePotList.innerHTML = "";
    if (["preflop", "flop", "turn", "river"].includes(stage) && Number(room.pot || 0) > 0) {
      const pots = computeSidePots(room);
      if (pots.length > 1) {
        pots.forEach((pot, idx) => {
          const tag = document.createElement("span");
          tag.className = "side-pot-tag";
          const label = idx === 0 ? "メインポット" : `サイドポット${idx}`;
          const names = pot.eligible.map(id => players[id]?.name || "?").join("・");
          tag.textContent = `${label}: ${pot.amount.toLocaleString("ja-JP")}pt（対象: ${names}）`;
          sidePotList.appendChild(tag);
        });
      }
    }

    renderSeatsAroundTable(room, ids, players, stage);

    const history = Array.isArray(room.chipHistory) ? room.chipHistory : [];
    $("chipHistoryList").innerHTML = "";
    if (history.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "まだ獲得履歴はありません。";
      $("chipHistoryList").appendChild(empty);
    } else {
      history.slice(-10).reverse().forEach(item => {
        const li = document.createElement("li");
        const winners = (item.winners || []).join(" / ");
        li.textContent = "第" + (item.round || "?") + "ラウンド：" + winners + "（計 " + Number(item.points || 0).toLocaleString("ja-JP") + " pt）";
        $("chipHistoryList").appendChild(li);
      });
    }

    const community = room.community || [];
    const stageText = ({
      waiting: "参加者募集中",
      preflop: "プリフロップ：手札配布済み（SB/BB徴収済）",
      flop: "フロップ：共有カード3枚",
      turn: "ターン：共有カード4枚",
      river: "リバー：共有カード5枚",
      showdown: "ショーダウン",
      finished: "ラウンド終了"
    })[stage] || stage;
    renderCards($("communityCards"), community, 5);
    $("stageLabel").textContent = stageText;
    if ($("actionCommunityCards")) {
      renderCards($("actionCommunityCards"), community, 5);
    }
    if ($("actionStageLabel")) {
      $("actionStageLabel").textContent = stageText;
    }

    const me = players[myId];
    renderCards($("myCards"), me?.hole || [], 2);
    $("myHandRank").textContent = (stage === "showdown" || stage === "finished")
      ? (me?.handLabel || "")
      : me?.hole?.length ? "手札が配られました" : "まだカードは配られていません";

    const host = room.host === myId;
    isHost = host;
    status(`${stage.toUpperCase()} · ${ids.length}/8人`);

    const ctrl = setControls(room);
    if ($("tabTurnDot")) {
      $("tabTurnDot").classList.toggle("hidden", !ctrl.isMyActiveTurn);
    }
    const activeName = room.activeTurn ? players[room.activeTurn]?.name || "プレイヤー" : "";
    if (["preflop", "flop", "turn", "river"].includes(stage)) {
      if (room.activeTurn === myId) {
        $("turnBanner").textContent = "あなたの行動ターンです！";
        if (!ctrl.canAct) {
          $("actionHint").textContent = `押せない理由: folded=${ctrl.isFolded}, allIn=${ctrl.isAllIn}, acted=${ctrl.alreadyActed}, busy=${busy}`;
        } else if (ctrl.toCall > 0) {
          $("actionHint").textContent = `現在 ${ctrl.maxBet}pt のベットが出ています。コール（あと ${ctrl.toCall}pt）、チップを積んで押すレイズ、またはフォールドを選んでください。`;
        } else {
          $("actionHint").textContent = "まだベットは出ていません。チェック、チップを積んで押すベット、またはフォールドを選んでください。";
        }
      } else if (room.activeTurn) {
        $("turnBanner").textContent = activeName + " の行動中です。";
        $("actionHint").textContent = "あなたのターンになるまでお待ちください。";
      } else {
        $("turnBanner").textContent = "行動ターンが未設定（activeTurn: null）です。";
        $("actionHint").textContent = "コンソールにエラーが出ていないか確認してください。";
      }
    } else {
      $("turnBanner").textContent = stage === "waiting" ? "ゲーム開始後、行動ターンが表示されます。" : "このラウンドの行動は終了しました。";
      $("actionHint").textContent = stage === "showdown" ? "勝敗が決定し、ポットが分配されました。" : "ホストが「ゲーム開始・配布」を押すのを待っています。";
    }

    if (stage === "showdown" || stage === "finished") {
      $("resultBox").classList.remove("hidden");
      $("resultText").textContent = room.result || "判定済み";
    } else {
      $("resultBox").classList.add("hidden");
    }
  } catch (err) {
    console.error("render error:", err);
    status("描画エラー：" + (err?.message || err));
  }
}

function enterRoom() {
  $("lobby").classList.add("hidden");
  $("gamePanel").classList.remove("hidden");
  $("roomCode").textContent = roomId;
  if (roomListener) roomListener();
  roomListener = onValue(roomRef(), snap => {
    if (!snap.exists()) {
      status("ルームが終了しました");
      return;
    }
    render(snap.val());
  }, err => {
    console.error(err);
    status("同期エラー：" + (err.code || err.message));
  });
}

$("createBtn").onclick = async () => {
  if (busy) return;
  myName = $("nameInput").value.trim();
  if (!myName) {
    message("プレイヤー名を入力してください");
    return;
  }
  busy = true;
  $("createBtn").disabled = true;
  $("joinBtn").disabled = true;
  message("ルーム作成中...");
  try {
    let created = false;
    for (let attempt = 1; attempt <= 8; attempt++) {
      roomId = createRoomCode();
      roomPath = roomId;
      const roomData = {
        host: myId,
        state: "waiting",
        stage: "waiting",
        createdAt: Date.now(),
        round: 0,
        pot: 0,
        maxBet: 0,
        dealerId: null,
        sbId: null,
        bbId: null,
        seatOrder: [],
        community: [],
        deck: null,
        result: "",
        players: {
          [myId]: {
            name: myName,
            avatar: selectedAvatar,
            joinedAt: Date.now(),
            hole: [],
            handLabel: "",
            chips: 1000,
            roundBet: 0,
            handBet: 0,
            folded: false,
            allIn: false
          }
        },
        chipHistory: []
      };
      const tx = await runTransaction(ref(db, roomPath), current => current === null ? roomData : undefined, { applyLocally: false });
      if (tx.committed && tx.snapshot.exists() && tx.snapshot.val()?.players?.[myId]) {
        created = true;
        break;
      }
    }
    if (!created) {
      message("ルームを作成できませんでした。FirebaseのRealtime Database Rules・DB URLを確認してください。");
      return;
    }
    isHost = true;
    enterRoom();
  } catch (e) {
    console.error(e);
    message("作成エラー：" + (e?.message || String(e)));
  } finally {
    busy = false;
    $("createBtn").disabled = false;
    $("joinBtn").disabled = false;
  }
};

$("joinBtn").onclick = async () => {
  if (busy) return;
  myName = $("nameInput").value.trim();
  roomId = normalizeRoomId($("roomInput").value);
  $("roomInput").value = roomId;
  if (!myName || !roomId) {
    message("名前とルームIDを入力してください");
    return;
  }
  busy = true;
  $("joinBtn").disabled = true;
  $("createBtn").disabled = true;
  message("ルーム確認中...");
  try {
    const found = await findRoomPath(roomId);
    roomPath = found.path;
    const room = found.snapshot.val();
    if (!found.snapshot.exists()) {
      message("ルームが見つかりません");
      return;
    }
    if (room.stage !== "waiting") {
      message("このルームはすでに開始されています");
      return;
    }
    const tx = await runTransaction(ref(db, roomPath), current => {
      if (current === null) return null;
      if (current.stage !== "waiting") return;
      current.players = current.players || {};
      if (current.players[myId]) {
        current.players[myId].name = myName;
        current.players[myId].avatar = selectedAvatar;
        return current;
      }
      if (Object.keys(current.players).length >= 8) return;
      current.players[myId] = {
        name: myName,
        avatar: selectedAvatar,
        joinedAt: Date.now(),
        hole: [],
        handLabel: "",
        chips: 1000,
        roundBet: 0,
        handBet: 0,
        folded: false,
        allIn: false
      };
      return current;
    }, { applyLocally: false });
    if (!tx.committed || !tx.snapshot.val()?.players?.[myId]) {
      message("参加に失敗しました。ID重複・満員・Rulesを確認してください");
      return;
    }
    isHost = tx.snapshot.val().host === myId;
    enterRoom();
  } catch (e) {
    console.error(e);
    message("参加エラー：" + (e.code || e.message));
  } finally {
    busy = false;
    $("joinBtn").disabled = false;
    $("createBtn").disabled = false;
  }
};

async function hostTransaction(fn, failText) {
  if (!isHost || busy) return;
  busy = true;
  try {
    const tx = await runTransaction(roomRef(), room => {
      if (!room || room.host !== myId) return;
      return fn(room);
    });
    if (!tx.committed) status(failText);
  } catch (e) {
    console.error(e);
    status("処理エラー：" + (e.code || e.message));
  } finally {
    busy = false;
    if (latestRoom) setControls(latestRoom);
  }
}

$("startBtn").onclick = () => hostTransaction(room => {
  if (room.stage !== "waiting") return;
  const players = room.players || {};
  const seats = getSeatOrder(room);
  if (seats.length < 2 || seats.length > 8) return;

  const prevDealerIdx = seats.indexOf(room.dealerId);
  const dealerIdx = prevDealerIdx >= 0 ? (prevDealerIdx + 1) % seats.length : 0;
  const dealerId = seats[dealerIdx];
  const isHeadsUp = seats.length === 2;
  const sbId = isHeadsUp ? dealerId : getSeatByOffset(seats, dealerIdx, 1);
  const bbId = isHeadsUp ? getSeatByOffset(seats, dealerIdx, 1) : getSeatByOffset(seats, dealerIdx, 2);

  const deck = deckCreate();
  seats.forEach(id => {
    const p = players[id];
    if (Number(p.chips ?? 0) <= 0) p.chips = 1000;
    p.hole = [deck.pop(), deck.pop()];
    p.handLabel = "";
    p.roundBet = 0;
    p.handBet = 0;
    p.folded = false;
    p.allIn = false;
  });
  room.seatOrder = seats;
  room.dealerId = dealerId;
  room.sbId = sbId;
  room.bbId = bbId;
  room.blinds = {};
  room.deck = deck;
  room.community = [];
  room.result = "";
  room.pot = 0;
  room.maxBet = 0;
  room.stage = "preflop";
  room.round = (room.round || 0) + 1;
  room.actions = {};

  postBlind(room, sbId, SB_AMOUNT, "SB");
  postBlind(room, bbId, BB_AMOUNT, "BB");

  room.turnOrder = seats.slice();
  const firstActor = getNextActingId(room, bbId);
  room.activeTurn = firstActor;
  if (!firstActor) {
    advanceAfterActions(room);
  }
  return room;
}, "開始できませんでした");

$("resetBtn").onclick = () => hostTransaction(room => {
  if (!["showdown", "finished"].includes(room.stage)) return;
  Object.values(room.players || {}).forEach(p => {
    p.hole = [];
    p.handLabel = "";
    p.roundBet = 0;
    p.handBet = 0;
    p.folded = false;
    p.allIn = false;
  });
  room.community = [];
  room.deck = null;
  room.result = "";
  room.pot = 0;
  room.maxBet = 0;
  room.actions = {};
  room.blinds = {};
  room.activeTurn = null;
  room.stage = "waiting";
  return room;
}, "次のゲームに戻れませんでした");

$("copyRoomBtn").onclick = async () => {
  try {
    await navigator.clipboard.writeText(roomId);
    status("ルームIDをコピーしました");
  } catch {
    status("コピーできませんでした");
  }
};

$("leaveBtn").onclick = async () => {
  if (busy) return;
  busy = true;
  try {
    await runTransaction(roomRef(), room => {
      if (!room?.players?.[myId]) return;
      delete room.players[myId];
      const ids = Object.keys(room.players);
      if (!ids.length) {
        room.stage = "closed";
        room.state = "closed";
        room.result = "全員退出しました";
        return room;
      }
      if (room.host === myId) room.host = ids[0];
      if (ids.length < 2 && room.stage !== "waiting") {
        room.stage = "waiting";
        room.community = [];
        room.deck = null;
        room.result = "";
        room.pot = 0;
        room.maxBet = 0;
        ids.forEach(id => {
          room.players[id].hole = [];
          room.players[id].handLabel = "";
          room.players[id].roundBet = 0;
          room.players[id].handBet = 0;
          room.players[id].folded = false;
          room.players[id].allIn = false;
        });
      }
      return room;
    });
    if (roomListener) {
      roomListener();
      roomListener = null;
    }
    location.reload();
  } catch (e) {
    console.error(e);
    status("退出エラー");
  } finally {
    busy = false;
  }
};

function triggerCheckOrCall() {
  if (!latestRoom) return;
  const maxBet = Number(latestRoom.maxBet || 0);
  const myRoundBet = Number(latestRoom.players?.[myId]?.roundBet || 0);
  const toCall = Math.max(0, maxBet - myRoundBet);
  submitBetAction(toCall > 0 ? "call" : "check");
}

function triggerBetOrRaise() {
  const pushBtn = $("pushChipActionBtn");
  if (pushBtn && !pushBtn.disabled) {
    pushBtn.classList.add("chip-pushed");
    setTimeout(() => pushBtn.classList.remove("chip-pushed"), 180);
  }
  const target = Number($("betAmountInput").value || 0);
  submitBetAction("raise", target);
}

$("checkOrCallBtn").addEventListener("click", triggerCheckOrCall);
$("betOrRaiseBtn").addEventListener("click", triggerBetOrRaise);
$("pushChipActionBtn").addEventListener("click", triggerBetOrRaise);
$("foldActionBtn").addEventListener("click", () => submitBetAction("fold"));

$("mobileCheckOrCallBtn").addEventListener("click", triggerCheckOrCall);
$("mobileBetOrRaiseBtn").addEventListener("click", triggerBetOrRaise);
$("mobileFoldBtn").addEventListener("click", () => submitBetAction("fold"));

$("betAmountInput").addEventListener("input", () => updateChipReadout(latestRoom));

$("clearChipsBtn").addEventListener("click", () => {
  if (!latestRoom) return;
  const me = latestRoom.players?.[myId];
  const maxBet = Number(latestRoom.maxBet || 0);
  const maxPossible = me ? Number(me.roundBet || 0) + Number(me.chips ?? 1000) : maxBet + BB_AMOUNT;
  const minReset = maxBet > 0 ? Math.min(maxBet + BB_AMOUNT, maxPossible) : Math.min(BB_AMOUNT, maxPossible);
  $("betAmountInput").value = minReset;
  updateChipReadout(latestRoom);
});

document.querySelectorAll(".poker-chip[data-chip]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!latestRoom) return;
    const me = latestRoom.players?.[myId];
    if (!me) return;
    const maxBet = Number(latestRoom.maxBet || 0);
    const maxPossible = Number(me.roundBet || 0) + Number(me.chips ?? 1000);
    const current = Number($("betAmountInput").value || 0);
    const base = current > maxBet ? current : maxBet;
    const add = Number(btn.dataset.chip || 0);
    $("betAmountInput").value = Math.min(base + add, maxPossible);
    updateChipReadout(latestRoom);
  });
});

$("allInSetBtn").addEventListener("click", () => {
  if (!latestRoom) return;
  const me = latestRoom.players?.[myId];
  if (!me) return;
  $("betAmountInput").value = Number(me.roundBet || 0) + Number(me.chips ?? 1000);
  updateChipReadout(latestRoom);
});

let activeMobileTab = "table";

function applyMobileViewTab(tabName) {
  activeMobileTab = tabName === "action" ? "action" : "table";
  const panel = $("gamePanel");
  const tabTableBtn = $("tabTableBtn");
  const tabActionBtn = $("tabActionBtn");
  if (panel) {
    panel.classList.remove("tab-mode-table", "tab-mode-action");
    panel.classList.add(`tab-mode-${activeMobileTab}`);
  }
  if (tabTableBtn) {
    const isTable = activeMobileTab === "table";
    tabTableBtn.classList.toggle("active", isTable);
    tabTableBtn.setAttribute("aria-selected", String(isTable));
  }
  if (tabActionBtn) {
    const isAction = activeMobileTab === "action";
    tabActionBtn.classList.toggle("active", isAction);
    tabActionBtn.setAttribute("aria-selected", String(isAction));
  }
}

function setDrawerOpen(open) {
  const drawer = $("roomDrawer");
  const backdrop = $("drawerBackdrop");
  if (!drawer || !backdrop) return;
  drawer.classList.toggle("hidden", !open);
  backdrop.classList.toggle("hidden", !open);
  backdrop.setAttribute("aria-hidden", String(!open));
}

function setHandsModalOpen(open) {
  const modal = $("handsModal");
  const backdrop = $("handsModalBackdrop");
  if (!modal || !backdrop) return;
  modal.classList.toggle("hidden", !open);
  backdrop.classList.toggle("hidden", !open);
  backdrop.setAttribute("aria-hidden", String(!open));
}

function initMobileNavigation() {
  applyMobileViewTab("table");
  $("tabTableBtn")?.addEventListener("click", () => applyMobileViewTab("table"));
  $("tabActionBtn")?.addEventListener("click", () => applyMobileViewTab("action"));

  $("openRoomDrawerBtn")?.addEventListener("click", () => setDrawerOpen(true));
  $("closeDrawerBtn")?.addEventListener("click", () => setDrawerOpen(false));
  $("drawerBackdrop")?.addEventListener("click", () => setDrawerOpen(false));

  $("openHandsModalBtn")?.addEventListener("click", () => setHandsModalOpen(true));
  $("closeHandsModalBtn")?.addEventListener("click", () => setHandsModalOpen(false));
  $("handsModalBackdrop")?.addEventListener("click", () => setHandsModalOpen(false));

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      setDrawerOpen(false);
      setHandsModalOpen(false);
    }
  });
}


// ロビー＆ナビゲーション安全初期化
(function safeBootstrap() {
  try {
    if (typeof renderAvatarPicker === "function") {
      renderAvatarPicker();
    }
    if (typeof updateChipReadout === "function") {
      updateChipReadout(latestRoom || null);
    }
    if (typeof initMobileNavigation === "function") {
      initMobileNavigation();
    }
  } catch (err) {
    console.error("Bootstrap error:", err);
    if ($("message")) {
      $("message").textContent = "初期化エラー: " + (err?.message || err);
    }
  }
})();
