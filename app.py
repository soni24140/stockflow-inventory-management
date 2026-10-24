"""StockFlow: a small, dependency-free, multi-tenant inventory app."""
from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("STOCKFLOW_DB", ROOT / "stockflow.db"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8000"))
SESSION_DAYS = 14
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class ClosingConnection(sqlite3.Connection):
    """Commit/rollback and release the file handle when a connection block ends."""

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH, timeout=10, factory=ClosingConnection)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript("""
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS organizations (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL,
            default_threshold INTEGER NOT NULL DEFAULT 5 CHECK(default_threshold >= 0),
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
            email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY, organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name TEXT NOT NULL, sku TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
            cost_price REAL, selling_price REAL, low_stock_threshold INTEGER,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(organization_id, sku)
        );
        CREATE INDEX IF NOT EXISTS products_org_idx ON products(organization_id);
        CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
        """)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    value = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${value.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt, expected = stored.split("$")
        if algorithm != "scrypt":
            return False
        value = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
        return hmac.compare_digest(value.hex(), expected)
    except (ValueError, TypeError):
        return False


class APIError(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


class Handler(BaseHTTPRequestHandler):
    server_version = "StockFlow/1.0"

    def log_message(self, fmt: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {self.client_address[0]} {fmt % args}")

    def send_json(self, status: int, data: dict, extra_headers: dict[str, str] | None = None) -> None:
        body = json.dumps(data, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0:
                raise APIError(400, "Invalid request length.")
            if length > 64_000:
                raise APIError(413, "Request is too large.")
            value = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(value, dict):
                raise APIError(400, "Expected a JSON object.")
            return value
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            raise APIError(400, "Invalid JSON request.")

    def cookie_token(self) -> str | None:
        jar = cookies.SimpleCookie(self.headers.get("Cookie", ""))
        morsel = jar.get("stockflow_session")
        return morsel.value if morsel else None

    def current_user(self) -> sqlite3.Row | None:
        token = self.cookie_token()
        if not token:
            return None
        with connect() as db:
            return db.execute("""SELECT u.id, u.email, u.organization_id, o.name AS organization_name,
                o.default_threshold FROM sessions s JOIN users u ON u.id=s.user_id
                JOIN organizations o ON o.id=u.organization_id
                WHERE s.token_hash=? AND s.expires_at>?""",
                (hashlib.sha256(token.encode()).hexdigest(), int(time.time()))).fetchone()

    def require_user(self) -> sqlite3.Row:
        user = self.current_user()
        if not user:
            raise APIError(401, "Please sign in to continue.")
        return user

    def set_session(self, token: str, max_age: int = SESSION_DAYS * 86400) -> None:
        secure = "; Secure" if os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true", "yes") else ""
        self.session_header = f"stockflow_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            try:
                self.api("GET", path)
            except APIError as e:
                self.send_json(e.status, {"error": e.message})
            except sqlite3.IntegrityError:
                self.send_json(409, {"error": "That SKU is already in use in this organization."})
            return
        if path == "/" or path in ("/index.html", "/app.js", "/styles.css"):
            file = ROOT / ("index.html" if path == "/" else path.lstrip("/"))
            if file.is_file():
                data = file.read_bytes()
                content_type = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"}.get(file.suffix, "application/octet-stream")
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_error(404)
        else:
            self.send_error(404)

    def do_POST(self) -> None:
        self.route("POST")

    def do_PUT(self) -> None:
        self.route("PUT")

    def do_DELETE(self) -> None:
        self.route("DELETE")

    def route(self, method: str) -> None:
        path = urlparse(self.path).path
        try:
            if not path.startswith("/api/"):
                raise APIError(404, "Not found.")
            self.api(method, path)
        except APIError as e:
            headers = {"Set-Cookie": self.session_header} if getattr(self, "session_header", None) else None
            self.send_json(e.status, {"error": e.message}, headers)
        except sqlite3.IntegrityError as e:
            message = "That SKU is already in use in this organization." if "products.organization_id, products.sku" in str(e) else "This account already exists. Try signing in."
            self.send_json(409, {"error": message}, {"Set-Cookie": self.session_header} if getattr(self, "session_header", None) else None)

    def api(self, method: str, path: str) -> None:
        if method == "POST" and path == "/api/signup":
            data = self.body()
            email = str(data.get("email", "")).strip().lower()
            password = str(data.get("password", ""))
            organization = str(data.get("organization", "")).strip()
            if not EMAIL_RE.match(email) or len(email) > 254:
                raise APIError(400, "Enter a valid email address.")
            if len(password) < 8 or len(password) > 256:
                raise APIError(400, "Password must be at least 8 characters.")
            if not organization or len(organization) > 100:
                raise APIError(400, "Organization name is required (100 characters max).")
            with connect() as db:
                cur = db.execute("INSERT INTO organizations(name,created_at) VALUES(?,?)", (organization, now()))
                org_id = cur.lastrowid
                cur = db.execute("INSERT INTO users(organization_id,email,password_hash,created_at) VALUES(?,?,?,?)", (org_id, email, hash_password(password), now()))
                user_id = cur.lastrowid
                token = secrets.token_urlsafe(32)
                db.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user_id, int(time.time()) + SESSION_DAYS * 86400))
            self.set_session(token)
            self.send_json(201, {"user": {"email": email, "organization": organization}}, {"Set-Cookie": self.session_header})
            return
        if method == "POST" and path == "/api/login":
            data = self.body()
            email = str(data.get("email", "")).strip().lower()
            password = str(data.get("password", ""))
            if len(password) > 256:
                raise APIError(400, "Password must be 256 characters or fewer.")
            with connect() as db:
                user = db.execute("SELECT id,password_hash FROM users WHERE email=?", (email,)).fetchone()
                if not user or not verify_password(password, user["password_hash"]):
                    raise APIError(401, "Email or password is incorrect.")
                token = secrets.token_urlsafe(32)
                db.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user["id"], int(time.time()) + SESSION_DAYS * 86400))
                org = db.execute("SELECT name FROM organizations WHERE id=(SELECT organization_id FROM users WHERE id=?)", (user["id"],)).fetchone()
            self.set_session(token)
            self.send_json(200, {"user": {"email": email, "organization": org["name"]}}, {"Set-Cookie": self.session_header})
            return
        if method == "POST" and path == "/api/logout":
            token = self.cookie_token()
            if token:
                with connect() as db:
                    db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
            self.send_json(200, {"ok": True}, {"Set-Cookie": "stockflow_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"})
            return
        if method == "GET" and path == "/api/me":
            user = self.current_user()
            if not user:
                self.send_json(200, {"user": None})
            else:
                self.send_json(200, {"user": {"email": user["email"], "organization": user["organization_name"]}, "settings": {"defaultThreshold": user["default_threshold"]}})
            return

        user = self.require_user()
        org_id = user["organization_id"]
        if method == "GET" and path == "/api/dashboard":
            with connect() as db:
                total = db.execute("SELECT COUNT(*) n, COALESCE(SUM(quantity),0) units FROM products WHERE organization_id=?", (org_id,)).fetchone()
                low_count = db.execute("SELECT COUNT(*) n FROM products WHERE organization_id=? AND quantity <= COALESCE(low_stock_threshold, ?)", (org_id, user["default_threshold"])).fetchone()["n"]
                low = db.execute("""SELECT id,name,sku,quantity,low_stock_threshold FROM products
                    WHERE organization_id=? AND quantity <= COALESCE(low_stock_threshold, ?)
                    ORDER BY quantity ASC, name COLLATE NOCASE ASC LIMIT 8""", (org_id, user["default_threshold"])).fetchall()
            self.send_json(200, {"totalProducts": total["n"], "totalUnits": total["units"], "lowStockCount": low_count, "lowStock": [dict(row) for row in low]})
            return
        if path == "/api/products" and method == "GET":
            with connect() as db:
                rows = db.execute("SELECT * FROM products WHERE organization_id=? ORDER BY name COLLATE NOCASE", (org_id,)).fetchall()
            self.send_json(200, {"products": [dict(row) for row in rows]})
            return
        if path == "/api/products" and method == "POST":
            data = self.body()
            product = self.validate_product(data)
            stamp = now()
            with connect() as db:
                cur = db.execute("""INSERT INTO products(organization_id,name,sku,description,quantity,cost_price,selling_price,low_stock_threshold,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?)""", (org_id, *product, stamp, stamp))
                row = db.execute("SELECT * FROM products WHERE id=? AND organization_id=?", (cur.lastrowid, org_id)).fetchone()
            self.send_json(201, {"product": dict(row)})
            return
        match = re.fullmatch(r"/api/products/(\d+)", path)
        if match and method == "PUT":
            data = self.body()
            product = self.validate_product(data)
            with connect() as db:
                cur = db.execute("""UPDATE products SET name=?,sku=?,description=?,quantity=?,cost_price=?,selling_price=?,low_stock_threshold=?,updated_at=?
                    WHERE id=? AND organization_id=?""", (*product, now(), int(match.group(1)), org_id))
                if not cur.rowcount:
                    raise APIError(404, "Product not found.")
                row = db.execute("SELECT * FROM products WHERE id=? AND organization_id=?", (int(match.group(1)), org_id)).fetchone()
            self.send_json(200, {"product": dict(row)})
            return
        if match and method == "DELETE":
            with connect() as db:
                cur = db.execute("DELETE FROM products WHERE id=? AND organization_id=?", (int(match.group(1)), org_id))
            if not cur.rowcount:
                raise APIError(404, "Product not found.")
            self.send_json(200, {"ok": True})
            return
        if method == "PUT" and path == "/api/settings":
            data = self.body()
            threshold = self.integer(data.get("defaultThreshold"), "Default low stock threshold", minimum=0)
            if threshold > 100_000_000:
                raise APIError(400, "Threshold is too large.")
            with connect() as db:
                db.execute("UPDATE organizations SET default_threshold=? WHERE id=?", (threshold, org_id))
            self.send_json(200, {"defaultThreshold": threshold})
            return
        raise APIError(404, "Not found.")

    @staticmethod
    def integer(value, label: str, minimum: int = 0) -> int:
        if isinstance(value, bool):
            raise APIError(400, f"{label} must be a whole number.")
        if isinstance(value, int):
            number = value
        elif isinstance(value, float) and math.isfinite(value) and value.is_integer():
            number = int(value)
        elif isinstance(value, str) and re.fullmatch(r"[+-]?\d+", value.strip()):
            number = int(value.strip())
        else:
            raise APIError(400, f"{label} must be a whole number.")
        if number < minimum or number > 100_000_000:
            raise APIError(400, f"{label} must be between {minimum} and 100,000,000.")
        return number

    @classmethod
    def validate_product(cls, data: dict) -> tuple:
        name = str(data.get("name", "")).strip()
        sku = str(data.get("sku", "")).strip()
        description = str(data.get("description", "")).strip()
        if not name or len(name) > 120:
            raise APIError(400, "Product name is required (120 characters max).")
        if not sku or len(sku) > 64:
            raise APIError(400, "SKU is required (64 characters max).")
        if len(description) > 1000:
            raise APIError(400, "Description must be 1,000 characters or less.")
        quantity = cls.integer(data.get("quantity", 0), "Quantity")

        def price(value, label):
            if value is None or value == "":
                return None
            if isinstance(value, bool):
                raise APIError(400, f"{label} must be a valid non-negative amount.")
            try:
                raw_number = float(value)
                if not math.isfinite(raw_number) or raw_number < 0 or raw_number > 1_000_000_000:
                    raise ValueError
                number = round(raw_number, 2)
                return number
            except (TypeError, ValueError, OverflowError):
                raise APIError(400, f"{label} must be a valid non-negative amount.")

        threshold = data.get("low_stock_threshold")
        if threshold is None or threshold == "":
            threshold = None
        else:
            threshold = cls.integer(threshold, "Low stock threshold")
        return (name, sku, description, quantity, price(data.get("cost_price"), "Cost price"), price(data.get("selling_price"), "Selling price"), threshold)


if __name__ == "__main__":
    initialize()
    print(f"StockFlow running at http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
