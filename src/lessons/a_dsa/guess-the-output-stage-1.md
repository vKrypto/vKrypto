# Beginner-Friendly Python Questions

## Question 1
```python
x = 5
y = 2
print(x + y * 3)
```

## Question 2
```python
name = "Python"
print("Hello " + name)
print("Hello", name)
```

## Question 3
```python
number = 7
if number > 5:
    print("Big")
else:
    print("Small")
```

## Question 4
```python
count = 1
while count <= 3:
    print(count)
    count = count + 1
```

## Question 5
```python
fruits = ["apple", "banana", "cherry"]
fruits[0] = "orange"
print(fruits)
```

## Question 6
```python
text = "Hello"
print(text[0])
print(text[1])
```

## Question 7
```python
numbers = [1, 2, 3]
numbers.append(4)
numbers.append(5)
print(numbers[2])
```

## Question 8
```python
age = 20
message = "Adult" if age >= 18 else "Child"
print(message)
```

## Question 9
```python
word = "Python"
print(len(word))
print(word.upper())
```

## Question 10
```python
numbers = [1, 2, 3, 4, 5]
total = 0
for num in numbers:
    total = total + num
print(total)
```

## Question 11
```python
def greet(name):
    return "Hi " + name

message = greet("Alice")
print(message)
```

## Question 12
```python
numbers = [1, 2, 3]
letters = ["a", "b", "c"]
combined = numbers + letters
print(combined)
```

## Question 13
```python
text = "banana"
count = 0
for letter in text:
    if letter == "a":
        count = count + 1
print(count)
```

## Question 14
```python
numbers = [1, 2, 3, 2, 1]
unique_numbers = list(set(numbers))
print(unique_numbers)
```

## Question 15
```python
score = 85
if score >= 90:
    print("A")
elif score >= 80:
    print("B")
else:
    print("C")
```

## Question 16
```python
def double(number):
    return number * 2

result = double(5)
print(result)
print(double(result))
```

## Question 17
```python
text = "Hello World"
words = text.split()
print(words)
print(len(words))
```

## Question 18
```python
numbers = [1, 2, 3, 4, 5]
first = numbers[0]
last = numbers[-1]
print(first + last)
```

## Question 19
```python
colors = ["red", "blue", "green"]
for i in range(len(colors)):
    print(i, colors[i])
```

## Question 20
```python
info = {"name": "John", "age": 25}
print(info["name"])
info["age"] = 26
print(info["age"])
```

## Question 21
```python
word = "Hello"
reversed_word = word[::-1]
print(reversed_word)
```

## Question 22
```python
numbers = [10, 20, 30, 40, 50]
print(numbers[1:4])
print(numbers[::2])
```

## Question 23
```python
def is_even(num):
    return num % 2 == 0

print(is_even(4))
print(is_even(7))
```

## Question 24
```python
fruits = ["apple", "banana", "cherry"]
vegetables = ["carrot", "potato"]
food = fruits + vegetables
print(len(food))
```

## Question 25
```python
number = 5
for i in range(1, 4):
    number = number + i
print(number)
```

## Question 26
```python
text = "python is fun"
capitalized = text.title()
print(capitalized)
```

## Question 27
```python
numbers = [1, 2, 3, 4, 5]
numbers.insert(1, 10)
print(numbers)
numbers.remove(3)
print(numbers)
```

## Question 28
```python
word = "banana"
print(word.replace("a", "o"))
print(word)
```

## Question 29
```python
numbers = [1, 2, 3]
copy_numbers = numbers.copy()
numbers[0] = 10
print(copy_numbers)
```

## Question 30
```python
def multiply(a, b=2):
    return a * b

print(multiply(5))
print(multiply(5, 3))
```

## Question 31
```python
text = "Hello-World-Python"
parts = text.split("-")
result = " ".join(parts)
print(result)
```

## Question 32
```python
numbers = [5, 2, 8, 1, 9]
sorted_nums = sorted(numbers)
print(sorted_nums)
print(numbers)
```

## Question 33
```python
count = 0
while count < 3:
    if count == 1:
        count = count + 1
        continue
    print(count)
    count = count + 1
```

## Question 34
```python
def check_number(x):
    if x > 0:
        return "Positive"
    elif x < 0:
        return "Negative"
    else:
        return "Zero"

print(check_number(-5))
```

## Question 35
```python
names = ["Alice", "Bob", "Charlie"]
ages = [25, 30, 35]
for i in range(len(names)):
    print(names[i], "is", ages[i])
```

## Question 36
```python
text = "Python"
result = ""
for char in text:
    result = char + result
print(result)
```

## Question 37
```python
numbers = [1, 2, 3, 4, 5]
even_count = 0
odd_count = 0
for num in numbers:
    if num % 2 == 0:
        even_count = even_count + 1
    else:
        odd_count = odd_count + 1
print(even_count, odd_count)
```

## Question 38
```python
def find_max(a, b, c):
    if a >= b and a >= c:
        return a
    elif b >= a and b >= c:
        return b
    else:
        return c

print(find_max(3, 7, 5))
```

## Question 39
```python
word = "programming"
vowels = "aeiou"
count = 0
for letter in word:
    if letter in vowels:
        count = count + 1
print(count)
```

## Question 40
```python
numbers = [1, 2, 3, 4, 5]
target = 3
found = False
for num in numbers:
    if num == target:
        found = True
        break
print(found)
```
