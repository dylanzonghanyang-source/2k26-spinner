import type { BadgeTier } from "./domain";

// English keys stay aligned with the source data; all user-facing text uses Chinese.
export const badgeNameCN: Record<string, string> = {
  "Deadeye": "神射手",
  "Limitless Range": "射程无限",
  "Mini Marksman": "迷你射手",
  "Set Shot Specialist": "定位投篮专家",
  "Shifty Shooter": "运投高手",

  "Ankle Assassin": "脚踝杀手",
  "Bail Out": "应变大师",
  "Break Starter": "一传大师",
  "Dimer": "十美分",
  "Handles For Days": "运球老手",
  "Lightning Launch": "闪电启动",
  "Strong Handle": "强力控球",
  "Unpluckable": "护球大师",
  "Versatile Visionary": "球场视野",

  "Aerial Wizard": "空中作业",
  "Float Game": "抛投高手",
  "Hook Specialist": "勾手专家",
  "Layup Mixmaster": "花式上篮手",
  "Paint Prodigy": "内线上篮高手",
  "Physical Finisher": "对抗上篮手",
  "Post Fade Phenom": "背身投篮大师",
  "Post Powerhouse": "背身对抗高手",
  "Post-Up Poet": "背身单打诗人",
  "Posterizer": "隔扣达人",
  "Rise Up": "强硬篮下",

  "Challenger": "防守干扰",
  "Glove": "持球抢断大师",
  "High-Flying Denier": "高飞干扰者",
  "Immovable Enforcer": "稳健防守者",
  "Interceptor": "拦截者",
  "Off-Ball Pest": "无球跑位杀手",
  "On-Ball Menace": "持球防守大师",
  "Paint Patroller": "禁区巡逻员",
  "Pick Dodger": "挡拆躲闪者",
  "Post Lockdown": "背身封防者",

  "Boxout Beast": "卡位怪兽",
  "Rebound Chaser": "冲板大师",

  "Brick Wall": "铜墙铁壁",
  "Pogo Stick": "弹跳大师",
  "Slippery Off-Ball": "无球跑位",
};

export const badgeTierCN: Record<BadgeTier, string> = {
  HOF: "名人堂",
  Gold: "金",
  Silver: "银",
  Bronze: "铜",
};

export function getBadgeNameCN(name: string): string {
  return badgeNameCN[name] ?? "未知徽章";
}
