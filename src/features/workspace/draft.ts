import type { TestSuite } from "@/engine/core/protocol/testing";

/** The starter program and test suite of a fresh workspace (its `index.js`). */
export const STARTER_SOURCE = `// Write your own solution, then press Run (Ctrl+Enter).
function twoSum(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return null;
}

console.log(twoSum([2, 7, 11, 15], 18));
`;

export const STARTER_SUITE: TestSuite = {
  entry: "twoSum",
  target: "return",
  cases: [
    { id: "starter-1", args: "[2, 7, 11, 15], 9", expected: "[0, 1]" },
    { id: "starter-2", args: "[3, 2, 4], 6", expected: "[1, 2]" },
    { id: "starter-3", args: "Array.from({ length: 40 }, (_, i) => i), 77", expected: "[38, 39]" },
    {
      id: "starter-4",
      args: "Array.from({ length: 160 }, (_, i) => i), 317",
      expected: "[158, 159]",
    },
  ],
};
