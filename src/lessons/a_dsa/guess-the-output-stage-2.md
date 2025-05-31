# Tricky Python Output Questions

## Question 1
```python
x = [1, 2, 3]
y = x
y.append(4)
print(x)
```

## Question 2
```python
def func(a=[]):
    a.append(5)
    return a
print(func())
print(func())
print(func())
```

## Question 3
```python
x = True
y = False
z = False
if x or y and z:
    print("True")
else:
    print("False")
```

## Question 4
```python
list1 = [1, 2, 3, 4]
list2 = list1[::-1]
list3 = list1[:]
list1[1] = 5
print(list2)
print(list3)
```

## Question 5
```python
a = 256
b = 256
c = 257
d = 257
print(a is b)
print(c is d)
```

## Question 6
```python
print(0.1 + 0.2 == 0.3)
print(round(0.1 + 0.2, 1) == 0.3)
```

## Question 7
```python
x = [i for i in range(3)]
for i in x:
    x.append(i)
    print(i)
    if len(x) > 6:
        break
```

## Question 8
```python
def multiply(x, times = 2):
    return x * times

print(multiply('python'))
print(multiply([1, 2]))
```

## Question 9
```python
set1 = {1, 2, 3}
set2 = set1
set2.add(4)
print(len(set1))
print(set1 is set2)
```

## Question 10
```python
dict1 = {'a': 1, 'b': 2}
dict2 = dict1.copy()
dict3 = dict1
dict1['c'] = 3
print(dict2)
print(dict3)
```

## Question 11
```python
a = [1, 2, 3]
b = [1, 2, 3]
c = [a, b]
a.append(4)
print(c)
```

## Question 12
```python
x = 5
def outer():
    x = 3
    def inner():
        print(x)
    x = 7
    return inner

func = outer()
func()
```

## Question 13
```python
nums = [1, 2, 3, 4]
squared = (x*x for x in nums)
nums = [5, 6, 7, 8]
print(list(squared))
```

## Question 14
```python
def weird_sum(a, b, c=3):
    return a + b if c > 2 else a - b

print(weird_sum(b=3, a=7))
print(weird_sum(b=3, a=7, c=1))
```

## Question 15
```python
text = "hello"
chars = list(text)
chars[0] = 'H'
print(''.join(chars))
print(text)
```

## Question 16
```python
numbers = {1, 2, 3, 4, 5}
squares = {num**2 for num in numbers if num % 2 == 0}
print(squares | {4})
```

## Question 17
```python
def change_list(lst):
    lst += [4, 5]
    lst = lst + [6, 7]
    return lst

my_list = [1, 2, 3]
result = change_list(my_list)
print(my_list)
print(result)
```

## Question 18
```python
class Counter:
    count = 0
    def __init__(self):
        Counter.count += 1

a = Counter()
b = Counter()
c = Counter()
print(a.count)
print(b.count)
```

## Question 19
```python
items = [1, 2, 3]
for item in items:
    if item == 2:
        items.remove(item)
print(items)
```

## Question 20
```python
def func(*args, **kwargs):
    print(len(args), len(kwargs))

func(1, 2, a=3, b=4, *(5, 6), **{'c': 7})
```

## Question 21
```python
x = [1, 2, 3]
y = [x] * 3
x[0] = 10
print(y)
```

## Question 22
```python
def decorator(func):
    func.count = 0
    def wrapper(*args, **kwargs):
        func.count += 1
        return func(*args, **kwargs)
    return wrapper

@decorator
def greet(): pass

greet()
greet()
print(greet.count)
```

## Question 23
```python
a = [1, 2, 3]
b = a
a = [4, 5, 6]
print(b)
```

## Question 24
```python
class A:
    x = 1
    def __init__(self):
        self.x = 2
        
class B(A):
    def __init__(self):
        pass
        
print(B().x)
```

## Question 25
```python
def f(x=[]):
    x.append(1)
    return sum(x)

print(f())
print(f())
print(f([2]))
print(f())
```

## Question 26
```python
x = 'global'
def outer():
    x = 'outer'
    def inner():
        global x
        x = 'inner'
    inner()
    print(x)
outer()
print(x)
```

## Question 27
```python
nums = [1, 2, 3, 4]
result = filter(lambda x: x % 2, map(lambda x: x * 2, nums))
print(list(result))
```

## Question 28
```python
class MyClass:
    def __bool__(self):
        return False
    def __len__(self):
        return 1

obj = MyClass()
print(bool(obj))
if obj:
    print("Yes")
else:
    print("No")
```

## Question 29
```python
def gen():
    yield from range(3)
    return "Done"

g = gen()
print(list(g))
```

## Question 30
```python
a = {1, 2, 3}
b = frozenset([1, 2, 3])
c = frozenset([1, 2, 3])
print(a == b)
print(b is c)
```

## Question 31
```python
x = [1, 2, 3]
y = x
x += [4]
print(y)
x = x + [5]
print(y)
```

## Question 32
```python
def func(x):
    return x + 1 if x < 5 else x - 1 if x < 10 else x

print(func(3), func(7), func(11))
```

## Question 33
```python
class Counter:
    def __init__(self, start=0):
        self.count = start
    def __add__(self, other):
        return Counter(self.count + other)
    def __str__(self):
        return str(self.count)

c = Counter(5)
print(c + 3)
print(3 + c)
```

## Question 34
```python
d = {'a': 1, 'b': 2}
try:
    print(d['c'])
except KeyError as e:
    d['c'] = 3
finally:
    print(d['c'])
print(d)
```

## Question 35
```python
from collections import defaultdict

d = defaultdict(list)
d['a'].append(1)
print(d['b'])
print(dict(d))
```

## Question 36
```python
def make_multiplier(x):
    return lambda y: x * y

double = make_multiplier(2)
triple = make_multiplier(3)
print(double(triple(2)))
```

## Question 37
```python
class A:
    def method(self):
        return 1

class B(A):
    def method(self):
        return 2 + super().method()

class C(A):
    def method(self):
        return 3 + super().method()

class D(B, C):
    pass

print(D().method())
```

## Question 38
```python
import itertools
numbers = [1, 2, 3]
result = list(itertools.chain(*zip(numbers, numbers)))
print(result)
```

## Question 39
```python
def strange_sort(lst):
    return sorted(lst, key=str)

print(strange_sort([1, 10, 2, 20, 3, 30]))
```

## Question 40
```python
class Wrapper:
    def __init__(self, value):
        self.value = value
    def __eq__(self, other):
        return self.value is other.value

a = Wrapper([1, 2, 3])
b = Wrapper([1, 2, 3])
c = Wrapper(a.value)
print(a == b)
print(a == c)
```
