import assert from "node:assert/strict";
import { buildProfile } from "../src/buildProfile.ts";

// 1. 精英外防：外防 ≥85
{
  const tags = buildProfile({ "Perimeter Defense": 90, "Three-Point Shot": 70, Block: 70 });
  assert.ok(tags.includes("精英外防"), `got: ${tags}`);
  console.log("✅ 精英外防 threshold");
}

// 2. 投射稳定：三分+中投均值 ≥82
{
  const tags = buildProfile({ "Three-Point Shot": 85, "Mid-Range Shot": 80 });
  assert.ok(tags.includes("投射稳定"), `got: ${tags}`);
  console.log("✅ 投射稳定 threshold");
}

// 3. 护框有限：盖帽 <60
{
  const tags = buildProfile({ Block: 45, "Three-Point Shot": 85, "Mid-Range Shot": 80 });
  assert.ok(tags.includes("护框有限"), `got: ${tags}`);
  console.log("✅ 护框有限 threshold");
}

// 4. 双向：外防 ≥80 且三分 ≥78
{
  const tags = buildProfile({ "Perimeter Defense": 82, "Three-Point Shot": 79 });
  assert.ok(tags.includes("双向"), `got: ${tags}`);
  console.log("✅ 双向 threshold");
}

// 5. 组织核心：传球+控球均值 ≥82
{
  const tags = buildProfile({ "Pass Accuracy": 85, "Pass IQ": 80, "Pass Vision": 82, "Ball Handle": 85 });
  assert.ok(tags.includes("组织核心"), `got: ${tags}`);
  console.log("✅ 组织核心 threshold");
}

// 6. 内线屏障：盖帽+篮板均值 ≥82
{
  const tags = buildProfile({ Block: 85, "Offensive Rebound": 80, "Defensive Rebound": 82 });
  assert.ok(tags.includes("内线屏障"), `got: ${tags}`);
  console.log("✅ 内线屏障 threshold");
}

// 7. 多个标签可同时出现
{
  const tags = buildProfile({
    "Perimeter Defense": 90, "Three-Point Shot": 85, "Mid-Range Shot": 82,
    Block: 88, "Offensive Rebound": 80, "Defensive Rebound": 84,
  });
  assert.ok(tags.includes("精英外防") && tags.includes("投射稳定") && tags.includes("双向") && tags.includes("内线屏障"), `got: ${tags}`);
  console.log("✅ multi-tag composition");
}

// 8. 平庸属性 → 无标签
{
  const tags = buildProfile({ "Perimeter Defense": 60, "Three-Point Shot": 60, Block: 60 });
  assert.equal(tags.length, 0, `got: ${tags}`);
  console.log("✅ no tags for mediocre attrs");
}

// 9. 缺失属性不误报（无数值属性返回 null → 不产生标签）
{
  const tags = buildProfile({ "Perimeter Defense": 90 });
  assert.ok(tags.includes("精英外防") && !tags.includes("双向"), `got: ${tags}`);
  console.log("✅ missing attrs do not fabricate tags");
}

console.log("\nALL BUILD-PROFILE CHECKS PASSED");
