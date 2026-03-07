/**
 * bot.js - 全功能抽奖机器人
 * 版本：3.0.0 (Production Ready)
 * 功能：8档位充值、人工审核、7位ID验证、每日签到、邀请返利
 * 作者：OpenClaw
 * 日期：2026-03-08
 */

// ==================== 1. 引入依赖模块 ====================
// Telegram Bot API库，用于与Telegram通信
const TelegramBot = require('node-telegram-bot-api');
// SQLite3数据库，轻量级本地存储
const sqlite3 = require('sqlite3').verbose();
// 加载配置文件（档位、奖品等设置）
const config = require('./config');
// 加载消息模板（文案内容）
const messages = require('./messages');

// ==================== 2. 环境变量配置 ====================
// 从Railway环境变量读取，不在代码中写死
const TOKEN = process.env.BOT_TOKEN;                    // Bot Token
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').filter(function(id) { 
  return id.length > 0; 
});                                                     // 管理员ID列表
const BOT_USERNAME = process.env.BOT_USERNAME || config.botUsername;  // Bot用户名

// ==================== 3. 初始化Bot实例 ====================
// 创建Bot实例，使用polling模式（长轮询）
const bot = new TelegramBot(TOKEN, { polling: true });
// 创建SQLite数据库连接，文件名为lottery.db
const db = new sqlite3.Database('./lottery.db');

// ==================== 4. 数据库表结构初始化 ====================
// 此函数在启动时执行，确保所有表都存在
function initDatabase() {
  // serialize确保SQL语句按顺序执行
  db.serialize(function() {
    
    // 4.1 用户表：存储用户基本信息
    db.run('CREATE TABLE IF NOT EXISTS users (' +
      'tg_id TEXT PRIMARY KEY, ' +           // Telegram用户ID，主键
      'username TEXT, ' +                     // Telegram用户名
      'game_id TEXT, ' +                      // 游戏内ID（7位数字）
      'points INTEGER DEFAULT 0, ' +          // 积分余额
      'total_deposit INTEGER DEFAULT 0, ' +   // 累计充值金额
      'invite_count INTEGER DEFAULT 0, ' +    // 邀请人数
      'invited_by TEXT, ' +                   // 被谁邀请（邀请人tg_id）
      'checkin_streak INTEGER DEFAULT 0, ' +  // 连续签到天数
      'last_checkin TEXT' +                   // 最后签到日期
    ')');
    
    // 4.2 号码表：存储所有已发放的幸运号码
    db.run('CREATE TABLE IF NOT EXISTS numbers (' +
      'lucky_number INTEGER PRIMARY KEY, ' +  // 6位幸运号码，主键
      'tg_id TEXT, ' +                        // 所属用户
      'game_id TEXT, ' +                      // 游戏ID
      'tier TEXT, ' +                         // 充值档位代码
      'is_winner INTEGER DEFAULT 0, ' +       // 是否中奖（0=否，1=是）
      'prize_amount INTEGER DEFAULT 0' +      // 中奖金额
    ')');
    
    // 4.3 签到表：存储每日签到记录
    db.run('CREATE TABLE IF NOT EXISTS checkins (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'tg_id TEXT, ' +                        // 用户ID
      'date TEXT, ' +                         // 签到日期
      'points INTEGER, ' +                    // 获得积分
      'streak INTEGER' +                      // 连续天数
    ')');
    
    // 4.4 开奖记录表：存储每期开奖信息
    db.run('CREATE TABLE IF NOT EXISTS draws (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'draw_date TEXT, ' +                    // 开奖日期
      'total_participants INTEGER, ' +        // 参与人数
      'total_prize_pool INTEGER' +            // 奖池金额
    ')');
    
    // 4.5 审核表：核心功能，存储待审核的充值申请
    db.run('CREATE TABLE IF NOT EXISTS pending_reviews (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      'tg_id TEXT, ' +                        // 申请人ID
      'username TEXT, ' +                     // 申请人用户名
      'game_id TEXT, ' +                      // 游戏ID（审核后填写）
      'amount INTEGER, ' +                    // 充值金额
      'tier TEXT, ' +                         // 选择的档位
      'screenshot_file_id TEXT, ' +           // 截图文件ID
      'status TEXT DEFAULT "pending", ' +     // 状态：awaiting_amount/awaiting_tier/awaiting_id/pending_review/approved/rejected
      'created_at TEXT DEFAULT CURRENT_TIMESTAMP' +  // 创建时间
    ')');
  });
}

// 启动时立即执行数据库初始化
initDatabase();

// ==================== 5. 工具函数 ====================

/**
 * 检查用户是否为管理员
 * @param {string} id - 用户Telegram ID
 * @returns {boolean} - 是管理员返回true
 */
function isAdmin(id) {
  return ADMIN_IDS.indexOf(id.toString()) !== -1;
}

/*** 生成指定数量的不重复幸运号码
 * @param {number} count - 需要生成的号码数量
 * @param {function} callback - 回调函数，参数为号码数组
 * @param {array} numbers - 递归用，存储已生成的号码
 */
function generateLuckyNumbers(count, callback, numbers) {
  if (!numbers) numbers = [];
  if (numbers.length >= count) {
    callback(numbers);
    return;
  }
  // 生成6位随机数（100000-999999）
  var num = Math.floor(100000 + Math.random() * 900000);
  // 检查是否已存在
  db.get('SELECT 1 FROM numbers WHERE lucky_number = ?', [num], function(err, row) {
    if (!row && numbers.indexOf(num) === -1) {
      numbers.push(num);
    }
    // 递归继续生成
    generateLuckyNumbers(count, callback, numbers);
  });
}

/**
 * 获取统计数据（用户总数、号码总数、总奖池）
 * @param {function} callback - 回调函数，参数为统计对象
 */
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

/**
 * 格式化距离下次开奖的时间
 * @returns {string} - 如："5小时32分"
 */
function formatTimeRemaining() {
  var now = new Date();
  var target = new Date();
  target.setHours(20, 0, 0, 0);  // 设置为今晚8点
  
  // 如果当前已过8点，设置为明天8点
  if (now > target) {
    target.setDate(target.getDate() + 1);
  }
  
  var diff = target - now;
  var h = Math.floor(diff / (1000 * 60 * 60));
  var m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return h + '小时' + m + '分';
}

/**
 * 格式化档位列表为文本
 * @returns {string} - 格式化的档位说明
 */
function formatTiers() {
  var result = '';
  Object.values(config.tiers).forEach(function(tier) {
    result += tier.emoji + ' ' + tier.name + ' ¥' + tier.minAmount + '\n';
    result += '   → ' + tier.entries + '个幸运号码\n';
    if (tier.bonusPoints > 0) {
      result += '   → 额外送' + tier.bonusPoints + '积分\n';
    }
    result += '\n';
  });
  return result;
}


// ==================== 6. 主消息处理器 ====================
// 处理所有用户发送的消息（命令、文本、图片）
bot.on('message', function(msg) {
  // 提取消息信息
  var chatId = msg.chat.id;                    // 聊天ID
  var tgId = msg.from.id.toString();           // 用户Telegram ID（转为字符串）
  var text = msg.text || '';                   // 消息文本（空字符串兜底）
  var username = msg.from.username || msg.from.first_name;  // 用户名或名字

  // ---------- 6.1 /start 命令：欢迎和初始化 ----------
  if (text === '/start' || text.startsWith('/start ')) {
    // 提取邀请码（如果有）
    var inviteCode = text.split(' ')[1];
    
    // 创建用户记录（如果不存在则插入，存在则忽略）
    db.run('INSERT OR IGNORE INTO users (tg_id, username) VALUES (?, ?)', [tgId, username]);
    
    // 处理邀请关系
    if (inviteCode && inviteCode !== tgId && config.features.enableInvite) {
      db.get('SELECT invited_by FROM users WHERE tg_id = ?', [tgId], function(err, user) {
        // 只处理首次绑定邀请关系
        if (!user || !user.invited_by) {
          // 记录被邀请
          db.run('UPDATE users SET invited_by = ? WHERE tg_id = ?', [inviteCode, tgId]);
          // 给邀请人增加统计
          db.run('UPDATE users SET invite_count = invite_count + 1, points = points + ? WHERE tg_id = ?',
            [config.invite.inviterPoints, inviteCode]);
        }
      });
    }
    
    // 获取统计数据并发送欢迎消息
    getStats(function(stats) {
      var welcomeText = messages.welcome(stats, formatTimeRemaining());
      bot.sendMessage(chatId, welcomeText, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: messages.buttons.join, callback_data: 'join' },
              { text: messages.buttons.rules, callback_data: 'rules' }
            ],
            [
              { text: messages.buttons.prizes, callback_data: 'prizes' },
              { text: messages.buttons.status, callback_data: 'status' }
            ],
            [
              { text: messages.buttons.checkin, callback_data: 'checkin' },
              { text: messages.buttons.invite, callback_data: 'invite' }
            ]
          ]
        }
      });
    });
    return;  // 处理完/start，不再执行后续代码
  }
  
  // ---------- 6.2 /status 命令：查看账户状态 ----------
  if (text === '/status') {
    showStatus(chatId, tgId);
    return;
  }
  
  // ---------- 6.3 /checkin 命令：每日签到 ----------
  if (text === '/checkin') {
    handleCheckin(chatId, tgId);
    return;
  }
  
  // ---------- 6.4 /invite 命令：邀请好友 ----------
  if (text === '/invite') {
    showInvite(chatId, tgId);
    return;
  }
  
  // ---------- 6.5 /rules 命令：活动规则 ----------
  if (text === '/rules') {
    var rulesMsg = messages.rules(formatTiers(), formatPrizes(), config.drawTime);
    bot.sendMessage(chatId, rulesMsg);
    return;
  }
  
  // ---------- 6.6 /help 命令：帮助中心 ----------
  if (text === '/help') {
    var helpMsg = '📚 帮助中心\n\n';
    helpMsg += '🎮 参与流程：\n';
    helpMsg += '1. 充值最低¥' + config.minRecharge + '\n';
    helpMsg += '2. 发送截图给Bot\n';
    helpMsg += '3. 输入金额选择档位\n';
    helpMsg += '4. 输入7位游戏ID\n';
    helpMsg += '5. 等待审核通过获得号码\n';
    helpMsg += '6. 每晚' + config.drawTime + '开奖\n\n';
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
  
  // ---------- 6.7 处理图片：充值截图 ----------
  if (msg.photo) {
    // 照片数组最后一个元素是最高分辨率版本
    handlePhoto(chatId, tgId, msg.photo, username);
    return;
  }
  
  // ---------- 6.8 处理金额输入（1-5位数字，支持20000） ----------
  // 正则说明：^\d{1,5}$ 匹配1-5位纯数字
  if (/^\d{1,5}$/.test(text) && !text.startsWith('/')) {
    var amount = parseInt(text);
    if (amount >= 100) {
      // 金额>=100，进入金额处理流程
      handleAmountInput(chatId, tgId, amount);
    } else {
      bot.sendMessage(chatId, '❌ 充值金额不能低于¥100');
    }
    return;
  }
  
  // ---------- 6.9 处理游戏ID（7位纯数字） ----------
  // 正则说明：^\d{7}$ 匹配7位纯数字
  if (/^\d{7}$/.test(text)) {
    handleGameIdSubmit(chatId, tgId, text);
    return;
  }
  
  // ---------- 6.10 错误提示：输入了数字但不是7位 ----------
  if (/^\d+$/.test(text) && text.length !== 7 && !text.startsWith('/')) {
    bot.sendMessage(chatId, '❌ 游戏ID必须为7位纯数字（如：1234567）');
    return;
  }
  
  // ---------- 6.11 管理员命令 ----------
  if (isAdmin(msg.from.id)) {
    handleAdminCommands(chatId, text);
  }
});
// ==================== 7. 按钮回调处理器 ====================
// 处理用户点击内联按钮（Inline Keyboard）的事件
bot.on('callback_query', function(query) {
// 提取回调信息
var chatId = query.message.chat.id; // 聊天ID
var tgId = query.from.id.toString(); // 用户ID
var data = query.data; // 回调数据（按钮携带的标识）

// 立即回答回调，移除按钮的"loading"状态
bot.answerCallbackQuery(query.id);

// ---------- 7.1 主菜单按钮处理 ----------

// "立即参与"按钮
  // "立即参与"按钮 - 显示参与指南
  if (data === 'join') {
    var guideMsg = '📱 参与流程：\n\n';
    guideMsg += '1️⃣ 在游戏内充值（最低¥' + config.minRecharge + '）\n';
    guideMsg += '2️⃣ 截图充值成功页面\n';
    guideMsg += '3️⃣ 发送截图给我\n';
    guideMsg += '4️⃣ 输入充值金额选择档位\n';
    guideMsg += '5️⃣ 输入7位游戏ID\n';
    guideMsg += '6️⃣ 等待审核通过获得号码\n\n';
    guideMsg += '⏰ 每晚' + config.drawTime + '开奖！\n\n';
    guideMsg += '✅ 请直接发送充值截图开始参与！';
    
    bot.sendMessage(chatId, guideMsg);
    return;
  }


// "活动规则"按钮
if (data === 'rules') {
var rulesText = messages.rules(formatTiers(), formatPrizes(), config.drawTime);
bot.sendMessage(chatId, rulesText);
return;
}

// "奖池详情"按钮
if (data === 'prizes') {
var prizeText = '🏆 奖品设置\n\n';
prizeText += formatPrizes() + '\n';
prizeText += '💰 奖池总计：¥1,200\n';
prizeText += '⏰ 每晚 ' + config.drawTime + ' 自动开奖';
bot.sendMessage(chatId, prizeText);
return;
}

// "我的状态"按钮
if (data === 'status') {
showStatus(chatId, tgId);
return;
}

// "每日签到"按钮
if (data === 'checkin') {
handleCheckin(chatId, tgId);
return;
}

// "邀请好友"按钮
if (data === 'invite') {
showInvite(chatId, tgId);
return;
}

// ---------- 7.2 审核流程按钮处理 ----------

// 档位选择（审核流程）：review_tier_档位代码_审核ID
if (data.startsWith('review_tier_')) {
var parts = data.split('_'); // 分割回调数据
var tierCode = parts[2]; // 档位代码
var reviewId = parts[3]; // 审核记录ID

// 查询审核记录
db.get('SELECT * FROM pending_reviews WHERE id = ?', [reviewId], function(err, review) {
if (!review) return; // 记录不存在，忽略

var tier = config.tiers[tierCode]; // 获取档位配置

// 更新审核状态：已选档位，等待输入ID
db.run('UPDATE pending_reviews SET tier = ?, status = ? WHERE id = ?',
[tierCode, 'awaiting_id', reviewId]);

// 提示用户输入游戏ID
var msg = '🎯 已选择：' + tier.emoji + ' ' + tier.name + '\n\n';
msg += '📝 请输入7位游戏ID（纯数字）：\n';
msg += '（格式：1234567）\n\n';
msg += '⚠️ ID必须为7位数字，中奖后无法更改！';
bot.sendMessage(chatId, msg);
});
return;
}

// 管理员通过审核：approve_审核ID
if (data.startsWith('approve_')) {
var reviewId = data.split('_')[1];

db.get('SELECT * FROM pending_reviews WHERE id = ?', [reviewId], function(err, review) {
// 验证记录存在且状态为待审核
if (!review || review.status !== 'pending_review') return;

var tier = config.tiers[review.tier]; // 获取档位信息

// 生成幸运号码
generateLuckyNumbers(tier.entries, function(numbers) {
// 保存号码到数据库
numbers.forEach(function(num) {
db.run('INSERT INTO numbers (lucky_number, tg_id, game_id, tier) VALUES (?, ?, ?, ?)',
[num, review.tg_id, review.game_id, review.tier]);
});

// 更新审核状态为已通过
db.run('UPDATE pending_reviews SET status = ? WHERE id = ?', ['approved', reviewId]);

// 更新用户累计充值
db.run('UPDATE users SET game_id = ?, total_deposit = total_deposit + ? WHERE tg_id = ?',
[review.game_id, review.amount, review.tg_id]);

// 赠送积分（如果有）
if (tier.bonusPoints > 0) {
db.run('UPDATE users SET points = points + ? WHERE tg_id = ?',
[tier.bonusPoints, review.tg_id]);
}

// 通知用户审核通过
var userMsg = '🎉 审核通过！参与成功！\n\n';
userMsg += '🎮 游戏ID：' + review.game_id + '\n';
userMsg += '🎯 档位：' + tier.emoji + ' ' + tier.name + '\n';
userMsg += '🍀 幸运号码：' + numbers.join(', ') + '\n';
if (tier.bonusPoints > 0) {
userMsg += '💎 赠送积分：+' + tier.bonusPoints + '\n';
}
userMsg += '\n⏰ 每晚8点开奖！';
bot.sendMessage(review.tg_id, userMsg);

// 通知其他管理员（群发通知）
var adminMsg = '📢 新用户参与（已审核通过）\n\n';
adminMsg += '👤 @' + (review.username || 'N/A') + ' (' + review.tg_id + ')\n';
adminMsg += '🎮 游戏ID：' + review.game_id + '\n';
adminMsg += '🎯 档位：' + tier.name + '\n';
adminMsg += '🍀 号码：' + numbers.join(', ') + '\n';
adminMsg += '💰 金额：¥' + review.amount;

ADMIN_IDS.forEach(function(adminId) {
if (adminId !== tgId) { // 不发给当前操作的管理员
bot.sendMessage(adminId, adminMsg);
}
});

// 更新原审核消息
bot.editMessageText('✅ 已通过并发放\n\n👤 ' + review.username + '\n🎮 ' + review.game_id + '\n🍀 ' + numbers.length + '个号码',
{ chat_id: chatId, message_id: query.message.message_id });
});
});
return;
}

// 管理员拒绝审核：reject_审核ID
if (data.startsWith('reject_')) {
var reviewId = data.split('_')[1];

// 更新状态为已拒绝
db.run('UPDATE pending_reviews SET status = ? WHERE id = ?', ['rejected', reviewId]);

// 通知用户
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

// 更新原审核消息
bot.editMessageText('❌ 已拒绝该申请',
{ chat_id: chatId, message_id: query.message.message_id });
});
return;
}
});

// ==================== 8. 显示类功能函数 ====================

/**
* 显示档位选择菜单
* @param {number} chatId - 聊天ID
*/
function showTiers(chatId) {
// 动态生成档位按钮
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

/**
* 显示用户状态（核心功能）
* 支持两种状态：审核中 / 已参与
* @param {number} chatId - 聊天ID
* @param {string} tgId - 用户Telegram ID
*/
function showStatus(chatId, tgId) {
// 先查询是否有待审核记录
db.get(
'SELECT * FROM pending_reviews WHERE tg_id = ? AND status != ? AND status != ? ORDER BY id DESC LIMIT 1',
[tgId, 'approved', 'rejected'],
function(err, pendingReview) {

// ----- 状态A：有审核中的记录 -----
if (pendingReview) {
var tier = pendingReview.tier ? config.tiers[pendingReview.tier] : null;
var statusText = '';

// 根据审核状态显示不同提示
switch(pendingReview.status) {
case 'awaiting_amount': statusText = '等待输入金额'; break;
case 'awaiting_tier': statusText = '等待选择档位'; break;
case 'awaiting_id': statusText = '等待输入游戏ID'; break;
case 'pending_review': statusText = '⏳ 审核中，请耐心等待...'; break;
}

var msg = '📊 我的账户\n\n';
msg += '🔔 当前状态：' + statusText + '\n';

if (pendingReview.amount) {
msg += '💰 充值金额：¥' + pendingReview.amount + '\n';
}
if (tier) {
msg += '🎯 选择档位：' + tier.emoji + ' ' + tier.name + '\n';
msg += '🎫 预计获得：' + tier.entries + '个号码\n';
}
if (pendingReview.game_id) {
msg += '🎮 游戏ID：' + pendingReview.game_id + '\n';
}

msg += '\n⏳ 管理员审核通过后将自动发放号码';

bot.sendMessage(chatId, msg);
return;
}

// ----- 状态B：查询已持有的号码 -----
db.all('SELECT * FROM numbers WHERE tg_id = ? ORDER BY created_at DESC', [tgId], function(err, numbers) {
// 没有任何号码记录
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

// 显示最近10个号码
for (var i = 0; i < numbers.length && i < 10; i++) {
var n = numbers[i];
if (n.is_winner) wonNumbers++;
totalPrize += n.prize_amount;
numberList += (n.is_winner ? '✅' : '⏳') + ' ' + n.lucky_number;
if (n.prize_amount > 0) numberList += ' (¥' + n.prize_amount + ')';
numberList += '\n';
}

// 号码太多，显示省略
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

/**
* 处理每日签到
* @param {number} chatId - 聊天ID
* @param {string} tgId - 用户Telegram ID
*/
function handleCheckin(chatId, tgId) {
// 检查功能是否开启
if (!config.features.enableCheckin) {
bot.sendMessage(chatId, '❌ 签到功能暂未开启');
return;
}

var today = new Date().toISOString().split('T')[0];

// 检查今天是否已签到
db.get('SELECT 1 FROM checkins WHERE tg_id = ? AND date = ?', [tgId, today], function(err, row) {
if (row) {
bot.sendMessage(chatId, '⚠️ 您今天已经签到过了！明天再来吧~');
return;
}

// 查询用户签到信息
db.get('SELECT checkin_streak, last_checkin FROM users WHERE tg_id = ?', [tgId], function(err, user) {
var streak = 1;
var yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

// 判断是否是连续签到
if (user && user.last_checkin === yesterday) {
streak = (user.checkin_streak || 0) + 1;
}

// 计算连续签到奖励
var bonus = 0;
if (streak === 3) bonus = 50;
else if (streak === 7) bonus = 150;
else if (streak === 14) bonus = 400;
else if (streak === 30) bonus = 1000;

var totalPoints = config.checkin.basePoints + bonus;

// 保存签到记录
db.run('INSERT INTO checkins (tg_id, date, points, streak) VALUES (?, ?, ?, ?)',
[tgId, today, totalPoints, streak]);

// 更新用户积分和签到信息
db.run('UPDATE users SET points = points + ?, checkin_streak = ?, last_checkin = ? WHERE tg_id = ?',
[totalPoints, streak, today, tgId]);

// 发送签到成功消息
var msg = '✅ 签到成功！\n\n';
msg += '📅 连续签到：' + streak + '天\n';
msg += '💰 基础奖励：' + config.checkin.basePoints + '积分';
if (bonus > 0) {
msg += '\n🎁 连续' + streak + '天额外奖励：+' + bonus + '积分';
}
msg += '\n\n💎 总积分：+' + totalPoints;

bot.sendMessage(chatId, msg);
});
});
}

/**
* 显示邀请页面
* @param {number} chatId - 聊天ID
* @param {string} tgId - 用户Telegram ID
*/
function showInvite(chatId, tgId) {
// 生成邀请链接
var inviteLink = 'https://t.me/' + BOT_USERNAME + '?start=' + tgId;

// 查询邀请统计
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
// ==================== 9. 审核流程核心函数 ====================

/**
* 处理用户上传的充值截图
* 这是审核流程的第一步
* @param {number} chatId - 聊天ID
* @param {string} tgId - 用户Telegram ID
* @param {array} photo - 照片数组（Telegram返回的对象数组）
* @param {string} username - 用户名
*/
function handlePhoto(chatId, tgId, photo, username) {
// 获取最高分辨率的照片（数组最后一个元素）
var fileId = photo[photo.length - 1].file_id;

// 保存到审核表，状态设为"等待输入金额"
db.run(
'INSERT INTO pending_reviews (tg_id, username, screenshot_file_id, status) VALUES (?, ?, ?, ?)',
[tgId, username, fileId, 'awaiting_amount'],
function(err) {
if (err) {
console.error('保存截图失败:', err);
bot.sendMessage(chatId, '❌ 上传失败，请重试');
return;
}

// 提示用户输入充值金额
bot.sendMessage(chatId,
'✅ 截图已收到！\n\n' +
'📝 请输入充值金额（数字）：\n' +
'（例如：500）\n\n' +
'⚠️ 输入金额将决定可选档位');
}
);
}

/**
* 处理用户输入的充值金额
* 这是审核流程的第二步
* @param {number} chatId - 聊天ID
* @param {string} tgId - 用户Telegram ID
* @param {number} amount - 输入的金额（已转为数字）
*/
function handleAmountInput(chatId, tgId, amount) {
// 查找该用户待处理的审核记录（状态为"等待输入金额"）
db.get(
'SELECT * FROM pending_reviews WHERE tg_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
[tgId, 'awaiting_amount'],
function(err, review) {
// 没有待处理记录，忽略此次输入
if (!review) return;

// 更新审核记录：保存金额，状态改为"等待选择档位"
db.run('UPDATE pending_reviews SET amount = ?, status = ? WHERE id = ?',
[amount, 'awaiting_tier', review.id]);

// 根据金额生成可选档位按钮
var tierButtons = []; // 按钮数组
var tierText = ''; // 档位说明文本

// 遍历所有档位，检查金额是否足够
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

// 没有可选档位（金额低于最低档位）
if (tierButtons.length === 0) {
bot.sendMessage(chatId,
'❌ 充值金额不足最低档位（¥' + config.minRecharge + '）\n\n' +
'💰 当前：¥' + amount + '\n' +
'📉 差额：¥' + (config.minRecharge - amount) + '\n\n' +
'请重新充值后再参与！');

// 删除这条无效的审核记录
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

/**
* 处理用户输入的游戏ID并提交审核
* 这是审核流程的最后一步
* @param {number} chatId - 聊天ID
* @param {string} tgId - 用户Telegram ID
* @param {string} gameId - 7位游戏ID
*/
function handleGameIdSubmit(chatId, tgId, gameId) {
// 查找待处理的审核记录（状态为"等待输入ID"）
db.get(
'SELECT * FROM pending_reviews WHERE tg_id = ? AND status = ? ORDER BY id DESC LIMIT 1',
[tgId, 'awaiting_id'],
function(err, review) {
// 没有待处理记录，忽略
if (!review) return;

var tier = config.tiers[review.tier]; // 获取档位信息

// 更新审核记录：保存游戏ID，状态改为"等待管理员审核"
db.run('UPDATE pending_reviews SET game_id = ?, status = ? WHERE id = ?',
[gameId, 'pending_review', review.id]);

// 通知用户已提交成功
var msg = '✅ 提交成功！等待审核...\n\n';
msg += '📋 审核信息：\n';
msg += '• 游戏ID：' + gameId + '\n';
msg += '• 充值金额：¥' + review.amount + '\n';
msg += '• 选择档位：' + tier.emoji + ' ' + tier.name + '\n';
msg += '• 预计获得：' + tier.entries + '个号码\n\n';
msg += '⏰ 管理员审核后将自动发放\n';
msg += '📢 请耐心等待...';

bot.sendMessage(chatId, msg);

// 如果开启了管理员通知，发送给所有管理员
if (config.features.adminNotifications) {
ADMIN_IDS.forEach(function(adminId) {
var adminMsg = '📢 新用户待审核\n\n';
adminMsg += '👤 @' + (review.username || 'N/A') + ' (' + tgId + ')\n';
adminMsg += '🎮 游戏ID：' + gameId + '\n';
adminMsg += '💰 充值金额：¥' + review.amount + '\n';
adminMsg += '🎯 申请档位：' + tier.name + '\n';
adminMsg += '🍀 应发号码：' + tier.entries + '个\n';
adminMsg += '📷 截图已保存';

// 发送带操作按钮的消息给管理员
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
// ==================== 10. 管理员功能函数 ====================

/**
* 处理管理员命令
* @param {number} chatId - 聊天ID
* @param {string} text - 命令文本
*/
function handleAdminCommands(chatId, text) {
// /draw - 执行开奖
if (text === '/draw') {
performDraw(chatId);
return;
}

// /list - 查看最近参与者列表
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
list += emoji + ' ' + r.lucky_number + ' | ' + r.game_id + '\n';
});

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

// 3秒后报告发送结果
setTimeout(function() {
bot.sendMessage(chatId, '✅ 群发完成\n成功：' + successCount + '人\n失败：' + failCount + '人');
}, 3000);
});
return;
}
}
// ==================== 10. 管理员功能函数 ====================

/**
* 处理管理员命令
* @param {number} chatId - 聊天ID
* @param {string} text - 命令文本
*/
function handleAdminCommands(chatId, text) {
// /draw - 执行开奖
if (text === '/draw') {
performDraw(chatId);
return;
}

// /list - 查看最近参与者列表
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
list += emoji + ' ' + r.lucky_number + ' | ' + r.game_id + '\n';
});

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

// 3秒后报告发送结果
setTimeout(function() {
bot.sendMessage(chatId, '✅ 群发完成\n成功：' + successCount + '人\n失败：' + failCount + '人');
}, 3000);
});
return;
}
}
// ==================== 11. 开奖核心函数 ====================

/**
 * 执行开奖（手动触发）
 * 随机抽取中奖号码，通知中奖用户
 * @param {number} chatId - 管理员聊天ID（用于返回结果）
 */
function performDraw(chatId) {
  // 获取所有未中奖的号码
  db.all('SELECT * FROM numbers WHERE is_winner = 0', [], function(err, numbers) {
    // 没有可抽奖的号码
    if (!numbers || numbers.length === 0) {
      bot.sendMessage(chatId, '❌ 没有可抽奖的号码');
      return;
    }
    
    // 随机打乱数组（Fisher-Yates算法简化版）
    var shuffled = numbers.sort(function() { return 0.5 - Math.random(); });
    
    // 抽取前N个作为中奖者（N为奖品数量，最多5个）
    var winners = shuffled.slice(0, Math.min(config.prizes.length, shuffled.length));
    
    // 获取当前日期
    var today = new Date().toISOString().split('T')[0];
    
    // 组装开奖结果消息
    var resultText = '🎰 ' + today + ' 开奖结果\n\n';
    resultText += '🏆 中奖号码：\n\n';
    
    // 保存开奖记录
    db.run('INSERT INTO draws (draw_date, total_participants, total_prize_pool) VALUES (?, ?, ?)',
      [today, numbers.length, 1200]);
    
    // 获取刚插入的开奖记录ID
    db.get('SELECT id FROM draws WHERE draw_date = ? ORDER BY id DESC LIMIT 1', [today],
      function(err, draw) {
        var drawId = draw ? draw.id : 0;
        
        // 处理每个中奖者
        winners.forEach(function(winner, index) {
          var prize = config.prizes[index];  // 对应奖品配置
          
          // 更新号码为已中奖状态
          db.run('UPDATE numbers SET is_winner = 1, prize_amount = ? WHERE lucky_number = ?',
            [prize.amount, winner.lucky_number]);
          
          // 保存中奖记录
          db.run('INSERT INTO winners (draw_id, lucky_number, tg_id, game_id, prize_rank, prize_amount) VALUES (?, ?, ?, ?, ?, ?)',
            [drawId, winner.lucky_number, winner.tg_id, winner.game_id, prize.rank, prize.amount]);
          
          // 添加到结果文本
          resultText += (index + 1) + '. 🍀 ' + winner.lucky_number;
          resultText += ' - 🎮 ' + winner.game_id;
          resultText += ' - 💰 ¥' + prize.amount + '\n';
          
          // 发送中奖通知给用户
          var userMsg = '🎉🎉🎉 恭喜中奖！🎉🎉🎉\n\n';
          userMsg += '╔════════════════════╗\n';
          userMsg += '║   🏆 ' + prize.name + ' 🏆   ║\n';
          userMsg += '║                    ║\n';
          userMsg += '║   ¥ ' + prize.amount + '          ║\n';
          userMsg += '║                    ║\n';
          userMsg += '║ 幸运号码：' + winner.lucky_number + '   ║\n';
          userMsg += '╚════════════════════╝\n\n';
          userMsg += '👤 游戏ID：' + winner.game_id + '\n';
          userMsg += '💰 中奖金额：¥' + prize.amount + '\n';
          userMsg += '⏰ 开奖时间：' + today + '\n\n';
          userMsg += '📋 领奖说明：\n';
          userMsg += '1. 保存此消息作为凭证\n';
          userMsg += '2. 奖励将在24小时内发放\n';
          userMsg += '3. 如有疑问请联系客服\n\n';
          userMsg += '🎁 继续充值可参与明日抽奖！';
          
          // 发送通知（忽略发送失败）
          bot.sendMessage(winner.tg_id, userMsg).catch(function() {});
        });
        
        // 添加统计信息
        resultText += '\n📊 本期参与：' + numbers.length + '人\n';
        resultText += '⏰ 下期抽奖：明日' + config.drawTime;
        
        // 发送开奖结果给管理员
        bot.sendMessage(chatId, resultText);
      });
  });
}

// ==================== 12. 程序启动完成 ====================

console.log('========================================');
console.log('🎰 全功能抽奖Bot已启动！');
console.log('📱 Bot用户名：' + BOT_USERNAME);
console.log('👮 管理员：' + ADMIN_IDS.join(', '));
console.log('✅ 支持档位：100, 300, 500, 1000, 2000, 5000, 10000, 20000');
console.log('✅ 审核流程：截图 → 金额 → 档位 → ID → 审核 → 发号');
console.log('========================================');





