// 测试共用的样本路径（真实 asar；缺失时相关用例自动跳过）
import process from 'node:process'

export const ASAR_PATH =
  process.env.DSH_ASAR ||
  'C:\\Users\\hanxiang\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar'
