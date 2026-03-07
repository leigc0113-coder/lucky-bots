/**
* config.js - 所有可配置项
* 修改规则：改数字、金额、时间，都在这里！
*/

module.exports = {
// ========== 基础设置 ==========
botUsername: process.env.BOT_USERNAME || 'your_bot_name',
drawTime: '20:00',
minRecharge: 100,

// ========== 充值档位配置 ==========
tiers: {
silver: {
code: 'silver',
name: '白银档',
minAmount: 100, // ← 改这里：最低金额
entries: 1, // ← 改这里：给几个号码
emoji: '🥈',
bonusPoints: 0, // ← 改这里：赠送积分
description: '入门级，适合新手体验'
},
gold: {
code: 'gold',
name: '黄金档',
minAmount: 500, // ← 改这里
entries: 6, // ← 改这里
emoji: '🥇',
bonusPoints: 50, // ← 改这里
description: '性价比最高，推荐选择',
recommended: true
},
diamond: {
code: 'diamond',
name: '钻石档',
minAmount: 1000, // ← 改这里
entries: 15, // ← 改这里
emoji: '💎',
bonusPoints: 200, // ← 改这里
description: '超值大礼包，中奖率最高',
hot: true
}
},
// ========== 奖品配置 ==========
prizes: [
{ rank: 1, amount: 500, count: 1, name: '一等奖' }, // ← 改金额
{ rank: 2, amount: 300, count: 1, name: '二等奖' }, // ← 改金额
{ rank: 3, amount: 200, count: 1, name: '三等奖' }, // ← 改金额
{ rank: 4, amount: 100, count: 2, name: '四等奖' } // ← 改金额和数量
],

// ========== 签到配置 ==========
checkin: {
basePoints: 10,
streakBonus: {
3: 50,
7: 150,
14: 400,
30: 1000
}
},

// ========== 邀请配置 ==========
invite: {
inviterPoints: 20,
inviterEntries: 1,
inviteePoints: 10
},

// ========== 功能开关 ==========
features: {
enableCheckin: true,
enableInvite: true,
enableMultipleEntries: true,
autoDraw: true,
adminNotifications: true
}
};
