const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// ========== 配置区域 ==========
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
const MIN_RECHARGE = process.env.MIN_RECHARGE || 100;
const DRAW_TIME = process.env.DRAW_TIME || '20:00';
const PRIZES_PER_DRAW = 5;
// =============================

const bot = new TelegramBot(TOKEN, { polling: true });
const db = new sqlite3.Database('./lottery.db');

// 初始化数据库
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id TEXT UNIQUE,
    username TEXT,
    game_id TEXT,
    lucky_number INTEGER UNIQUE,
    screenshot_file_id TEXT,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_winner BOOLEAN DEFAULT 0,
    prize_amount INTEGER DEFAULT 0
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS winners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lucky_number INTEGER,
    tg_id TEXT,
    game_id TEXT,
    draw_date DATE,
    prize_amount INTEGER
  )`);
});

function generateLuckyNumber(callback) {
  const number = Math.floor(100000 + Math.random() * 900000);
  db.get('SELECT lucky_number FROM users WHERE lucky_number = ?', [number], (err, row) => {
    if (err || row) {
      generateLuckyNumber(callback);
    } else {
      callback(number);
    }
  });
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(userId.toString());
}

// ========== 用户命令 ==========

// 使用字符串匹配代替正则表达式（修复Railway兼容问题）
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  
  // 忽略非文本消息（图片等在这里不处理）
  if (!text) return;
  
  // /start 命令
  if (text === '/start') {
    const welcomeText = `
🎰 **欢迎参加充值大抽奖！** 🎰

💰 **活动规则：**
1️⃣ 充值满 ${MIN_RECHARGE} 元
2️⃣ 发送充值截图给本Bot
3️⃣ 提供你的游戏ID
4️⃣ 获得专属幸运号码（6位数）
5️⃣ 每晚 **${DRAW_TIME}** 自动开奖

🏆 **奖品设置：**
每晚抽取 **${PRIZES_PER_DRAW}** 名幸运儿！

📱 **参与步骤：**
直接发送充值截图即可开始！

⏰ 今晚 ${DRAW_TIME} 即将开奖！
    `;
    bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
    return;
  }
  
  // /status 命令
  if (text === '/status') {
    const tgId = msg.from.id.toString();
    db.get('SELECT * FROM users WHERE tg_id = ?', [tgId], (err, row) => {
      if (!row) {
        bot.sendMessage(chatId, '❌ 您还未参与抽奖\n\n请发送充值截图开始！');
        return;
      }
      
      const statusText = `
📋 **您的参与信息**

🎮 游戏ID: ${row.game_id}
🍀 幸运号码: **${row.lucky_number}**
⏰ 参与时间: ${row.joined_at}
🏆 中奖状态: ${row.is_winner ? '✅ 已中奖！' : '⏳ 等待开奖'}
${row.prize_amount > 0 ? `💰 中奖金额: ${row.prize_amount}元` : ''}

⏰ 每晚 ${DRAW_TIME} 开奖，祝你好运！
      `;
      bot.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
    });
    return;
  }
  
  // 处理游戏ID（3-20位字母数字）
  if (/^[A-Za-z0-9_-]{3,20}$/.test(text) && !text.startsWith('/')) {
    const tgId = msg.from.id.toString();
    const gameId = text.trim();
    
    db.get('SELECT * FROM users WHERE tg_id = ? AND game_id IS NULL', [tgId], (err, row) => {
      if (!row) return;
      
      generateLuckyNumber((luckyNumber) => {
        db.run(
          'UPDATE users SET game_id = ?, lucky_number = ? WHERE tg_id = ?',
          [gameId, luckyNumber, tgId],
          (err) => {
            if (err) {
              bot.sendMessage(chatId, '❌ 处理失败，请重新发送截图');
              return;
            }
            
            bot.sendMessage(chatId, `
🎉 **参与成功！** 🎉

🎮 游戏ID: ${gameId}
🍀 您的幸运号码: **${luckyNumber}**
⏰ **今晚 ${DRAW_TIME} 开奖！**

📤 **邀请好友：**
转发本Bot给好友，一起参与抽奖！
            `, { parse_mode: 'Markdown' });
            
            // 通知管理员
            ADMIN_IDS.forEach(adminId => {
              bot.sendMessage(adminId, `📢 新用户参与\n👤 @${msg.from.username || 'N/A'}\n🎮 ${gameId}\n🍀 ${luckyNumber}`);
            });
          }
        );
      });
    });
    return;
  }
});

// 处理图片（充值截图）
bot.on('photo', (msg) => {
  const chatId = msg.chat.id;
  const tgId = msg.from.id.toString();
  const username = msg.from.username || msg.from.first_name;
  
  db.get('SELECT * FROM users WHERE tg_id = ?', [tgId], (err, row) => {
    if (row) {
      bot.sendMessage(chatId, '⚠️ 您已经参与过了！\n\n您的幸运号码是：' + row.lucky_number);
      return;
    }
    
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;
    
    db.run(
      'INSERT OR REPLACE INTO users (tg_id, username, screenshot_file_id) VALUES (?, ?, ?)',
      [tgId, username, fileId],
      (err) => {
        if (err) {
          bot.sendMessage(chatId, '❌ 处理截图失败，请重试');
          return;
        }
        
        bot.sendMessage(chatId, `
✅ 截图已收到！

🎮 **下一步：请发送您的游戏ID**
（例如：Player123 或 ID:888888）

⚠️ 请确保游戏ID正确，中奖后将以此ID发放奖励！
        `);
      }
    );
  });
});

// ========== 管理员命令 ==========
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  
  if (!isAdmin(msg.from.id)) return;
  
  // /draw - 执行抽奖
  if (text === '/draw') {
    performDraw(chatId);
    return;
  }
  
  // /list - 查看参与者
  if (text === '/list') {
    db.all('SELECT lucky_number, game_id, username FROM users ORDER BY joined_at DESC LIMIT 20', [], (err, rows) => {
      if (!rows || rows.length === 0) {
        bot.sendMessage(chatId, '暂无参与者');
        return;
      }
      
      let listText = '📋 **最近20位参与者**\n\n';
      rows.forEach(row => {
        listText += `🍀 ${row.lucky_number} | 🎮 ${row.game_id}\n`;
      });
      
      bot.sendMessage(chatId, listText, { parse_mode: 'Markdown' });
    });
    return;
  }
  
  // /export - 导出CSV
  if (text === '/export') {
    db.all('SELECT * FROM users', [], (err, rows) => {
      if (!rows || rows.length === 0) {
        bot.sendMessage(chatId, '暂无数据可导出');
        return;
      }
      
      let csv = 'ID,TG_ID,Username,Game_ID,Lucky_Number,Joined_At,Is_Winner,Prize_Amount\n';
      rows.forEach(row => {
        csv += `${row.id},${row.tg_id},${row.username || ''},${row.game_id},${row.lucky_number},${row.joined_at},${row.is_winner},${row.prize_amount}\n`;
      });
      
      fs.writeFileSync('lottery_export.csv', csv);
      bot.sendDocument(chatId, 'lottery_export.csv');
    });
    return;
  }
  
  // /stats - 统计
  if (text === '/stats') {
    db.get('SELECT COUNT(*) as total FROM users', [], (err, totalRow) => {
      db.get('SELECT COUNT(*) as winners FROM users WHERE is_winner = 1', [], (err, winnerRow) => {
        const statsText = `
📊 **活动统计**

👥 总参与人数: ${totalRow.total}
🏆 中奖人数: ${winnerRow.winners}
📈 中奖率: ${totalRow.total > 0 ? ((winnerRow.winners / totalRow.total) * 100).toFixed(1) : 0}%
        `;
        bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
      });
    });
    return;
  }
  
  // /broadcast - 群发消息
  if (text.startsWith('/broadcast ')) {
    const message = text.replace('/broadcast ', '');
    db.all('SELECT DISTINCT tg_id FROM users', [], (err, rows) => {
      let count = 0;
      rows.forEach(row => {
        bot.sendMessage(row.tg_id, message, { parse_mode: 'Markdown' }).catch(() => {});
        count++;
      });
      bot.sendMessage(chatId, `✅ 群发完成，共发送给 ${count} 人`);
    });
    return;
  }
});

// 抽奖函数
function performDraw(chatId) {
  db.all('SELECT * FROM users WHERE is_winner = 0', [], (err, users) => {
    if (!users || users.length === 0) {
      bot.sendMessage(chatId, '❌ 没有可抽奖的参与者');
      return;
    }
    
    const shuffled = users.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, Math.min(PRIZES_PER_DRAW, shuffled.length));
    const drawDate = new Date().toISOString().split('T')[0];
    const prizes = [500, 300, 200, 100, 100];
    
    let winnerText = `🎰 **${drawDate} 抽奖结果** 🎰\n\n🏆 **中奖号码：**\n\n`;
    
    winners.forEach((winner, index) => {
      const prizeAmount = prizes[index] || 100;
      
      db.run('UPDATE users SET is_winner = 1, prize_amount = ? WHERE tg_id = ?', 
        [prizeAmount, winner.tg_id]);
      db.run('INSERT INTO winners (lucky_number, tg_id, game_id, draw_date, prize_amount) VALUES (?, ?, ?, ?, ?)',
        [winner.lucky_number, winner.tg_id, winner.game_id, drawDate, prizeAmount]);
      
      winnerText += `${index + 1}. 🍀 ${winner.lucky_number} - 🎮 ${winner.game_id} - 💰 ${prizeAmount}元\n`;
      
      // 通知中奖者
      bot.sendMessage(winner.tg_id, `
🎉 **恭喜中奖！** 🎉

🍀 您的幸运号码: **${winner.lucky_number}**
💰 中奖金额: **${prizeAmount}元**

📋 请保存此截图作为领奖凭证！
奖励将在24小时内发放到您的游戏账户

🎁 继续充值可参与明日抽奖！
      `, { parse_mode: 'Markdown' });
    });
    
    winnerText += `\n📊 本期参与人数: ${users.length}人\n⏰ 下期抽奖: 明日 ${DRAW_TIME}`;
    
    bot.sendMessage(chatId, winnerText, { parse_mode: 'Markdown' });
  });
}

console.log('🎰 抽奖Bot已启动！');

