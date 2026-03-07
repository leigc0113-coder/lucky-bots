/**
* messages.js - 所有文案配置
* 修改规则：改文字、改欢迎语，都在这里！
*/

module.exports = {
// ========== 欢迎页面 ==========
welcome: (stats, timeLeft) =>
`🎰 ╔══════════════════╗
║ 🎊 欢迎幸运儿 🎊 ║
╚══════════════════╝

💰 累计奖池：¥${stats.totalPrizes}
👥 已有 ${stats.users} 人参与
🎫 已产生 ${stats.numbers} 个号码
⏰ 距离开奖：${timeLeft}

👇 点击下方按钮开始`,

// ========== 菜单按钮文字 ==========
buttons: {
join: '🎮 立即参与',
rules: '📖 活动规则',
prizes: '💰 奖池详情',
status: '📊 我的状态',
checkin: '🎁 每日签到',
invite: '👥 邀请好友',
tiers: '💰 查看档位',
copyLink: '📋 复制链接',
participateAgain: '🔄 再次参与'
},

// ========== 参与引导 ==========
joinGuide: (minAmount) =>
`📱 参与只需3步：

1️⃣ 游戏内充值（最低¥${minAmount}元）
2️⃣ 截图发送给我
3️⃣ 选择档位，获得幸运号码

⏰ 每晚8点开奖！

✅ 直接发送充值截图开始！`,
// ========== 规则说明 ==========
rules: (tiersText, prizeText, drawTime) =>
`📋 活动规则

💰 充值档位：
${tiersText}

🏆 每晚奖品：
${prizeText}

⏰ 开奖时间：每晚 ${drawTime}
👥 邀请奖励：双方都有积分奖励！`,

// ========== 档位说明模板 ==========
tierDescription: (tier) =>
`${tier.emoji} ${tier.name} ¥${tier.minAmount}
→ ${tier.entries}个幸运号码
${tier.bonusPoints > 0 ? `→ 额外送${tier.bonusPoints}积分` : ''}
${tier.recommended ? '⭐️推荐' : ''}
${tier.hot ? '🔥超值' : ''}`,

// ========== 奖品说明模板 ==========
prizeDescription: (prize) =>
`${prize.rank === 1 ? '🥇' : prize.rank === 2 ? '🥈' : prize.rank === 3 ? '🥉' : '🎖️'} ${prize.name}：¥${prize.amount} × ${prize.count}`,

// ========== 参与成功 ==========
participateSuccess: (data) =>
`🎉 参与成功！

🎮 游戏ID：${data.gameId}
🎯 档位：${data.tierEmoji} ${data.tierName}
🍀 幸运号码：${data.numbers}
${data.bonusPoints > 0 ? `💎 赠送积分：+${data.bonusPoints}` : ''}

⏰ 每晚 ${data.drawTime} 开奖！
📌 保存此消息，开奖时对照！

💡 小贴士：
• 邀请好友参与得额外奖励
• 每日签到领积分
• 关注公告获取活动资讯`,
// ========== 签到成功 ==========
checkinSuccess: (data) =>
`✅ 签到成功！

📅 连续签到：${data.streak}天
💰 基础奖励：10积分
${data.bonus > 0 ? `🎁 连续${data.streak}天额外奖励：+${data.bonus}积分` : ''}

💎 总积分：+${data.totalPoints}`,

  // ========== 邀请页面 ==========
  invitePage: (data) => 
`👥 邀请好友，双赢奖励！

🔗 您的专属链接：
${data.inviteLink}

🎁 奖励机制：
• 好友通过您的链接参与
• 您获得：${data.inviterPoints}积分 + ${data.inviterEntries}个名额
• 好友获得：${data.inviteePoints}积分欢迎奖

📊 我的邀请：
• 已邀请：${data.inviteCount}人
• 累计奖励：${data.totalEarned}积分

📤 分享链接给好友，一起参与！`,

  // ========== 用户状态 ==========
  userStatus: (data) => 
`📊 我的账户

🎮 游戏ID：${data.gameId || '未设置'}
💎 积分：${data.points}
🎫 持有号码：${data.totalNumbers}个
🏆 中奖：${data.wonNumbers}次
💰 累计奖金：¥${data.totalPrize}
📅 连续签到：${data.checkinStreak}天
👥 邀请好友：${data.inviteCount}人

🍀 最近号码：
${data.numberList}

⏰ ${data.timeLeft}后开奖`,

  // ========== 中奖通知 ==========
  winNotification: (data) => 
`🎉🎉🎉 恭喜中奖！🎉🎉🎉

╔════════════════════╗
║   🏆 ${data.prizeName} 🏆   ║
║                    ║
║   ¥ ${data.amount}          ║
║                    ║
║ 幸运号码：${data.number}   ║
╚════════════════════╝

👤 游戏ID：${data.gameId}
💰 中奖金额：¥${data.amount}
⏰ 开奖时间：${data.date}

📋 领奖说明：
1. 保存此消息作为凭证
2. 奖励将在24小时内发放
3. 如有疑问请联系客服

🎁 继续充值可参与明日抽奖！`,

  // ========== 错误提示 ==========
  errors: {
    alreadyParticipated: '⚠️ 您已经参与过了！\n\n您的幸运号码是：{number}',
    notParticipated: '❌ 您还未参与活动\n\n点击 🎮 立即参与 开始！',
    alreadyCheckedIn: '⚠️ 您今天已经签到过了！明天再来吧~',
    invalidGameId: '❌ 游戏ID格式不正确，请输入3-20位字母数字',
    noPermission: '❌ 无权操作',
    noParticipants: '❌ 没有可抽奖的号码',
    screenshotFailed: '❌ 处理截图失败，请重试'
  }
};
