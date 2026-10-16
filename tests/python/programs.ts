/** Python DSA-style programs: instrumentation must not change their output. */
export const PYTHON_PROGRAMS: Readonly<Record<string, string>> = {
  "two sum": `
def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
    return None

print(two_sum([2, 7, 11, 15], 9), two_sum([1, 2], 7))
`,
  "memoized recursion": `
from functools import cache

def fib(n, memo={}):
    if n in memo:
        return memo[n]
    if n < 2:
        return n
    memo[n] = fib(n - 1) + fib(n - 2)
    return memo[n]

@cache
def ways(n):
    return 1 if n <= 1 else ways(n - 1) + ways(n - 2)

print(fib(40), ways(30))
`,
  "linked list and tree classes": `
class ListNode:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val, self.left, self.right = val, left, right

def reverse(head):
    prev = None
    while head:
        head.next, prev, head = prev, head, head.next
    return prev

def depth(node):
    if not node:
        return 0
    return 1 + max(depth(node.left), depth(node.right))

head = reverse(ListNode(1, ListNode(2, ListNode(3))))
values = []
while head:
    values.append(head.val)
    head = head.next
root = TreeNode(1, TreeNode(2, TreeNode(4)), TreeNode(3))
root.left.val *= 10
print(values, depth(root), root.left.val)
`,
  "collections and heaps": `
import heapq
from bisect import insort
from collections import Counter, defaultdict, deque

h = []
for v in [5, 1, 4, 2]:
    heapq.heappush(h, v)
smallest = [heapq.heappop(h) for _ in range(2)]
q = deque([1, 2, 3])
q.appendleft(0)
q.rotate(1)
groups = defaultdict(list)
for word in ["ab", "ba", "cd"]:
    groups["".join(sorted(word))].append(word)
s = []
for x in [3, 1, 2]:
    insort(s, x)
print(smallest, h, list(q), dict(groups), s, Counter("banana").most_common(1))
`,
  "assignment targets and order": `
log = []
class Box:
    def __init__(self):
        self.items = [0, 0, 0]
    def get(self):
        log.append("box")
        return self

def key(k):
    log.append(f"key{k}")
    return k

def value(v):
    log.append(f"value{v}")
    return v

b = Box()
b.get().items[key(1)] = value(5)
a, (c, *rest) = 1, (2, 3, 4)
xs = [5, 3, 1]
xs[0], xs[2] = xs[2], xs[0]
xs[1:2] = [9, 9]
xs[0] += 100
grid = [[0] * 2 for _ in range(2)]
grid[1][0] = 7
del xs[-1]
m = {"k": 1}
m["k"] += 1
del m["k"]
print(log, b.items, a, c, rest, xs, grid, m)
`,
  "control flow": `
total = 0
i = 0
while i < 10:
    i += 1
    if i % 2 == 0:
        continue
    elif i == 9:
        break
    total += i
else:
    total = -1

for n in range(3):
    pass
else:
    total += 100

def classify(value):
    match value:
        case {"k": [first, *others]}:
            return ("dict", first, others)
        case [x, y] if x < y:
            return ("pair", x, y)
        case _:
            return ("other",)

if (count := len([1, 2, 3])) > 2:
    total += count
print(total, classify({"k": [1, 2]}), classify([1, 2]), classify(3))
`,
  "exceptions and scopes": `
def risky(n):
    try:
        if n == 0:
            raise ValueError("zero")
        return 10 // n
    except ValueError as error:
        return str(error)
    finally:
        print("checked", n)

def counter():
    count = 0
    def increment():
        nonlocal count
        count += 1
        return count
    return increment

G = 0
def bump():
    global G
    G += 5

class Stack:
    def __init__(self):
        self.__items = []
    def push(self, x):
        self.__items.append(x)
    def pop(self):
        return self.__items.pop()

inc = counter()
inc()
bump()
st = Stack()
st.push(1)
st.push(2)
try:
    risky(None)
except TypeError as error:
    print("type error")
print(risky(0), risky(5), inc(), G, st.pop(), sorted([3, 1, 2], key=lambda v: -v))
`,
  "uncaught exception": `
def divide(a, b):
    return a / b

print("before")
divide(1, 0)
`,
};
