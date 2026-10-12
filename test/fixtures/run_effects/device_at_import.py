"""A port opened at module level runs on import, before any function."""
import serial

PORT = serial.Serial("/dev/ttyUSB0")


def status():
    total = 1
