import math
from os.path import join, exists

PI = 3.14159
greeting = "hello"
my_list = [1, 2, 3, 4, 5]
names = ["Alice", "Bob", "Charlie"]


def calculate_area(radius):
    """Calculate the area of a circle."""
    return PI * radius**2


def greet(name, loud=False):
    msg = f"{greeting}, {name}!"
    if loud:
        msg = msg.upper()
    print(msg)
    return msg


class Shape:
    kind = "generic"

    def __init__(self, name):
        self.name = name
        self.sides = 0

    def describe(self):
        return f"{self.name} with {self.sides} sides"

    def area(self):
        raise NotImplementedError


class Circle(Shape):
    def __init__(self, radius):
        super().__init__("circle")
        self.radius = radius

    def area(self):
        return calculate_area(self.radius)


for item in my_list:
    print(item)

for name in names:
    greet(name)

result = calculate_area(10)
print(result)
