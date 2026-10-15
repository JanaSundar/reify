/** Representative user-written DSA programs. Each prints observable results. */
export const CORPUS: Record<string, string> = {
  nestedLoops: `
const n = 4;
let pairs = 0;
for (let i = 0; i < n; i++) {
  for (let j = i + 1; j < n; j++) {
    pairs++;
  }
}
console.log(pairs);`,

  fibonacci: `
function fib(n) {
  if (n < 2) return n;
  return fib(n - 1) + fib(n - 2);
}
console.log(fib(10));`,

  binarySearch: `
function search(nums, target) {
  let lo = 0, hi = nums.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nums[mid] === target) return mid;
    if (nums[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
console.log(search([1, 3, 5, 7, 9, 11], 7), search([1, 2], 5));`,

  slidingWindow: `
function maxSum(nums, k) {
  let sum = 0, best = -Infinity;
  for (let r = 0; r < nums.length; r++) {
    sum += nums[r];
    if (r >= k - 1) {
      best = Math.max(best, sum);
      sum -= nums[r - k + 1];
    }
  }
  return best;
}
console.log(maxSum([2, 1, 5, 1, 3, 2], 3));`,

  arrayMutations: `
const a = [5, 3, 8, 1];
a[0] = 10;
a[a.length] = 7;
a.push(2);
a.sort((x, y) => x - y);
const last = a.pop();
a.splice(1, 2, 99);
a.reverse();
a[1] += 5;
a[2]++;
[a[0], a[1]] = [a[1], a[0]];
console.log(a, last, a.length);`,

  objectMutations: `
const counts = {};
for (const ch of "banana") {
  counts[ch] = (counts[ch] || 0) + 1;
}
counts.total = 6;
delete counts.n;
const merged = Object.assign({}, counts, { extra: true });
console.log(counts, merged);`,

  aliasing: `
const a = [1, 2];
const b = a;
b.push(3);
const o = { list: a };
o.list[0] = 100;
console.log(a, b === a, o);`,

  linkedList: `
class ListNode {
  constructor(val, next = null) { this.val = val; this.next = next; }
}
function build(values) {
  let head = null;
  for (let i = values.length - 1; i >= 0; i--) head = new ListNode(values[i], head);
  return head;
}
function reverse(head) {
  let prev = null, cur = head;
  while (cur) {
    const next = cur.next;
    cur.next = prev;
    prev = cur;
    cur = next;
  }
  return prev;
}
let node = reverse(build([1, 2, 3, 4]));
const out = [];
while (node) { out.push(node.val); node = node.next; }
console.log(out.join("->"));`,

  treeTraversal: `
function insert(root, v) {
  if (!root) return { v, left: null, right: null };
  if (v < root.v) root.left = insert(root.left, v);
  else root.right = insert(root.right, v);
  return root;
}
function inorder(node, acc) {
  if (!node) return acc;
  inorder(node.left, acc);
  acc.push(node.v);
  inorder(node.right, acc);
  return acc;
}
let root = null;
for (const v of [5, 3, 8, 1, 4, 9]) root = insert(root, v);
console.log(inorder(root, []));`,

  bfs: `
const graph = new Map([[1, [2, 3]], [2, [4]], [3, [4]], [4, []]]);
const seen = new Set([1]);
const queue = [1];
const order = [];
while (queue.length > 0) {
  const node = queue.shift();
  order.push(node);
  for (const next of graph.get(node)) {
    if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
}
console.log(order, seen);`,

  memoDp: `
const memo = new Map();
function climb(n) {
  if (n <= 2) return n;
  if (memo.has(n)) return memo.get(n);
  const r = climb(n - 1) + climb(n - 2);
  memo.set(n, r);
  return r;
}
const dp = new Array(6).fill(0);
dp[0] = 1;
for (let i = 1; i < dp.length; i++) dp[i] = dp[i - 1] * 2;
console.log(climb(20), dp, memo.size);`,

  closures: `
function counter() {
  let count = 0;
  return () => ++count;
}
const next = counter();
next(); next();
const fns = [];
for (let i = 0; i < 3; i++) fns.push(() => i);
console.log(next(), fns.map((f) => f()));`,

  shadowing: `
let x = 1;
{
  let x = 2;
  console.log(x);
}
function f(x) { x = x * 10; return x; }
console.log(x, f(3), x);`,

  exceptionsFinally: `
const log = [];
function risky(n) {
  try {
    if (n > 1) throw new Error("too big: " + n);
    log.push("ok " + n);
    return n;
  } finally {
    log.push("finally " + n);
  }
}
for (const n of [1, 2]) {
  try { risky(n); } catch (e) { log.push(e.message); }
}
console.log(log);`,

  shortCircuitOrder: `
const order = [];
const t = (v) => { order.push(v); return v; };
const r1 = t(0) && t(1);
const r2 = t(2) || t(3);
const r3 = t(null) ?? t(4);
const obj = { a: 1 };
obj[t("k")] = t("v");
const r4 = t(true) ? t("yes") : t("no");
console.log(order, r1, r2, r3, r4, obj);`,

  cyclicGraph: `
const a = { name: "a" };
const b = { name: "b", next: a };
a.next = b;
a.self = a;
console.log(a.next.next === a, Object.keys(a));`,

  switchAndLabels: `
let hits = 0;
outer: for (let i = 0; i < 5; i++) {
  for (let j = 0; j < 5; j++) {
    if (j === 3) continue outer;
    if (i === 3) break outer;
    hits++;
  }
}
function kind(n) {
  switch (n % 3) {
    case 0: return "fizz";
    case 1: return "one";
    default: return "other";
  }
}
console.log(hits, [3, 4, 5].map(kind));`,

  doWhileAndUpdate: `
let i = 0, total = 0;
do { total += i; i++; } while (i < 5);
let k = 10;
const post = k--;
const pre = --k;
console.log(total, post, pre, k);`,

  stringsAndMath: `
const s = "hello world";
const words = s.split(" ").map((w) => w[0].toUpperCase() + w.slice(1));
const freq = {};
for (const c of s.replace(" ", "")) freq[c] = (freq[c] ?? 0) + 1;
console.log(words.join(" "), Math.max(...Object.values(freq)), 7 / 2, -0, NaN, 10n ** 3n);`,

  uncaught: `
function boom(x) { return x.y.z; }
console.log("before");
boom({});`,
};

export const TYPESCRIPT_CORPUS: Record<string, string> = {
  typedTwoSum: `
interface Pair { i: number; j: number }
function twoSum(nums: number[], target: number): Pair | null {
  const seen = new Map<number, number>();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i]!;
    if (seen.has(need)) return { i: seen.get(need)!, j: i };
    seen.set(nums[i]!, i);
  }
  return null;
}
enum Color { Red, Green }
const result = twoSum([2, 7, 11, 15], 9) as Pair;
console.log(result, Color.Green);`,
};
