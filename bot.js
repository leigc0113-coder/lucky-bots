/**
 * bot.js - 全功能抽奖Bot（审核版）
 * 版本：3.0.0
 * 特性：多档位充值、人工审核、7位ID、无限制参与
 */

// ==================== 引入依赖 ====================
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const config = require('./config');
const messages = require('./messages');

// ==================== 环境变量 ====================
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(function(id) { return id; });
const BOT_USERNAME = process.env.BOT_USERNAME || config.botUsername;

// ==================== 初始化Bot和数据库 ====================
const bot = new TelegramBot(TOKEN, { polling: true });
const db = new sqlite3.Database('./lottery.db');

// ==================== 数据库表创建 ====================
function initDatabase() {
  db.serialize(function() {
    // 用户表：存储用户基本信息
    db.run('CREATE TABLE IF NOT EXISTS users (' +
      'tg_id TEXT PRIMARY KEY, username TEXT, game_id TEXT, ' +
      'points INTEGER DEFAULT 0, total_deposit INTEGER DEFAULT 0, ' +
      'invite_count INTEGER DEFAULT 0, invited_by TEXT, ' +
      'checkin_streak INTEGER DEFAULT 0, last_checkin TEXT' +
    ')');
    
    // 号码表：存储已发放的幸运号码
    db.run('CREATE TABLE IF NOT EXISTS numbers (' +
      'lucky_number INTEGER PRIMARY KEY, tg_id TEXT, game_id TEXT, ' +
      'tier TEXT, is_winner INTEGER DEFAULT 0, prize_amount INTEGER DEFAULT 0' +
    ')');
    
    // 签到表：存储每日签到记录
    db.run('CREATE TABLE IF NOT EXISTS checkins (' +
      'id INTEGER PRIMARY KEY, tg_id TEXT, date TEXT, points INTEGER, streak INTEGER' +
    ')');
    
    // 开奖记录表
    db.run('CREATE TABLE IF NOT EXISTS draws (' +
      'id INTEGER PRIMARY KEY, draw_date TEXT, total_participants INTEGER, total_prize_pool INTEGER' +
    ')');
    
    // 审核表：存储待审核的参与申请（新增）
    db.run('CREATE TABLE IF NOT EXISTS pending_reviews (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'tg_id TEXT, username TEXT, game_id TEXT, amount INTEGER, tier TEXT, ' +
      'screenshot_file_id TEXT, status TEXT DEFAULT "pending", ' +
      'created_at TEXT DEFAULT CURRENT_TIMESTAMP' +
    ')');
  });
}
initDatabase();

// ==================== 工具函数 ====================
// 检查是否是管理员
function isAdmin(id) {
  return ADMIN_IDS.indexOf(id.toString()) !== -1;
}

// 生成不重复的幸运号码
function generateLuckyNumbers(count, callback, numbers) {
  if (!numbers) numbers = [];
  if (numbers.length >= count) {
    callback(numbers);
    return;
  }
  var num = Math.floor(100000 + Math.random() * 900000);
  db.get('SELECT 1 FROM numbers WHERE lucky_number = ?', [num], function(err, row) {
    if (!row && numbers.indexOf(num) === -1) {
      numbers.push(num);
    }
    generateLuckyNumbers(count, callback, numbers);
  });
}

// 获取统计数据
function getStats(callback) {
  db.get('SELECT COUNT(*) as c FROM users', [], function(e, u) {
    db.get('SELECT COUNT(*) as c FROM numbers', [], function(e, n) {
      db.get('SELECT SUM(prize_amount) as s FROM numbers WHERE is_winner = 1', [], function(e, p) {
        callback({
          users: u ? u.c : 0,
          numbers: n ? n.c : 0,
          totalPrizes: p && p.s ? p.s : 0
        });
      });
    });
  });
}

// 格式化剩余时间
function formatTimeRemaining() {
  var now = new Date();
  var target = new Date();
  target.setHours(20, 0, 0, 0);
  if (now > target) target.setDate(target.getDate() + 1);
  var diff = target - now;
  var h = Math.floor(diff / (1000 * 60 * 60));
  var m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return h + '小时' + m + '分';
}

// 格式化档位说明
function formatTiers() {
  var result = '';
  Object.values(config.tiers).forEach(function(tier) {
    result += tier.emoji + ' ' + tier.name + ' ¥' + tier.minAmount + '\n';
    result += '   → ' + tier.entries + '个幸运号码\n';
    if (tier.bonusPoints > 0) result += '   → 额外送' + tier.bonusPoints + '积分\n';
    result += '\n';
  });
  return result;
}

// 格式化奖品说明
function formatPrizes() {
  var result = '';
config.prizes.forEach(function(prize) {
    var emoji = prize.rank === 1 ? '🥇' : prize.rank === 2 ? '🥈' : prize.rank === 3 ? '🥉' : '🎖️';
    result += emoji + ' ' + prize.name + '：¥' + prize.amount + ' × ' + prize.count + '\n';
  });
  return result;
}

// ==================== 消息命令处理 ====================
// 处理所有用户发送的消息
bot.on('message', function(msg) {
var chatId = msg.chat.id;
var tgId = msg.from.id.toString();
var text = msg.text || '';
var username = msg.from.username || msg.from.first_name;

// ---------- /start 命令：欢迎和初始化 ----------
if (text === '/start' || text.startsWith('/start ')) {
var inviteCode = text.split(' ')[1];

// 创建用户记录（如果不存在）
db.run('INSERT OR IGNORE INTO users (tg_id, username) VALUES (?, ?)', [tgId, username]);

// 处理邀请关系
if (inviteCode && inviteCode !== tgId && config.features.enableInvite) {
db.get('SELECT invited_by FROM users WHERE tg_id = ?', [tgId], function(err, user) {
if (!user || !user.invited_by) {
db.run('UPDATE users SET invited_by = ? WHERE tg_id = ?', [inviteCode, tgId]);
db.run('UPDATE users SET invite_count = invite_count + 1, points = points + ? WHERE tg_id = ?',
[config.invite.inviterPoints, inviteCode]);
}
});
}

// 发送欢迎消息
getStats(function(stats) {
var welcomeText = messages.welcome(stats, formatTimeRemaining());
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

// ---------- /status 命令：查看账户状态 ----------
if (text === '/status') {
showStatus(chatId, tgId);
return;
}

// ---------- /checkin 命令：每日签到 ----------
if (text === '/checkin') {
handleCheckin(chatId, tgId);
return;
}

// ---------- /invite 命令：邀请好友 ----------
if (text === '/invite') {
showInvite(chatId, tgId);
return;
}

// ---------- /rules 命令：活动规则 ----------
if (text === '/rules') {
bot.sendMessage(chatId, messages.rules(formatTiers(), formatPrizes(), config.drawTime));
return;
}

// ---------- /help 命令：帮助中心 ----------
if (text === '/help') {
var helpMsg = '📚 帮助中心\n\n';
helpMsg += '🎮 参与流程：\n';
helpMsg += '1. 充值最低¥' + config.minRecharge + '\n';
helpMsg += '2. 发送截图给Bot\n';
helpMsg += '3. 获得幸运号码\n';
helpMsg += '4. 每晚' + config.drawTime + '开奖\n\n';
helpMsg += '常用命令：\n';
helpMsg += '/start - 开始参与\n';
helpMsg += '/status - 查看账户\n';
helpMsg += '/checkin - 每日签到\n';
helpMsg += '/invite - 邀请好友\n';
helpMsg += '/rules - 活动规则\n\n';
helpMsg += '遇到问题？联系管理员！';
bot.sendMessage(chatId, helpMsg);
return;
}

// ---------- 处理图片：充值截图 ----------
if (msg.photo) {
handlePhoto(chatId, tgId, msg.photo, username);
return;
}

// ---------- 处理金额输入（1-5位数字，支持到99999） ----------
if (/^\d{1,5}$/.test(text) && !text.startsWith('/')) {
var amount = parseInt(text);
if (amount >= 100) {
handleAmountInput(chatId, tgId, amount);
} else {
bot.sendMessage(chatId, '❌ 充值金额不能低于¥100');
}
return;
}

// ---------- 处理游戏ID（7位纯数字） ----------
if (/^\d{7}$/.test(text)) {
handleGameIdSubmit(chatId, tgId, text);
return;
}

// ---------- 错误提示：输入了数字但不是7位 ----------
if (/^\d+$/.test(text) && text.length !== 7 && !text.startsWith('/')) {
bot.sendMessage(chatId, '❌ 游戏ID必须为7位纯数字（如：1234567）');
return;
}

// ---------- 管理员命令 ----------
if (isAdmin(msg.from.id)) {
handleAdminCommands(chatId, text);
}
});
// ==================== 回调处理（按钮点击） ====================
bot.on('callback_query', function(query) {
var chatId = query.message.chat.id;
var tgId = query.from.id.toString();
var data = query.data;

// 回答回调，去掉按钮loading状态
bot.answerCallbackQuery(query.id);

// ---------- 主菜单按钮 ----------
switch(data) {
case 'join':
var joinMsg = messages.joinGuide(config.minRecharge);
bot.sendMessage(chatId, joinMsg, {
reply_markup: { inline_keyboard: [[{ text: messages.buttons.tiers, callback_data: 'tiers' }]] }
});
break;

case 'rules':
bot.sendMessage(chatId, messages.rules(formatTiers(), formatPrizes(), config.drawTime));
break;

case 'prizes':
var prizeMsg = '🏆 奖品设置\n\n' + formatPrizes() + '\n💰 奖池总计：¥1,200\n⏰ 每晚 ' + config.drawTime + ' 自动开奖';
bot.sendMessage(chatId, prizeMsg);
break;

case 'status':
showStatus(chatId, tgId);
break;

case 'checkin':
handleCheckin(chatId, tgId);
break;

case 'invite':
showInvite(chatId, tgId);
break;

case 'tiers':
showTiers(chatId);
break;

default:
// 处理档位选择（审核流程）
if (data.startsWith('review_tier_')) {
var parts = data.split('_');
var tierCode = parts[2];
var reviewId = parts[3];

db.get('SELECT * FROM pending_reviews WHERE id = ?', [reviewId], function(err, review) {
if (!review) return;
var tier = config.tiers[tierCode];

// 更新审核状态为等待输入ID
db.run('UPDATE pending_reviews SET tier = ?, status = ? WHERE id = ?',
[tierCode, 'awaiting_id', reviewId]);

var msg = '🎯 已选择：' + tier.emoji + ' ' + tier.name + '\n\n';
msg += '📝 请输入7位游戏ID（纯数字）：\n';
msg += '（格式：1234567）\n\n';
msg += '⚠️ ID必须为7位数字，中奖后无法更改！';
bot.sendMessage(chatId, msg);
});
return;
}

// 处理管理员通过审核
if (data.startsWith('approve_')) {
var reviewId = data.split('_')[1];

db.get('SELECT * FROM pending_reviews WHERE id = ?', [reviewId], function(err, review) {
if (!review || review.status !== 'pending_review') return;
var tier = config.tiers[review.tier];

// 生成幸运号码
generateLuckyNumbers(tier.entries, function(numbers) {
// 保存号码到数据库
numbers.forEach(function(num) {
db.run('INSERT INTO numbers (lucky_number, tg_id, game_id, tier) VALUES (?, ?, ?, ?)',
[num, review.tg_id, review.game_id, review.tier]);
});

// 更新审核状态为已通过
db.run('UPDATE pending_reviews SET status = ? WHERE id = ?', ['approved', reviewId]);

// 更新用户信息
db.run('UPDATE users SET game_id = ?, total_deposit = total_deposit + ? WHERE tg_id = ?',
[review.game_id, review.amount, review.tg_id]);

// 赠送积分
if (tier.bonusPoints > 0) {
db.run('UPDATE users SET points = points + ? WHERE tg_id = ?', [tier.bonusPoints, review.tg_id]);
}

// 通知用户审核通过
var userMsg = '🎉 审核通过！参与成功！\n\n';
userMsg += '🎮 游戏ID：' + review.game_id + '\n';
userMsg += '🎯 档位：' + tier.emoji + ' ' + tier.name + '\n';
userMsg += '🍀 幸运号码：' + numbers.join(', ') + '\n';
if (tier.bonusPoints > 0) userMsg += '💎 赠送积分：+' + tier.bonusPoints + '\n';
userMsg += '\n⏰ 每晚8点开奖！';
bot.sendMessage(review.tg_id, userMsg);

// 通知其他管理员
var adminMsg = '📢 新用户参与（已审核通过）\n\n';
adminMsg += '👤 @' + (review.username || 'N/A') + ' (' + review.tg_id + ')\n';
adminMsg += '🎮 游戏ID：' + review.game_id + '\n';
adminMsg += '🎯 档位：' + tier.name + '\n';
adminMsg += '🍀 号码：' + numbers.join(', ') + '\n';
adminMsg += '💰 金额：¥' + review.amount;

ADMIN_IDS.forEach(function(adminId) {
if (adminId !== tgId) {
bot.sendMessage(adminId, adminMsg);
}
});

// 更新原消息
bot.editMessageText('✅ 已通过并发放\n\n👤 ' + review.username + '\n🎮 ' + review.game_id + '\n🍀 ' + numbers.length + '个号码',
{ chat_id: chatId, message_id: query.message.message_id });
});
});
return;
}

// 处理管理员拒绝
if (data.startsWith('reject_')) {
var reviewId = data.split('_')[1];

db.run('UPDATE pending_reviews SET status = ? WHERE id = ?', ['rejected', reviewId]);

db.get('SELECT tg_id, username FROM pending_reviews WHERE id = ?', [reviewId], function(err, review) {
if (review) {
var rejectMsg = '❌ 审核未通过\n\n';
rejectMsg += '可能原因：\n';
rejectMsg += '• 截图不清晰或无法验证\n';
rejectMsg += '• 充值金额与输入不符\n';
rejectMsg += '• 其他违规操作\n\n';
rejectMsg += '请联系管理员了解详情。';
bot.sendMessage(review.tg_id, rejectMsg);
}

bot.editMessageText('❌ 已拒绝该申请',
{ chat_id: chatId, message_id});
return;
}
}
});
// ==================== 显示函数 ====================

// 显示档位选择菜单
function showTiers(chatId) {
var keyboard = [];
Object.values(config.tiers).forEach(function(tier) {
keyboard.push([{
text: tier.emoji + ' ' + tier.name + ' ¥' + tier.minAmount + ' (' + tier.entries + '个号)',
callback_data: 'tier_' + tier.code
}]);
});

bot.sendMessage(chatId, '💰 选择充值档位\n\n' + formatTiers(), {
reply_markup: { inline_keyboard: keyboard }
});
}

// 显示用户状态（关键函数：支持审核中和已参与状态）
function showStatus(chatId, tgId) {
// 先检查是否有待审核的记录
db.get(
'SELECT * FROM pending_reviews WHERE tg_id = ? AND status != ? AND status != ? ORDER BY id DESC LIMIT 1',
[tgId, 'approved', 'rejected'],
function(err, pendingReview) {

if (pendingReview) {
// 有审核中的记录，显示审核状态
var tier = pendingReview.tier ? config.tiers[pendingReview.tier] : null;
var statusText = '';

if (pendingReview.status === 'awaiting_amount') statusText = '等待输入金额';
else if (pendingReview.status === 'awaiting_tier') statusText = '等待选择档位';
else if (pendingReview.status === 'awaiting_id') statusText = '等待输入游戏ID';
else if (pendingReview.status === 'pending_review') statusText = '⏳ 审核中，请耐心等待...';

var msg = '📊 我的账户\n\n';
msg += '🔔 当前状态：' + statusText + '\n';

if (pendingReview.amount) msg += '💰 充值金额：¥' + pendingReview.amount + '\n';
if (tier) {
msg += '🎯 选择档位：' + tier.emoji + ' ' + tier.name + '\n';
msg += '🎫 预计获得：' + tier.entries + '个号码\n';
}
if (pendingReview.game_id) msg += '🎮 游戏ID：' + pendingReview.game_id + '\n';

msg += '\n⏳ 管理员审核通过后将自动发放号码';

bot.sendMessage(chatId, msg);
return;
}

// 没有审核记录，查已持有的号码
db.all('SELECT * FROM numbers WHERE tg_id = ? ORDER BY created_at DESC', [tgId], function(err, numbers) {
if (!numbers || numbers.length === 0) {
bot.sendMessage(chatId, '❌ 您还未参与活动\n\n点击 🎮 立即参与 开始！', {
reply_markup: { inline_keyboard: [[{ text: '🎮 立即参与', callback_data: 'join' }]] }
});
return;
}

// 计算统计数据
var totalNumbers = numbers.length;
var wonNumbers = 0;
var totalPrize = 0;
var numberList = '';

for (var i = 0; i < numbers.length && i < 10; i++) {
var n = numbers[i];
if (n.is_winner) wonNumbers++;
totalPrize += n.prize_amount;
numberList += (n.is_winner ? '✅' : '⏳') + ' ' + n.lucky_number;
if (n.prize_amount > 0) numberList += ' (¥' + n.prize_amount + ')';
numberList += '\n';
}

if (totalNumbers > 10) {
numberList += '...还有' + (totalNumbers - 10) + '个号码\n';
}

var gameId = numbers[0].game_id || '未设置';
var timeLeft = formatTimeRemaining();

var finalMsg = '📊 我的账户\n\n';
finalMsg += '🎮 游戏ID：' + gameId + '\n';
finalMsg += '🎫 持有号码：' + totalNumbers + '个\n';
finalMsg += '🏆 中奖：' + wonNumbers + '次\n';
finalMsg += '💰 累计奖金：¥' + totalPrize + '\n\n';
finalMsg += '🍀 最近号码：\n' + numberList + '\n';
finalMsg += '⏰ ' + timeLeft + '后开奖';

bot.sendMessage(chatId, finalMsg);
});
}
);
}

// 处理每日签到
function handleCheckin(chatId, tgId) {
if (!config.features.enableCheckin) {
bot.sendMessage(chatId, '❌ 签到功能暂未开启');
return;
}

var today = new Date().toISOString().split('T')[0];
db.get('SELECT 1 FROM checkins WHERE tg_id = ? AND date = ?', [tgId, today], function(err, row) {
if (row) {
bot.sendMessage(chatId, '⚠️ 您今天已经签到过了！明天再来吧~');
return;
}

db.get('SELECT checkin_streak, last_checkin FROM users WHERE tg_id = ?', [tgId], function(err, user) {
var streak = 1;
var yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

if (user && user.last_checkin === yesterday) {
streak = (user.checkin_streak || 0) + 1;
}

var bonus = 0;
if (streak === 3) bonus = 50;
else if (streak === 7) bonus = 150;
else if (streak === 14) bonus = 400;
else if (streak === 30) bonus = 1000;

var totalPoints = config.checkin.basePoints + bonus;

db.run('INSERT INTO checkins (tg_id, date, points, streak) VALUES (?, ?, ?, ?)',
[tgId, today, totalPoints, streak]);
db.run('UPDATE users SET points = points + ?, checkin_streak = ?, last_checkin = ? WHERE tg_id = ?',
[totalPoints, streak, today, tgId]);

var msg = '✅ 签到成功！\n\n';
msg += '📅 连续签到：' + streak + '天\n';
msg += '💰 基础奖励：10积分';
if (bonus > 0) msg += '\n🎁 连续' + streak + '天额外奖励：+' + bonus + '积分';
msg += '\n\n💎 总积分：+' + totalPoints;

bot.sendMessage(chatId, msg);
});
});
}

// 显示邀请页面
function showInvite(chatId, tgId) {
var inviteLink = 'https://t.me/' + BOT_USERNAME + '?start=' + tgId;

db.get('SELECT invite_count FROM users WHERE tg_id = ?', [tgId], function(err, user) {
var count = user ? user.invite_count : 0;

var msg = '👥 邀请好友，双赢奖励！\n\n';
msg += '🔗 您的专属链接：\n' + inviteLink + '\n\n';
msg += '🎁 奖励机制：\n';
msg += '• 好友通过您的链接参与\n';
msg += '• 您获得：' + config.invite.inviterPoints + '积分 + ' + config.invite.inviterEntries + '个名额\n';
msg += '• 好友获得：' + config.invite.inviteePoints + '积分欢迎奖\n\n';
msg += '📊 我的邀请：\n';
msg += '• 已邀请：' + count + '人\n';
msg += '• 累计奖励：' + (count * config.invite.inviterPoints) + '积分\n\n';
msg += '📤 分享链接给好友，一起参与！';

bot.sendMessage(chatId, msg);
});
}
// ==================== 审核流程函数 ====================

// 处理用户上传的充值截图
function handlePhoto(chatId, tgId, photo, username) {
var fileId = photo[photo.length - 1].file_id;

// 保存到待审核表，状态为"等待输入金额"
db.run(
'INSERT INTO pending_reviews (tg_id, username, screenshot_file_id, status) VALUES (?, ?, ?, ?)',
[tgId, username, fileId, 'awaiting_amount'],
function(err) {
if (err) {
bot.sendMessage(chatId, '❌ 上传失败，请重试');
return;
}

bot.sendMessage(chatId,
'✅ 截图已收到！\n\n' +
'📝 请输入充值金额（数字）：\n' +
'（例如：500）\n\n' +
'⚠️ 输入金额将决定可选档位');
}
);
}

// 处理用户输入的充值金额
function handleAmountInput(chatId, tgId, amount) {
// 查找该用户待处理的审核记录
db.get(
'SELECT * FROM pending_reviews WHERE tg_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
[tgId, 'awaiting_amount'],
function(err, review) {
if (!review) return; // 没有待处理记录，忽略

// 更新金额和状态
db.run('UPDATE pending_reviews SET amount = ?, status = ? WHERE id = ?',
[amount, 'awaiting_tier', review.id]);

// 根据金额生成可选档位按钮
var tierButtons = [];
var tierText = '';

Object.values(config.tiers).forEach(function(tier) {
if (amount >= tier.minAmount) {
// 金额足够，显示可选按钮
tierButtons.push([{
text: tier.emoji + ' ' + tier.name + ' (' + tier.entries + '个号)',
callback_data: 'review_tier_' + tier.code + '_' + review.id
}]);
tierText += tier.emoji + ' ' + tier.name + ' ✓ 可参与\n';
} else {
// 金额不足，显示差额
tierText += tier.emoji + ' ' + tier.name + ' ❌ 差¥' + (tier.minAmount - amount) + '\n';
}
});

// 没有可选档位（金额太低）
if (tierButtons.length === 0) {
bot.sendMessage(chatId,
'❌ 充值金额不足最低档位（¥' + config.minRecharge + '）\n\n' +
'💰 当前：¥' + amount + '\n' +
'📉 差额：¥' + (config.minRecharge - amount) + '\n\n' +
'请重新充值后再参与！');

// 删除这条审核记录
db.run('DELETE FROM pending_reviews WHERE id = ?', [review.id]);
return;
}

// 显示可选档位
var msg = '💰 充值金额：¥' + amount + '\n\n';
msg += '📋 可选档位：\n' + tierText + '\n';
msg += '👇 请选择要参与的档位：';

bot.sendMessage(chatId, msg, { reply_markup: { inline_keyboard: tierButtons } });
}
);
}

// 处理用户输入的游戏ID并提交审核
function handleGameIdSubmit(chatId, tgId, gameId) {
// 查找待处理的审核记录
db.get(
'SELECT * FROM pending_reviews WHERE tg_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
[tgId, 'awaiting_id'],
function(err, review) {
if (!review) return;

var tier = config.tiers[review.tier];

// 更新ID并提交审核
db.run('UPDATE pending_reviews SET game_id = ?, status = ? WHERE id = ?',
[gameId, 'pending_review', review.id]);

// 通知用户已提交
var msg = '✅ 提交成功！等待审核...\n\n';
msg += '📋 审核信息：\n';
msg += '• 游戏ID：' + gameId + '\n';
msg += '• 充值金额：¥' + review.amount + '\n';
msg += '• 选择档位：' + tier.emoji + ' ' + tier.name + '\n';
msg += '• 预计获得：' + tier.entries + '个号码\n\n';
msg += '⏰ 管理员审核后将自动发放\n';
msg += '📢 请耐心等待...';

bot.sendMessage(chatId, msg);

// 通知管理员审核（如果开启）
if (config.features.adminNotifications) {
ADMIN_IDS.forEach(function(adminId) {
var adminMsg = '📢 新用户待审核\n\n';
adminMsg += '👤 @' + (review.username || 'N/A') + ' (' + tgId + ')\n';
adminMsg += '🎮 游戏ID：' + gameId + '\n';
adminMsg += '💰 充值金额：¥' + review.amount + '\n';
adminMsg += '🎯 申请档位：' + tier.name + '\n';
adminMsg += '🍀 应发号码：' + tier.entries + '个\n';
adminMsg += '📷 截图已保存';

bot.sendMessage(adminId, adminMsg, {
reply_markup: {
inline_keyboard: [[
{ text: '✅ 通过并发放', callback_data: 'approve_' + review.id },
{ text: '❌ 拒绝', callback_data: 'reject_' + review.id }
]]
}
});
});
}
}
);
}
// ==================== 管理员功能 ====================

// 处理管理员命令
function handleAdminCommands(chatId, text) {
// /draw - 执行开奖
if (text === '/draw') {
performDraw(chatId);
return;
}

// /list - 查看最近参与者
if (text === '/list') {
db.all('SELECT lucky_number, game_id, tier FROM numbers ORDER BY created_at DESC LIMIT 20', [],
function(err, rows) {
if (!rows || rows.length === 0) {
bot.sendMessage(chatId, '暂无参与者');
return;
}

var list = '';
rows.forEach(function(r) {
var emoji = config.tiers[r.tier] ? config.tiers[r.tier].emoji : '❓';
list += emoji + ' ' + r.lucky_number + ' | ' + r.game_id + '\n'});

bot.sendMessage(chatId, '📋 最近20位参与者：\n\n' + list);
});
return;
}

// /stats - 查看统计
if (text === '/stats') {
getStats(function(stats) {
db.get('SELECT COUNT(*) as c FROM numbers WHERE is_winner = 1', [], function(e, w) {
var winners = w ? w.c : 0;
var winRate = stats.numbers > 0 ? ((winners / stats.numbers) * 100).toFixed(1) : 0;

var msg = '📊 活动统计\n\n';
msg += '👥 总用户：' + stats.users + '人\n';
msg += '🎫 总号码：' + stats.numbers + '个\n';
msg += '🏆 中奖数：' + winners + '个\n';
msg += '📈 中奖率：' + winRate + '%\n';
msg += '💰 总奖池：¥' + stats.totalPrizes;

bot.sendMessage(chatId, msg);
});
});
return;
}

// /broadcast - 群发消息
if (text.startsWith('/broadcast ')) {
var message = text.replace('/broadcast ', '');

db.all('SELECT tg_id FROM users', [], function(err, users) {
if (!users || users.length === 0) {
bot.sendMessage(chatId, '❌ 没有用户可发送');
return;
}

var successCount = 0;
var failCount = 0;

users.forEach(function(user) {
bot.sendMessage(user.tg_id, '📢 公告\n\n' + message)
.then(function() { successCount++; })
.catch(function() { failCount++; });
});

setTimeout(function() {
bot.sendMessage(chatId, '✅ 群发完成\n成功：' + successCount + '人\n失败：' + failCount + '人');
}, 3000);
});
return;
}
}



// /stats - 第7段：开奖函数
// 执行开奖
function performDraw(chatId) {
// 获取所有未中奖的号码
db.all('SELECT * FROM numbers WHERE is_winner = 0', [], function(err, numbers) {
if (!numbers || numbers.length === 0) {
bot.sendMessage(chatId, '❌ 没有可抽奖的号码');
return;
}

// 随机打乱并抽取
var shuffled = numbers.sort(function() { return 0.5 - Math.random(); });
var winners = shuffled.slice(0, Math.min(config.prizes.length, shuffled.length));
var today = new Date().toISOString().split('T')[0];

var resultText = '🎰 ' + today + ' 开奖结果\n\n🏆 中奖号码：\n\n';

// 保存开奖记录
db.run('INSERT INTO draws (draw_date, total_participants, total_prize_pool) VALUES (?, ?, ?)',
[today, numbers.length, 1200]);

db.get('SELECT id FROM draws WHERE draw_date = ? ORDER BY id DESC LIMIT 1', [today],
function(err, draw) {
var drawId = draw ? draw.id : 0;

// 处理每个中奖者
winners.forEach(function(winner, index) {
var prize = config.prizes[index];

// 更新号码为已中奖
db.run('UPDATE numbers SET is_winner = 1, prize_amount = ? WHERE lucky_number = ?',
[prize.amount, winner.lucky_number]);

// 保存中奖记录
db.run('INSERT INTO winners (draw_id, lucky_number, tg_id, game_id, prize_rank, prize_amount) VALUES (?, ?, ?, ?, ?, ?)',
[drawId, winner.lucky_number, winner.tg_id, winner.game_id, prize.rank, prize.amount]);

resultText += (index + 1) + '. 🍀 ' + winner.lucky_number + ' - 🎮 ' + winner.game_id + ' - 💰 ¥' + prize.amount + '\n';

// 通知中奖用户
var userMsg = '🎉🎉🎉 恭喜中奖！🎉🎉🎉\n\n';
userMsg += '╔════════════════════╗\n';
userMsg += '║ 🏆 ' + prize.name + ' 🏆 ║\n';
userMsg += '║ ║\n';
userMsg += '║ ¥ ' + prize.amount + ' ║\n';
userMsg += '║ ║\n';
userMsg += '║ 幸运号码：' + winner.lucky_number + ' ║\n';
userMsg += '╚════════════════════╝\n\n';
userMsg += '👤 游戏ID：' + winner.game_id + '\n';
userMsg += '💰 中奖金额：¥' + prize.amount + '\n';
userMsg += '⏰ 开奖时间：' + today + '\n\n';
userMsg += '📋 领奖说明：\n';
userMsg += '1. 保存此消息作为凭证\n';
userMsg += '2. 奖励将在24小时内发放\n';
userMsg += '3. 如有疑问请联系客服\n\n';
userMsg += '🎁 继续充值可参与明日抽奖！';

bot.sendMessage(winner.tg_id, userMsg).catch(function() {});
});

resultText += '\n📊 本期参与：' + numbers.length + '人\n⏰ 下期抽奖：明日' + config.drawTime;

bot.sendMessage(chatId, resultText);
});
});
}
// ==================== 启动完成 ====================
console.log('🎰 全功能抽奖Bot已启动！');
console.log('📱 Bot用户名：', BOT_USERNAME);
console.log('👮 管理员：', ADMIN_IDS);
console.log('✅ 支持档位：100, 300, 500, 1000, 2000, 5000, 10000, 20000');
console.log('✅ 审核流程：截图 → 金额 → 档位 → ID → 审核 → 发号');
