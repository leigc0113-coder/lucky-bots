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
bronze: {
code: 'bronze',
name: '青铜档',
minAmount: 100,
entries: 1,
emoji: '🥉',
bonusPoints: 0,
description: '入门体验'
},
silver300: { // 新增300档
code: 'silver300',
name: '白银档',
minAmount: 300,
entries: 3,
emoji: '🥈',
bonusPoints: 10,
description: '小额参与'
},
gold: {
code: 'gold',
name: '黄金档',
minAmount: 500,
entries: 6,
emoji: '🥇',
bonusPoints: 50,
description: '性价比最高',
recommended: true
},
diamond: {
code: 'diamond',
name: '钻石档',
minAmount: 1000,
entries: 15,
emoji: '💎',
bonusPoints: 200,
description: '超值大礼包',
hot: true
},
platinum2k: { // 新增2000档
code: 'platinum2k',
name: '铂金档',
minAmount: 2000,
entries: 35,
emoji: '🔷',
bonusPoints: 500,
description: '大额优惠'
},
vip5k: { // 新增5000档
code: 'vip5k',
name: 'VIP档',
minAmount: 5000,
entries: 90,
emoji: '👑',
bonusPoints: 1500,
description: '尊享特权'
},
supreme10k: { // 新增10000档
code: 'supreme10k',
name: '至尊档',
minAmount: 10000,
entries: 200,
emoji: '🏆',
bonusPoints: 4000,
description: '土豪专属'
},
king20k: { // 新增20000档
code: 'king20k',
name: '王者档',
minAmount: 20000,
entries: 500,
emoji: '👑',
bonusPoints: 10000,
description: '王者风范'
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

