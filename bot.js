/**
 * bot.js - 全功能抽奖Bot（带审核流程）
 * 作者：OpenClaw
 * 版本：2.1.0
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

// 初始化数据库
function initDatabase() {
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
    db.run(`CREATE TABLE IF NOT EXISTS draws (
      id INTEGER PRIMARY KEY, draw_date TEXT, total_participants INTEGER, total_prize_pool INTEGER
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS winners (
      id INTEGER PRIMARY KEY, draw_id INTEGER, lucky_number INTEGER, tg_id TEXT,
      game_id TEXT, prize_rank INTEGER, prize_amount INTEGER
    )`);
    // 审核记录表（新增）
    db.run(`CREATE TABLE IF NOT EXISTS pending_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id TEXT, username TEXT, game_id TEXT, amount INTEGER, tier TEXT,
      screenshot_file_id TEXT, status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}
initDatabase();

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
// ========== 消息命令处理 ==========
bot.on('message', (msg) => {
const chatId = msg.chat.id;
const tgId = msg.from.id.toString();
const text = msg.text || '';
const username = msg.from.username || msg.from.first_name;

// /start 命令
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

// 其他命令
if (text === '/status') { showStatus(chatId, tgId); return; }
if (text === '/checkin') { handleCheckin(chatId, tgId); return; }
if (text === '/invite') { showInvite(chatId, tgId); return; }
if (text === '/rules') {
bot.sendMessage(chatId, messages.rules(formatTiers(), formatPrizes(), config.drawTime));
return;
}
if (text === '/help') {
bot.sendMessage(chatId,
`📚 帮助中心

🎮 参与流程：
1. 充值最低¥${config.minRecharge}
2. 发送截图给Bot
3. 获得幸运号码
4. 每晚${config.drawTime}开奖

常用命令：
/start - 开始参与
/status - 查看账户
/checkin - 每日签到
/invite - 邀请好友
/rules - 活动规则

遇到问题？联系管理员！`);
return;
}

// 处理图片（充值截图）
if (msg.photo) { handlePhoto(chatId, tgId, msg.photo, username); return; }

// 处理金额输入（1-4位数字）
if (/^\d{1,4}$/.test(text) && !text.startsWith('/')) {
handleAmountInput(chatId, tgId, parseInt(text));
return;
}

// 处理游戏ID（7位纯数字）
if (/^\d{7}$/.test(text)) {
handleGameIdSubmit(chatId, tgId, text);
return;
}

// 错误提示：输入了数字但不是7位
if (/^\d+$/.test(text) && text.length !== 7 && !text.startsWith('/')) {
bot.sendMessage(chatId, '❌ 游戏ID必须为7位纯数字（如：1234567）');
return;
}

// 管理员命令
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
// 处理档位选择
if (data.startsWith('review_tier_')) {
const parts = data.split('_');
const tierCode = parts[2];
const reviewId = parts[3];

db.get('SELECT * FROM pending_reviews WHERE id = ?', [reviewId], (err, review) => {
if (!review) return;
const tier = config.tiers[tierCode];
db.run('UPDATE pending_reviews SET tier = ?, status = ? WHERE id = ?',
[tierCode, 'awaiting_id', reviewId]);
bot.sendMessage(chatId,
`🎯 已选择：${tier.emoji} ${tier.name}

📝 请输入7位游戏ID（纯数字）：
（格式：1234567）

⚠️ ID必须为7位数字，中奖后无法更改！`);
});
return;
}

// 处理管理员通过审核
if (data.startsWith('approve_')) {
const reviewId = data.split('_')[1];
db.get('SELECT * FROM pending_reviews WHERE id = ?', [reviewId], (err, review) => {
if (!review || review.status !== 'pending_review') return;
const tier = config.tiers[review.tier];
generateLuckyNumbers(tier.entries, (numbers) => {
numbers.forEach(num => {
db.run('INSERT INTO numbers (lucky_number, tg_id, game_id, tier) VALUES (?, ?, ?, ?)',
[num, review.tg_id, review.game_id, review.tier]);
});
db.run('UPDATE pending_reviews SET status = ? WHERE id = ?', ['approved', reviewId]);
db.run('UPDATE users SET game_id = ?, total_deposit = total_deposit + ? WHERE tg_id = ?',
[review.game_id, review.amount, review.tg_id]);
if (tier.bonusPoints > 0) {
db.run('UPDATE users SET points = points + ? WHERE tg_id = ?', [tier.bonusPoints, review.tg_id]);
}
bot.sendMessage(review.tg_id,
`🎉 审核通过！参与成功！

🎮 游戏ID：${review.game_id}
🎯 档位：${tier.emoji} ${tier.name}
🍀 幸运号码：${numbers.join(', ')}
${tier.bonusPoints > 0 ? `💎 赠送积分：+${tier.bonusPoints}` : ''}

⏰ 每晚8点开奖！`);
bot.answerCallbackQuery(query.id, { text: '✅ 已通过并发放' });
bot.editMessageText(`✅ 已处理 - 通过并发放\n\n👤 ${review.username}\n🎮 ${review.game_id}\n🍀 ${numbers.join(', ')}`,
{ chat_id: chatId, message_id: query.message.message_id });
});
});
return;
}

// 处理管理员拒绝
if (data.startsWith('reject_')) {
const reviewId = data.split('_')[1];
db.run('UPDATE pending_reviews SET status = ? WHERE id = ?', ['rejected', reviewId]);
db.get('SELECT tg_id FROM pending_reviews WHERE id = ?', [reviewId], (err, review) => {
if (review) {
bot.sendMessage(review.tg_id,
`❌ 审核未通过

可能原因：
• 截图不清晰或无法验证
• 充值金额与输入不符
• 其他违规操作

请联系管理员了解详情。`);
}
bot.answerCallbackQuery(query.id, { text: '❌ 已拒绝' });
bot.editMessageText('❌ 已拒绝该申请',
{ chat_id: chatId, message_id: query.message.message_id });
});
return;
}
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
db.get(
'SELECT * FROM pending_reviews WHERE tg_id = ? AND status != ? AND status != ? ORDER BY id DESC LIMIT 1',
[tgId, 'approved', 'rejected'],
(err, pendingReview) => {
if (pendingReview) {
const tier = pendingReview.tier ? config.tiers[pendingReview.tier] : null;
let statusText = '';
switch(pendingReview.status) {
case 'awaiting_amount': statusText = '等待输入金额'; break;
case 'awaiting_tier': statusText = '等待选择档位'; break;
case 'awaiting_id': statusText = '等待输入游戏ID'; break;
case 'pending_review': statusText = '⏳ 审核中，请耐心等待...'; break;
}
let msg = `📊 我的账户\n\n🔔 当前状态：${statusText}\n`;
if (pendingReview.amount) msg += `💰 充值金额：¥${pendingReview.amount}\n`;
if (tier) {
msg += `🎯 选择档位：${tier.emoji} ${tier.name}\n`;
msg += `🎫 预计获得：${tier.entries}个号码\n`;
}
if (pendingReview.game_id) msg += `🎮 游戏ID：${pendingReview.game_id}\n`;
msg += `\n⏳ 管理员审核通过后将自动发放号码`;
bot.sendMessage(chatId, msg);
return;
}

db.get('SELECT * FROM users WHERE tg_id = ?', [tgId], (err, user) => {
if (!user || !user.game_id) {
bot.sendMessage(chatId, '❌ 您还未参与活动\n\n点击 🎮 立即参与 开始！', {
reply_markup: { inline_keyboard: [[{ text: '🎮 立即参与', callback_data: 'join' }]] }
});
return;
}
db.all('SELECT * FROM numbers WHERE tg_id = ? ORDER BY created_at DESC LIMIT 5', [tgId], (err, numbers) => {
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
);
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
function handlePhoto(chatId, tgId, photo, username) {
const fileId = photo[photo.length - 1].file_id;
db.run(
'INSERT INTO pending_reviews (tg_id, username, screenshot_file_id, status) VALUES (?, ?, ?, ?)',
[tgId, username, fileId, 'awaiting_amount'],
(err) => {
if (err) {
bot.sendMessage(chatId, '❌ 上传失败，请重试');
return;
}
bot.sendMessage(chatId,
`✅ 截图已收到！

📝 请输入充值金额（数字）：
（例如：500）

⚠️ 输入金额将决定可选档位`);
}
);
}

function handleAmountInput(chatId, tgId, amount) {
db.get(
'SELECT * FROM pending_reviews WHERE tg_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
[tgId, 'awaiting_amount'],
(err, review) => {
if (!review) return;
db.run('UPDATE pending_reviews SET amount = ?, status = ? WHERE id = ?',
[amount, 'awaiting_tier', review.id]);
let tierButtons = [];
let tierText = '';
Object.values(config.tiers).forEach(tier => {
if (amount >= tier.minAmount) {
tierButtons.push([{
text: `${tier.emoji} ${tier.name} (${tier.entries}个号)`,
callback_data: `review_tier_${tier.code}_${review.id}`
}]);
tierText += `${tier.emoji} ${tier.name} ✓ 可参与\n`;
} else {
tierText += `${tier.emoji} ${tier.name} ❌ 差¥${tier.minAmount - amount}\n`;
}
});
if (tierButtons.length === 0) {
bot.sendMessage(chatId,
`❌ 充值金额不足最低档位（¥${config.minRecharge}）

💰 当前：¥${amount}
📉 差额：¥${config.minRecharge - amount}

请重新充值后再参与！`);
db.run('DELETE FROM pending_reviews WHERE id = ?', [review.id]);
return;
}
bot.sendMessage(chatId,
`💰 充值金额：¥${amount}

📋 可选档位：
${tierText}

👇 请选择要参与的档位：`, { reply_markup: { inline_keyboard: tierButtons } });
}
);
}

function handleGameIdSubmit(chatId, tgId, gameId) {
db.get(
'SELECT * FROM pending_reviews WHERE tg_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
[tgId, 'awaiting_id'],
(err, review) => {
if (!review) return;
const tier = config.tiers[review.tier];
db.run('UPDATE pending_reviews SET game_id = ?, status = ? WHERE id = ?',
[gameId, 'pending_review', review.id]);
bot.sendMessage(chatId,
`✅ 提交成功！等待审核...

📋 审核信息：
• 游戏ID：${gameId}
• 充值金额：¥${review.amount}
• 选择档位：${tier.emoji} ${tier.name}
• 预计获得：${tier.entries}个号码

⏰ 管理员审核后将自动发放
📢 请耐心等待...`);
if (config.features.adminNotifications) {
ADMIN_IDS.forEach(adminId => {
bot.sendMessage(adminId,
`📢 新用户待审核

👤 @${review.username || 'N/A'} (${tgId})
🎮 游戏ID：${gameId}
💰 充值金额：¥${review.amount}
🎯 申请档位：${tier.name}
🍀 应发号码：${tier.entries}个
📷 截图已保存`, {
reply_markup: {
inline_keyboard: [[
{ text: '✅ 通过并发放', callback_data: `approve_${review.id}` },
{ text: '❌ 拒绝', callback_data: `reject_${review.id}` }
]]
}
});
});
}
}
);
}
function handleAdminCommands(chatId, text) {
if (text === '/draw') { performDraw(chatId); return; }
if (text === '/list') {
db.all('SELECT lucky_number, game_id, tier FROM numbers ORDER BY created_at DESC LIMIT 20', [], (err, rows) => {
if (!rows || rows.length === 0) { bot.sendMessage(chatId, '暂无参与者'); return; }
const list = rows.map(r => {
const emoji = config.tiers[r.tier]?.emoji || '❓';
return `${emoji} ${r.lucky_number} | ${r.game_id}`;
}).join('\n');
bot.sendMessage(chatId, `📋 最近20位参与者：\n\n${list}`);
});
return;
}
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
if (text.startsWith('/broadcast ')) {
const message = text.replace('/broadcast ', '');
db.all('SELECT tg_id FROM users', [], (err, users) => {
if (!users || users.length === 0) { bot.sendMessage(chatId, '❌ 没有用户可发送'); return; }
let successCount = 0, failCount = 0;
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

function performDraw(chatId) {
db.all('SELECT * FROM numbers WHERE is_winner = 0', [], (err, numbers) => {
if (!numbers || numbers.length === 0) { bot.sendMessage(chatId, '❌ 没有可抽奖的号码'); return; }
const shuffled = numbers.sort(() => 0.5 - Math.random());
const winners = shuffled.slice(0, Math.min(config.prizes.length, shuffled.length));
const today = new Date().toISOString().split('T')[0];
let resultText = `🎰 ${today} 开奖结果\n\n🏆 中奖号码：\n\n`;
db.run('INSERT INTO draws (draw_date, total_participants, total_prize_pool) VALUES (?, ?, ?)',
[today, numbers.length, 1200]);
db.get('SELECT id FROM draws WHERE draw_date = ? ORDER BY id DESC LIMIT 1', [today], (err, draw) => {
const drawId = draw ? draw.id : 0;
winners.forEach((winner, index) => {
const prize = config.prizes[index];
db.run('UPDATE numbers SET is_winner = 1, prize_amount = ? WHERE lucky_number = ?',
[prize.amount, winner.lucky_number]);
db.run('INSERT INTO winners (draw_id, lucky_number, tg_id, game_id, prize_rank, prize_amount) VALUES (?, ?, ?, ?, ?, ?)',
[drawId, winner.lucky_number, winner.tg_id, winner.game_id, prize.rank, prize.amount]);
resultText += `${index + 1}. 🍀 ${winner.lucky_number} - 🎮 ${winner.game_id} - 💰 ¥${prize.amount}\n`;
bot.sendMessage(winner.tg_id, messages.winNotification({
prizeName: prize.name, amount: prize.amount, number: winner.lucky_number,
gameId: winner.game_id, date: `${today} ${config.drawTime}`
})).catch(() => {});
});
resultText += `\n📊 本期参与：${numbers.length}人\n⏰ 下期抽奖：明日${config.drawTime}`;
bot.sendMessage(chatId, resultText);
});
});
}

console.log('🎰 全功能抽奖Bot已启动！');
console.log('📱 Bot用户名：', BOT_USERNAME);
console.log('👮 管理员：', ADMIN_IDS);
