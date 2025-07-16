# Intermediate Level Technical Test (Python + SQL)

---

## 1. Python: Syntax & Language Features

1. Which of the following is a valid list comprehension in Python?
    - a) `[x^2 for x in range(5)]`
    - b) `[x*x for x in range(5)]`
    - c) `(x*x for x in range(5))`
    - d) `{x*x for x in range(5)}`

2. What is the output of:
    ```python
    print("".join(["a", "b", "c"]))
    ```
    - a) abc
    - b) a b c
    - c) ['a', 'b', 'c']
    - d) Error

3. Which statement about Python slicing is correct?
    - a) `s[::2]` returns every second element of s
    - b) `s[:2:]` returns the first and third element
    - c) `s[1:3]` includes s[3]
    - d) Negative indices are not allowed

4. How do you create a shallow copy of a list `mylist`?
    - a) `mylist.copy()`
    - b) `mylist[:]`
    - c) `copy(mylist)`
    - d) All of the above except c

5. What is the difference between `is` and `==` in Python?  
    *(Short answer)*

6. Which of the following is valid unpacking?
    - a) `a, b = [1, 2]`
    - b) `a, *b = [1, 2, 3]`
    - c) `*a, b = [1, 2, 3]`
    - d) All of the above

7. Which function is used to sort a list in-place?
    - a) `sort(list)`
    - b) `list.sort()`
    - c) `sorted(list)`
    - d) `order(list)`

8. Which will raise a `KeyError`?
    - a) `d = {}; d['x']`
    - b) `l = []; l[0]`
    - c) `s = set(); s.pop()`
    - d) `d = {'x':1}; d.get('y')`

9. How do you check if an object is an instance of a class in Python?
    - a) `obj.type(Class)`
    - b) `isinstance(obj, Class)`
    - c) `type(obj) == Class`
    - d) Both b and c

10. Write a one-line Python expression to reverse a string `s`.

---

## 2. Python Theory / Concepts

1. Explain the concept of "duck typing" in Python.
2. What is a generator? Give an example use-case.
3. Difference between `@staticmethod` and `@classmethod`.
4. How does Python handle memory management?
5. What is a lambda function? Where would you use it?
6. Explain the use of `*args` and `**kwargs`.
7. What is the purpose of the `__init__` method?
8. How do you handle exceptions for multiple exception types in a single `except`?
9. What is the purpose of the `with` statement in Python?
10. Explain the concept of decorators with a simple example.

---

## 3. Python: Guess the Output

1. What will be printed?
    ```python
    a = [1, 2, 3]
    b = a
    b.append(4)
    print(a)
    ```

2. Output?
    ```python
    def f(val, l=[]):
        l.append(val)
        return l
    print(f(1))
    print(f(2))
    ```

3. Output?
    ```python
    print([i for i in range(3) if i%2==0])
    ```

4. Output?
    ```python
    x = [1, 2, 3]
    print(x[-2:])
    ```

5. Output?
    ```python
    print(type(lambda x: x))
    ```

6. Output?
    ```python
    x = {1, 2, 2, 3}
    print(len(x))
    ```

7. Output?
    ```python
    try:
        print(1/0)
    except ZeroDivisionError:
        print("Zero")
    ```

8. Output?
    ```python
    s = "python"
    print(s[1:-1])
    ```

9. Output?
    ```python
    d = {1: "a", 2: "b"}
    print(d.get(3, "c"))
    ```

10. Output?
    ```python
    print(bool([]) and bool('False'))
    ```

---

## 4. SQL Scenario-Based

1. Write a query to get the second highest salary from an `employees` table.
2. Update the email of all users whose username starts with 'A' to `NULL`.
3. Delete all orders older than Jan 1, 2024.
4. Select customer names who have placed more than 3 orders.
5. Write a query to count the number of employees in each department.
6. Retrieve the product name and supplier name for each product, using tables `products` and `suppliers`.
7. List customers who have never placed an order (use `LEFT JOIN`).
8. Find all employees who do not have a manager (i.e., `manager_id` is `NULL`).
9. Write a subquery to find products with price greater than the average price.
10. Demonstrate a transaction: Insert a new order and then rollback.

---

## 5. Python File Handling

1. How do you safely read a file and handle exceptions if the file does not exist? (Write code)
2. Write Python code to copy contents of one file to another.
3. How do you read a binary file in Python?
4. Explain the difference between text and binary file modes.
5. How to write a list of strings to a file, one per line, using context management?

---

## 6. Python Multiprocessing & Multithreading

1. What is the difference between a thread and a process?
2. How does Python’s GIL affect multithreading?
3. Write a code snippet using the `threading` module to start 2 threads.
4. How can you share data between processes in Python?
5. What is a `Queue` and why is it useful in multiprocessing?
6. Explain the use of `Pool` in the multiprocessing module.
7. What does the `join()` method do for threads/processes?
8. How do you ensure thread-safety when accessing shared data?
9. Write code to create a multiprocessing process that prints its PID.
10. How can you terminate a running process from your Python code?
