"""Calls that reach outside the program through a library the floor does not
know — a serial port, an MQTT broker, a socket — beside calls that do not
(math, a numeric library). The run floor must refuse the first kind and
allow the second; this file is never executed."""
import math
import socket

import numpy
import serial
import paho.mqtt.publish
import paho.mqtt.publish as publish
from paho.mqtt import publish as pub


def write_port():
    serial.Serial("/dev/ttyUSB0").write(b"go")
    total = 1


def mqtt_dotted():
    paho.mqtt.publish.single("plant/valve", "open")
    total = 1


def mqtt_alias():
    publish.single("plant/valve", "open")
    total = 1


def mqtt_from_alias():
    pub.single("plant/valve", "open")
    total = 1


def open_socket():
    socket.create_connection(("controller", 502))
    total = 1


def pure_math():
    x = math.sqrt(16)
    total = x


def numeric():
    m = numpy.mean([1, 2, 3])
    total = m
