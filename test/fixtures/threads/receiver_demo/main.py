"""receiver_demo — a head-local receiver drives a project class (M-FS2).

`engine = Engine(4)` then `engine.ignite(0.5)`: the linker resolves the
receiver call to engine:Engine.ignite (viaLocal), and the thread must
step INTO the project method — not paint an external terminal.
"""

from engine import Engine


def main():
    engine = Engine(4)
    rpm = engine.ignite(0.5)
    print(f"engine at {rpm} rpm")


if __name__ == "__main__":
    main()
