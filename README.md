# 🎰 充值抽奖Bot

## 部署步骤

### 1. 创建Bot
- Telegram搜索 @BotFather
- 发送 /newbot
- 保存Token

### 2. 获取你的TG ID
- 搜索 @userinfobot
- 发送 /start
- 保存Id数字

### 3. 部署到Railway
- 访问 railway.app
- 用GitHub登录
- New Project → Deploy from GitHub repo
- 上传本项目
- 设置环境变量：
  - BOT_TOKEN = 你的Token
  - ADMIN_IDS = 你的TG ID

### 4. 测试
- 给你的Bot发送 /start
- 应该收到欢迎消息

## 管理员命令
- /draw - 执行抽奖
- /list - 查看参与者
- /export - 导出CSV
- /stats - 查看统计
- /broadcast 消息 - 群发

## 用户流程
1. 发送充值截图
2. Bot要求游戏ID
3. 发送游戏ID
4. 获得幸运号码
5. 每晚8点自动开奖
