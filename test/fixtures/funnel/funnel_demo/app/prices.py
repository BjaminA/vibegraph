"""Read prices through the HTTP door."""
from app.net.http import get_json


def prices():
    return get_json("https://prices.example.com/today")
