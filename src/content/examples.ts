/**
 * Built-in examples: shown in the playground sidebar and linked from the landing page
 * (`/playground?example=<id>`). Each is a complete program the engine traces as-is.
 */
export interface Example {
  readonly id: string;
  readonly fileName: string;
  readonly title: string;
  readonly summary: string;
  readonly source: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: "getting-started",
    fileName: "getting-started.js",
    title: "Getting started",
    summary: "Variables, a loop and console output.",
    source: `// Welcome to reify! Press Run (Ctrl+Enter), then step through the execution.
let total = 0;
const prices = [4, 8, 15];

for (const price of prices) {
  total += price;
}

console.log("Total:", total);
`,
  },
  {
    id: "array-map",
    fileName: "array-map.js",
    title: "Array transformation",
    summary: "See how map, filter and reduce work.",
    source: `const numbers = [2, 4, 6];

const doubled = numbers.map((n, i) => {
  console.log(\`Processing index \${i}\`);
  return n * 2;
});

console.log(doubled);
`,
  },
  {
    id: "fibonacci",
    fileName: "fibonacci.js",
    title: "Function calls",
    summary: "Step through recursive function execution.",
    source: `function fibonacci(n) {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(5);
console.log(result);
`,
  },
  {
    id: "binary-search",
    fileName: "binary-search.js",
    title: "Binary search",
    summary: "Watch the search window halve each step.",
    source: `function binarySearch(items, target) {
  let low = 0;
  let high = items.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (items[mid] === target) return mid;
    if (items[mid] < target) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

const sorted = [1, 3, 5, 7, 9, 11, 13];
console.log(binarySearch(sorted, 11));
`,
  },
  {
    id: "object-reference",
    fileName: "object-reference.js",
    title: "Objects & references",
    summary: "Understand memory and references.",
    source: `const user = { name: "Jana" };
const admin = user;

admin.name = "Developer";

console.log(user.name); // same object in memory
`,
  },
  {
    id: "closure",
    fileName: "closure.js",
    title: "Closures",
    summary: "Functions that remember their scope.",
    source: `function makeCounter() {
  let count = 0;
  return function increment() {
    count += 1;
    return count;
  };
}

const counter = makeCounter();
counter();
counter();
console.log(counter());
`,
  },
];

export const findExample = (id: string | null): Example | undefined =>
  EXAMPLES.find((example) => example.id === id);
