/**
* bot.js - 核心逻辑（只读，不改配置）
* 所有配置从 config.js 和 messages.js 读取
*/

const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const config = require('./config');
const messages = require('./messages');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(id => id);
const BOT_USERNAME = process.env.BOT_USERNAME || config.botUsername;

const bot = new TelegramBot(TOKEN, { polling: true });
const db = new sqlite3.Database('./lottery.db');
const pendingDeposits = {};

// 初始化数据库
db.serialize(() => {
db.run(`CREATE TABLE IF NOT EXISTS users (
tg_id TEXT PRIMARY KEY, username TEXT, game_id TEXT,
points INTEGER DEFAULT 0, total_deposit INTEGER DEFAULT 0,
invite_count INTEGER DEFAULT 0, invited_by TEXT,
checkin_streak INTEGER DEFAULT 0, last_checkin TEXT
)`);
db.run(`CREATE TABLE IF NOT EXISTS numbers (
lucky_number INTEGER PRIMARY KEY, tg_id TEXT, game_id TEXT,
tier TEXT, is_winner INTEGER DEFAULT 0, prize_amount INTEGER DEFAULT 0
)`);
db.run(`CREATE TABLE IF NOT EXISTS checkins (
id INTEGER PRIMARY KEY, tg_id TEXT, date TEXT, points INTEGER, streak INTEGER
)`);
});

const isAdmin = (id) => ADMIN_IDS.includes(id.toString());

function generateLuckyNumbers(count, callback, numbers = []) {
if (numbers.length >= count) { callback(numbers); return; }
const num = Math.floor(100000 + Math.random() * 900000);
db.get('SELECT 1 FROM numbers WHERE lucky_number = ?', [num], (err, row) => {
if (!row && !numbers.includes(num)) numbers.push(num);
generateLuckyNumbers(count, callback, numbers);
});
}

function getStats(callback) {
db.get('SELECT COUNT(*) as c FROM users', [], (e, u) => {
db.get('SELECT COUNT(*) as c FROM numbers', [], (e, n) => {
db.get('SELECT SUM(prize_amount) as s FROM numbers WHERE is_winner = 1', [], (e, p) => {
callback({
users: u ? u.c : 0,
numbers: n ? n.c : 0,
totalPrizes: p && p.s ? p.s : 0
});
});
});
});
}

function formatTimeRemaining() {
const now = new Date();
const target = new Date();
target.setHours(20, 0, 0, 0);
if (now > target) target.setDate(target.getDate() + 1);
const diff = target - now;
const h = Math.floor(diff / (1000 * 60 * 60));
const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
return `${h}小时${m}分`;
}
function formatTiers() {
return Object.values(config.tiers)
.map(tier => messages.tierDescription(tier))
.join('\n\n');
}

function formatPrizes() {
return config.prizes
.map(prize => messages.prizeDescription(prize))
.join('\n');
}

// ========== 命令处理 ==========
bot.on('message', (msg) => {
const chatId = msg.chat.id;
const tgId = msg.from.id.toString();
const text = msg.text || '';
const username = msg.from.username || msg.from.first_name;

if (text === '/start' || text.startsWith('/start ')) {
const inviteCode = text.split(' ')[1];
db.run('INSERT OR IGNORE INTO users (tg_id, username) VALUES (?, ?)', [tgId, username]);

if (inviteCode && inviteCode !== tgId && config.features.enableInvite) {
db.get('SELECT invited_by FROM users WHERE tg_id = ?', [tgId], (err, user) => {
if (!user || !user.invited_by) {
db.run('UPDATE users SET invited_by = ? WHERE tg_id = ?', [inviteCode, tgId]);
db.run('UPDATE users SET invite_count = invite_count + 1, points = points + ? WHERE tg_id = ?',
[config.invite.inviterPoints, inviteCode]);
}
});
}

getStats((stats) => {
const welcomeText = messages.welcome(stats, formatTimeRemaining());
bot.sendMessage(chatId, welcomeText, {
reply_markup: {
inline_keyboard: [
[{ text: messages.buttons.join, callback_data: 'join' }, { text: messages.buttons.rules, callback_data: 'rules' }],
[{ text: messages.buttons.prizes, callback_data: 'prizes' }, { text: messages.buttons.status, callback_data: 'status' }],
[{ text: messages.buttons.checkin, callback_data: 'checkin' }, { text: messages.buttons.invite, callback_data: 'invite' }]
]
}
});
});
return;
}

if (text === '/status') { showStatus(chatId, tgId); return; }
if (text === '/checkin') { handleCheckin(chatId, tgId); return; }
if (text === '/invite') { showInvite(chatId, tgId); return; }
if (msg.photo) { handlePhoto(chatId, tgId, msg.photo, username); return; }
if (/^[A-Za-z0-9_-]{3,20}$/.test(text) && !text.startsWith('/')) {
handleGameId(chatId, tgId, text);
return;
}
if (isAdmin(msg.from.id)) { handleAdminCommands(chatId, text); }
});
// ========== 回调处理 ==========
bot.on('callback_query', (query) => {
const chatId = query.message.chat.id;
const tgId = query.from.id.toString();
const data = query.data;
bot.answerCallbackQuery(query.id);

switch(data) {
case 'join':
bot.sendMessage(chatId, messages.joinGuide(config.minRecharge), {
reply_markup: { inline_keyboard: [[{ text: messages.buttons.tiers, callback_data: 'tiers' }]] }
});
break;
case 'rules':
bot.sendMessage(chatId, messages.rules(formatTiers(), formatPrizes(), config.drawTime));
break;
case 'prizes':
bot.sendMessage(chatId, `🏆 奖品设置\n\n${formatPrizes()}\n\n💰 奖池总计：¥1,200\n⏰ 每晚 ${config.drawTime} 自动开奖`);
break;
case 'status': showStatus(chatId, tgId); break;
case 'checkin': handleCheckin(chatId, tgId); break;
case 'invite': showInvite(chatId, tgId); break;
case 'tiers': showTiers(chatId); break;
default:
if (data.startsWith('tier_')) selectTier(chatId, tgId, data.replace('tier_', ''));
}
});

function showTiers(chatId) {
bot.sendMessage(chatId, `💰 选择充值档位\n\n${formatTiers()}`, {
reply_markup: {
inline_keyboard: [
[{ text: '🥈 选择白银档', callback_data: 'tier_silver' }],
[{ text: '🥇 选择黄金档', callback_data: 'tier_gold' }],
[{ text: '💎 选择钻石档', callback_data: 'tier_diamond' }]
]
}
});
}

function showStatus(chatId, tgId) {
db.get('SELECT * FROM users WHERE tg_id = ?', [tgId], (err, user) => {
if (!user) {
bot.sendMessage(chatId, messages.errors.notParticipated);
return;
}
db.all('SELECT * FROM numbers WHERE tg_id = ? LIMIT 5', [tgId], (err, numbers) => {
const totalNumbers = numbers ? numbers.length : 0;
const wonNumbers = numbers ? numbers.filter(n => n.is_winner).length : 0;
const totalPrize = numbers ? numbers.reduce((sum, n) => sum + n.prize_amount, 0) : 0;
const numberList = numbers && numbers.length > 0
? numbers.map(n => `${n.is_winner ? '✅' : '⏳'} ${n.lucky_number}${n.prize_amount > 0 ? ' (¥' + n.prize_amount + ')' : ''}`).join('\n')
: '暂无号码';

bot.sendMessage(chatId, messages.userStatus({
gameId: user.game_id, points: user.points, totalNumbers, wonNumbers, totalPrize,
checkinStreak: user.checkin_streak, inviteCount: user.invite_count, numberList,
timeLeft: formatTimeRemaining()
}));
});
});
}
function handleCheckin(chatId, tgId) {
if (!config.features.enableCheckin) {
bot.sendMessage(chatId, '❌ 签到功能暂未开启');
return;
}
const today = new Date().toISOString().split('T')[0];
db.get('SELECT 1 FROM checkins WHERE tg_id = ? AND date = ?', [tgId, today], (err, row) => {
if (row) { bot.sendMessage(chatId, messages.errors.alreadyCheckedIn); return; }
db.get('SELECT checkin_streak, last_checkin FROM users WHERE tg_id = ?', [tgId], (err, user) => {
let streak = 1;
const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
if (user && user.last_checkin === yesterday) streak = (user.checkin_streak || 0) + 1;
let bonus = 0;
if (streak === 3) bonus = 50; else if (streak === 7) bonus = 150;
else if (streak === 14) bonus = 400; else if (streak === 30) bonus = 1000;
const totalPoints = config.checkin.basePoints + bonus;
db.run('INSERT INTO checkins (tg_id, date, points, streak) VALUES (?, ?, ?, ?)', [tgId, today, totalPoints, streak]);
db.run('UPDATE users SET points = points + ?, checkin_streak = ?, last_checkin = ? WHERE tg_id = ?',
[totalPoints, streak, today, tgId]);
bot.sendMessage(chatId, messages.checkinSuccess({ streak, bonus, totalPoints }));
});
});
}

function showInvite(chatId, tgId) {
const inviteLink = `https://t.me/${BOT_USERNAME}?start=${tgId}`;
db.get('SELECT invite_count FROM users WHERE tg_id = ?', [tgId], (err, user) => {
const count = user ? user.invite_count : 0;
bot.sendMessage(chatId, messages.invitePage({
inviteLink, inviteCount: count, inviterPoints: config.invite.inviterPoints,
inviterEntries: config.invite.inviterEntries, inviteePoints: config.invite.inviteePoints,
totalEarned: count * config.invite.inviterPoints
}));
});
}
// ========== 充值处理 ==========
const pendingDeposits = {};

function handlePhoto(chatId, tgId, photo, username) {
  db.get('SELECT * FROM users WHERE tg_id = ?', [tgId], (err, user) => {
    const fileId = photo[photo.length - 1].file_id;
    pendingDeposits[tgId] = { 
      photo: fileId, 
      step: 'select_tier',
      username: username 
    };
    
    // 构建档位按钮
    const tierButtons = Object.values(config.tiers).map(tier => ([{
      text: `${tier.emoji} ${tier.name} ¥${tier.minAmount} (${tier.entries}个号)`,
      callback_data: `tier_${tier.code}`
    }]));
    
    bot.sendMessage(chatId,
`✅ 截图已收到！

请选择充值档位：`, {
      reply_markup: { inline_keyboard: tierButtons }
    });
  });
}

function selectTier(chatId, tgId, tierCode) {
  if (!pendingDeposits[tgId]) return;
  
  const tier = config.tiers[tierCode];
  if (!tier) return;
  
  pendingDeposits[tgId].tier = tierCode;
  pendingDeposits[tgId].entries = tier.entries;
  pendingDeposits[tgId].step = 'enter_gameid';
  
  let msg = `🎯 您选择了：${tier.emoji} ${tier.name}\n\n`;
  msg += `💰 金额：¥${tier.minAmount}\n`;
  msg += `🎫 获得号码：${tier.entries}个\n`;
  if (tier.bonusPoints > 0) msg += `💎 额外赠送：${tier.bonusPoints}积分\n`;
  msg += `\n📝 请输入您的游戏ID：\n（例如：Player123 或 ID:888888）\n\n⚠️ 请确保ID正确，奖励将发放到此账户！`;
  
  bot.sendMessage(chatId, msg);
}
function handleGameId(chatId, tgId, gameId) {
  if (!pendingDeposits[tgId] || pendingDeposits[tgId].step !== 'enter_gameid') {
    return;
  }
  
  const deposit = pendingDeposits[tgId];
  const tier = config.tiers[deposit.tier];
  
  // 更新用户信息
  db.run('UPDATE users SET game_id = ?, total_deposit = total_deposit + ? WHERE tg_id = ?',
    [gameId, tier.minAmount, tgId]);
  
  // 增加积分
  if (tier.bonusPoints > 0) {
    db.run('UPDATE users SET points = points + ? WHERE tg_id = ?', [tier.bonusPoints, tgId]);
  }
  
  // 生成幸运号码
  generateLuckyNumbers(tier.entries, (numbers) => {
    const numbersText = numbers.join(', ');
    
    // 保存号码
    numbers.forEach(num => {
      db.run('INSERT INTO numbers (lucky_number, tg_id, game_id, tier) VALUES (?, ?, ?, ?)',
        [num, tgId, gameId, deposit.tier]);
    });
    
    delete pendingDeposits[tgId];
    
    // 发送成功消息
    bot.sendMessage(chatId, messages.participateSuccess({
      gameId, tierEmoji: tier.emoji, tierName: tier.name, 
      numbers: numbersText, bonusPoints: tier.bonusPoints,
      drawTime: config.drawTime
    }), {
      reply_markup: {
        inline_keyboard: [
          [{ text: messages.buttons.invite, callback_data: 'invite' }],
          [{ text: messages.buttons.checkin, callback_data: 'checkin' }]
        ]
      }
    });
    
    // 通知管理员
    if (config.features.adminNotifications) {
      ADMIN_IDS.forEach(adminId => {
        bot.sendMessage(adminId, 
`📢 新用户参与
👤 @${deposit.username || 'N/A'} (${tgId})
🎮 游戏ID：${gameId}
🎯 档位：${tier.name}
🍀 号码：${numbersText}
💰 金额：¥${tier.minAmount}`);
      });
    }
  });
}
// ========== 管理员命令 ==========
function handleAdminCommands(chatId, text) {
  // /draw - 执行抽奖
  if (text === '/draw') {
    performDraw(chatId);
    return;
  }
  
  // /list - 查看参与者
  if (text === '/list') {
    db.all('SELECT lucky_number, game_id, tier FROM numbers ORDER BY created_at DESC LIMIT 20', 
      [], (err, rows) => {
      if (!rows || rows.length === 0) {
        bot.sendMessage(chatId, '暂无参与者');
        return;
      }
      const list = rows.map(r => {
        const emoji = config.tiers[r.tier]?.emoji || '❓';
        return `${emoji} ${r.lucky_number} | ${r.game_id}`;
      }).join('\n');
      bot.sendMessage(chatId, `📋 最近20位参与者：\n\n${list}`);
    });
    return;
  }
  
  // /stats - 统计
  if (text === '/stats') {
getStats((stats) => {
      db.get('SELECT COUNT(*) as c FROM numbers WHERE is_winner = 1', [], (e, w) => {
        const winners = w ? w.c : 0;
        const winRate = stats.numbers > 0 ? ((winners / stats.numbers) * 100).toFixed(1) : 0;
        bot.sendMessage(chatId,
`📊 活动统计

👥 总用户：${stats.users}人
🎫 总号码：${stats.numbers}个
🏆 中奖数：${winners}个
📈 中奖率：${winRate}%
💰 总奖池：¥${stats.totalPrizes}`);
      });
    });
    return;
  }
  
  // /broadcast - 群发
  if (text.startsWith('/broadcast ')) {
    const message = text.replace('/broadcast ', '');
    db.all('SELECT tg_id FROM users', [], (err, users) => {
      if (!users || users.length === 0) {
        bot.sendMessage(chatId, '❌ 没有用户可发送');
        return;
      }
      let successCount = 0;
      let failCount = 0;
      users.forEach(user => {
        bot.sendMessage(user.tg_id, `📢 公告\n\n${message}`)
          .then(() => successCount++)
          .catch(() => failCount++);
      });
      setTimeout(() => {
        bot.sendMessage(chatId, `✅ 群发完成\n成功：${successCount}人\n失败：${failCount}人`);
      }, 3000);
    });
    return;
  }
}
// ========== 抽奖函数 ==========
function performDraw(chatId) {
  db.all('SELECT * FROM numbers WHERE is_winner = 0', [], (err, numbers) => {
    if (!numbers || numbers.length === 0) {
      bot.sendMessage(chatId, '❌ 没有可抽奖的号码');
      return;
    }
    
    // 随机抽取5个
    const shuffled = numbers.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, Math.min(config.prizes.length, shuffled.length));
    const today = new Date().toISOString().split('T')[0];
    
    let resultText = `🎰 ${today} 开奖结果\n\n🏆 中奖号码：\n\n`;
    
    // 保存开奖记录
    db.run('INSERT INTO draws (draw_date, total_participants, total_prize_pool) VALUES (?, ?, ?)',
      [today, numbers.length, 1200]);
    
    db.get('SELECT id FROM draws WHERE draw_date = ? ORDER BY id DESC LIMIT 1', [today], (err, draw) => {
      const drawId = draw ? draw.id : 0;
      
      winners.forEach((winner, index) => {
        const prize = config.prizes[index];
        const prizeAmount = prize.amount;
        
        // 更新中奖状态
        db.run('UPDATE numbers SET is_winner = 1, prize_amount = ? WHERE lucky_number = ?', 
          [prizeAmount, winner.lucky_number]);
        
        // 记录中奖
        db.run('INSERT INTO winners (draw_id, lucky_number, tg_id, game_id, prize_rank, prize_amount) VALUES (?, ?, ?, ?, ?, ?)',
          [drawId, winner.lucky_number, winner.tg_id, winner.game_id, prize.rank, prizeAmount]);
        
        resultText += `${index + 1}. 🍀 ${winner.lucky_number} - 🎮 ${winner.game_id} - 💰 ¥${prizeAmount}\n`;
        
        // 通知中奖者
        bot.sendMessage(winner.tg_id, messages.winNotification({
          prizeName: prize.name,
          amount: prizeAmount,
          number: winner.lucky_number,
          gameId: winner.game_id,
          date: `${today} ${config.drawTime}`
        })).catch(() => {});
      });
      
      resultText += `\n📊 本期参与：${numbers.length}人\n⏰ 下期抽奖：明日${config.drawTime}`;
      bot.sendMessage(chatId, resultText);
      
      // 群发公告
      db.all('SELECT tg_id FROM users', [], (err, users) => {
        users.forEach(user => {
          bot.sendMessage(user.tg_id, 
`📢 开奖公告

${today}期抽奖已结束！
🏆 恭喜${winners.length}位幸运儿！

点击查看完整结果：@${BOT_USERNAME}`).catch(() => {});
        });
      });
    });
  });
}

console.log('🎰 全功能抽奖Bot已启动！');
console.log('📱 Bot用户名：', BOT_USERNAME);
console.log('👮 管理员：', ADMIN_IDS);

