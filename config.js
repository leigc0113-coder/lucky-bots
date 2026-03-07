/**
 * config.js - 配置文件
 * 修改规则：改金额、改档位、改奖品，都在这里！
 */

module.exports = {
  // ========== 基础设置 ==========
  botUsername: process.env.BOT_USERNAME || 'your_bot_name',
  drawTime: '20:00',
  minRecharge: 100,

  // ========== 充值档位配置（8个档位） ==========
  tiers: {
    // 第1档：青铜档 ¥100
    bronze: {
      code: 'bronze',
      name: '青铜档',
      minAmount: 100,
      entries: 1,
      emoji: '🥉',
      bonusPoints: 0,
      description: '入门体验'
    },
    
    // 第2档：白银档 ¥300（新增）
    silver300: {
      code: 'silver300',
      name: '白银档',
      minAmount: 300,
      entries: 3,
      emoji: '🥈',
      bonusPoints: 10,
      description: '小额参与'
    },
    
    // 第3档：黄金档 ¥500
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
    
    // 第4档：钻石档 ¥1000
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
    
    // 第5档：铂金档 ¥2000（新增）
    platinum2k: {
      code: 'platinum2k',
      name: '铂金档',
      minAmount: 2000,
      entries: 35,
      emoji: '🔷',
      bonusPoints: 500,
      description: '大额优惠'
    },
    
    // 第6档：VIP档 ¥5000（新增）
    vip5k: {
      code: 'vip5k',
      name: 'VIP档',
      minAmount: 5000,
      entries: 90,
      emoji: '👑',
      bonusPoints: 1500,
      description: '尊享特权'
    },
    
    // 第7档：至尊档 ¥10000（新增）
    supreme10k: {
      code: 'supreme10k',
      name: '至尊档',
      minAmount: 10000,
      entries: 200,
      emoji: '🏆',
      bonusPoints: 4000,
      description: '土豪专属'
    },
    
    // 第8档：王者档 ¥20000（新增）
    king20k: {
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
    { rank: 1, amount: 500, count: 1, name: '一等奖' },
    { rank: 2, amount: 300, count: 1, name: '二等奖' },
    { rank: 3, amount: 200, count: 1, name: '三等奖' },
    { rank: 4, amount: 100, count: 2, name: '四等奖' }
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
