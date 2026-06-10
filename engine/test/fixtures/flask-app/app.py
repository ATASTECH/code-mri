from flask import Blueprint, Flask

app = Flask(__name__)
bp = Blueprint("users", __name__, url_prefix="/users")


@app.route("/health")
def health():
    return {"ok": True}


@bp.route("/", methods=["GET", "POST"])
def users():
    return []


@bp.route("/<int:user_id>")
def get_user(user_id):
    return {"id": user_id}


app.register_blueprint(bp, url_prefix="/api")
