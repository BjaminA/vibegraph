"""Flask routes — three handlers exercising every M8.2 route signal.

  - @app.route(...) with default GET            → list_users_route
  - @app.route(..., methods=["GET"])            → get_user_route
  - @app.post(...)                              → create_user_route

Per PLAN-v2.md §1.2 the discovery is decorator-name string match only;
no `import flask` resolution. The framework chip should resolve to
"flask" because the decorator strings start with `app.` (alias not
modelled — heuristic accepts the convention).
"""

from flask import Flask, request, jsonify

from models import User, find_user, list_users, create_user

app = Flask(__name__)


@app.route("/users")
def list_users_route():
    users = list_users()
    return jsonify([{"uid": u.uid, "name": u.name, "email": u.email} for u in users])


@app.route("/users/<int:uid>", methods=["GET"])
def get_user_route(uid):
    user = find_user(uid)
    if user is None:
        return jsonify({"error": "not found"}), 404
    return jsonify({"uid": user.uid, "name": user.name, "email": user.email})


@app.post("/users")
def create_user_route():
    body = request.get_json()
    user = create_user(body["name"], body["email"])
    return jsonify({"uid": user.uid}), 201
