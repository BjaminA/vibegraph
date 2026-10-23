"""Read stock levels through the HTTP door."""
from app.net.http import get_json


def stock():
    return get_json("https://stock.example.com/levels")
