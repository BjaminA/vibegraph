"""flask_factory_demo — factory-style Flask app (NEXT-ACTIONS §2).

NO module-level routes: everything is registered inside create_app()
(decorators + add_url_rule) or on a Blueprint. Pre-M-NA5 discovery saw
none of these and the project collapsed to a generic "Backend" card.
"""
from flask import Flask, jsonify

from api import bp
from db import query


def health():
    """Liveness probe, registered via add_url_rule."""
    return jsonify({"ok": True})


def create_app():
    """App factory — routes live inside the factory body."""
    app = Flask(__name__)

    @app.route("/users")
    def list_users():
        """List every user."""
        return jsonify(query("SELECT uid, name FROM users"))

    @app.post("/users")
    def create_user():
        """Create a user record."""
        return jsonify({"created": True}), 201

    app.add_url_rule("/health", "health", view_func=health)
    app.register_blueprint(bp)
    return app
