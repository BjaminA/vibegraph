"""Drives a serial device and a library no table knows; reads its config with
a parser that stays in-process."""
import obscurelib
import serial
import yaml


def read_config(text):
    return yaml.safe_load(text)


def main():
    port = serial.Serial("/dev/ttyUSB0")
    port.write(b"start")
    obscurelib.go(1)


if __name__ == "__main__":
    main()
