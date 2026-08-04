from utils import greet, format_name
from models import User

def run():
    users = [User("Alice"), User("Bob"), User("Charlie")]
    for user in users:
        name = format_name(user.name)
        greet(name)

if __name__ == "__main__":
    run()
