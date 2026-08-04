"""Engine — the project-local class main.py drives through a receiver."""


class Engine:
    """Combustion model with a two-phase ignition sequence."""

    def __init__(self, cylinders):
        self.cylinders = cylinders
        self.running = False

    def ignite(self, throttle):
        """Spin up; returns the achieved rpm."""
        if throttle <= 0:
            raise ValueError("throttle must be positive")
        rpm = 0
        for _ in range(self.cylinders):
            rpm = rpm + self.step_rpm(throttle)
        self.running = True
        return rpm

    def step_rpm(self, throttle):
        return int(120 * throttle)
