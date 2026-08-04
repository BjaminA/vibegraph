"""system_demo Flask backend — exercises every system-tier subsystem.

Routes reach the db (store), the cache (cache), and an external HTTP
service (payments -> api.stripe.com). The web/ frontend calls these
routes by path. M19.1 rolls all of that into the `system` tier.

Effect calls are bound to locals (not nested inside jsonify) so the
thread extractor follows them — see PLAN-v5 §1.3 / the flask_demo
precedent.
"""

from flask import Flask, jsonify, request

import cache as cachelib
import payments
import store

app = Flask(__name__)


@app.route("/api/users", methods=["GET"])
def list_users_route():
    """List every user."""
    users = store.all_users()
    return jsonify(users)


@app.route("/api/users/<int:uid>", methods=["GET"])
def get_user_route(uid):
    """Fetch one user, cache-first."""
    user = get_user(uid)
    return jsonify(user)


def get_user(uid):
    cached = cachelib.cache.get(f"user:{uid}")
    if cached:
        return cached
    user = store.find_user(uid)
    cachelib.cache.set(f"user:{uid}", user)
    return user


@app.route("/api/charges", methods=["POST"])
def create_charge_route():
    """Create a payment charge via the external API."""
    body = request.get_json()
    result = payments.charge(body["amount"])
    return jsonify(result)
