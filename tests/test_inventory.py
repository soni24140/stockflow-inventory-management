"""Isolated HTTP-level acceptance checks for the StockFlow MVP."""
import http.cookiejar
import http.client
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import app


class StockFlowAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="stockflow-tests-")
        cls.original_db_path = app.DB_PATH
        app.DB_PATH = Path(cls.temp.name) / "test.sqlite3"
        app.initialize()
        cls.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)
        app.DB_PATH = cls.original_db_path
        cls.temp.cleanup()

    def setUp(self):
        with app.connect() as db:
            db.execute("DELETE FROM organizations")
        self.owner = self.new_client()
        self.other = self.new_client()

    @staticmethod
    def new_client():
        jar = http.cookiejar.CookieJar()
        return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(self, client, path, method="GET", body=None):
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            self.base_url + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        try:
            with client.open(request, timeout=5) as response:
                payload = response.read()
                content_type = response.headers.get("Content-Type", "")
                return response.status, json.loads(payload) if "application/json" in content_type else payload
        except urllib.error.HTTPError as error:
            payload = error.read()
            return error.code, json.loads(payload) if "application/json" in error.headers.get("Content-Type", "") else payload

    def signup(self, client, email, organization):
        return self.request(client, "/api/signup", "POST", {
            "email": email,
            "password": "correct-horse-42",
            "organization": organization,
        })

    @staticmethod
    def sample_product(**overrides):
        product = {
            "name": "Desk lamp",
            "sku": "LAMP-001",
            "description": "Brass desk lamp",
            "quantity": 4,
            "cost_price": 12.5,
            "selling_price": 24.99,
            "low_stock_threshold": None,
        }
        return {**product, **overrides}

    def test_auth_products_dashboard_settings_and_tenant_isolation(self):
        status, _ = self.request(self.owner, "/api/products")
        self.assertEqual(status, 401)

        status, signup = self.signup(self.owner, "owner@example.test", "North Shop")
        self.assertEqual(status, 201)
        status, me = self.request(self.owner, "/api/me")
        self.assertEqual(me["user"]["organization"], "North Shop")
        self.assertEqual(me["settings"]["defaultThreshold"], 5)

        status, created = self.request(self.owner, "/api/products", "POST", self.sample_product())
        self.assertEqual(status, 201)
        product_id = created["product"]["id"]
        self.assertIsNotNone(signup["user"])
        self.assertEqual(created["product"]["organization_id"], 1)

        status, duplicate = self.request(self.owner, "/api/products", "POST", self.sample_product())
        self.assertEqual(status, 409)
        self.assertIn("SKU", duplicate["error"])

        status, dashboard = self.request(self.owner, "/api/dashboard")
        self.assertEqual(status, 200)
        self.assertEqual((dashboard["totalProducts"], dashboard["totalUnits"], dashboard["lowStockCount"]), (1, 4, 1))
        self.assertEqual(dashboard["lowStock"][0]["sku"], "LAMP-001")

        status, settings = self.request(self.owner, "/api/settings", "PUT", {"defaultThreshold": 3})
        self.assertEqual((status, settings["defaultThreshold"]), (200, 3))
        self.assertEqual(self.request(self.owner, "/api/dashboard")[1]["lowStockCount"], 0)

        changed = self.sample_product(name="Desk lamp XL", quantity=8, low_stock_threshold=10)
        status, updated = self.request(self.owner, f"/api/products/{product_id}", "PUT", changed)
        self.assertEqual((status, updated["product"]["name"], updated["product"]["quantity"]), (200, "Desk lamp XL", 8))
        self.assertEqual(self.request(self.owner, "/api/dashboard")[1]["lowStockCount"], 1)

        status, _ = self.signup(self.other, "other@example.test", "South Shop")
        self.assertEqual(status, 201)
        self.assertEqual(self.request(self.other, "/api/products"), (200, {"products": []}))
        self.assertEqual(self.request(self.other, "/api/dashboard")[1]["totalProducts"], 0)
        self.assertEqual(self.request(self.other, f"/api/products/{product_id}", "PUT", changed)[0], 404)
        self.assertEqual(self.request(self.other, f"/api/products/{product_id}", "DELETE")[0], 404)
        self.assertEqual(self.request(self.other, "/api/products", "POST", self.sample_product())[0], 201)

        self.assertEqual(self.request(self.owner, f"/api/products/{product_id}", "DELETE")[0], 200)
        self.assertEqual(self.request(self.owner, "/api/products")[1]["products"], [])

    def test_auth_validation_login_and_logout(self):
        status, payload = self.request(self.owner, "/api/signup", "POST", {
            "email": "not-an-email", "password": "short", "organization": ""
        })
        self.assertEqual(status, 400)
        self.assertIn("email", payload["error"].lower())

        self.assertEqual(self.signup(self.owner, "login@example.test", "Login Shop")[0], 201)
        self.assertEqual(self.request(self.owner, "/api/logout", "POST", {})[0], 200)
        self.assertEqual(self.request(self.owner, "/api/dashboard")[0], 401)
        self.assertEqual(self.request(self.owner, "/api/login", "POST", {
            "email": "login@example.test", "password": "wrong-password"
        })[0], 401)
        self.assertEqual(self.request(self.owner, "/api/login", "POST", {
            "email": "login@example.test", "password": "correct-horse-42"
        })[0], 200)

    def test_invalid_product_and_threshold_values_are_rejected(self):
        self.assertEqual(self.signup(self.owner, "validation@example.test", "Validation Shop")[0], 201)
        status, product = self.request(self.owner, "/api/products", "POST", self.sample_product(quantity=5.0, cost_price=3.0))
        self.assertEqual((status, product["product"]["quantity"]), (201, 5))
        for index, invalid in enumerate((-1, 1.5, "not-a-number", True)):
            with self.subTest(quantity=invalid):
                self.assertEqual(self.request(self.owner, "/api/products", "POST", self.sample_product(sku=f"INVALID-{index}", quantity=invalid))[0], 400)
        for index, invalid in enumerate((float("nan"), float("inf"), True)):
            with self.subTest(price=invalid):
                self.assertEqual(self.request(self.owner, "/api/products", "POST", self.sample_product(sku=f"BAD-PRICE-{index}", cost_price=invalid))[0], 400)
        self.assertEqual(self.request(self.owner, "/api/settings", "PUT", {"defaultThreshold": -1})[0], 400)
        self.assertEqual(self.request(self.owner, "/api/settings", "PUT", {"defaultThreshold": 2.5})[0], 400)
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        connection.request("POST", "/api/signup", body=None, headers={"Content-Length": "-1"})
        response = connection.getresponse()
        response.read()
        self.assertEqual(response.status, 400)
        connection.close()


if __name__ == "__main__":
    unittest.main()
