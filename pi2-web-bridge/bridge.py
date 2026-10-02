"""HTTP bridge between the web UI and the fixed pi2-motor-control project.

The bridge receives logical X/Z/theta1/theta2 targets. It never accepts raw
G-code; differential mixing, limits, calibration locks, checkpoints, and
Moonraker commands remain in pi2-motor-control.
"""

from __future__ import annotations

import hmac
import json
import mimetypes
import os
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import RLock
from typing import Any
from urllib.parse import urlparse

BRIDGE_ROOT = Path(__file__).resolve().parent
PI2_ROOT = Path(os.environ.get("PI2_MOTOR_CONTROL_DIR", "~/pi2-motor-control")).expanduser().resolve()
PI2_SRC = PI2_ROOT / "src"
if not PI2_SRC.is_dir():
    raise RuntimeError(f"pi2-motor-control source not found: {PI2_SRC}")
sys.path.insert(0, str(PI2_SRC))

from kinematics import Pose  # noqa: E402
from machine_config import load_runtime_config  # noqa: E402
from moonraker_client import MoonrakerClient  # noqa: E402
from motion_controller import MotionController  # noqa: E402
from progress_store import ProgressStore  # noqa: E402


class Bridge:
    def __init__(self) -> None:
        config_file = Path(os.environ.get("COBOT_MACHINE_CONFIG", PI2_ROOT / "config" / "machine.json"))
        self.config = load_runtime_config(config_file)
        self.client = MoonrakerClient(
            host=os.environ.get("MOONRAKER_HOST", "127.0.0.1"),
            port=int(os.environ.get("MOONRAKER_PORT", "7125")),
            api_key=os.environ.get("MOONRAKER_API_KEY") or None,
        )
        self.store = ProgressStore(self.config.checkpoint_path, self.config.home_pose)
        self.controller = MotionController(self.client, self.config, self.store)
        self.lock = RLock()
        self.referenced = False

    def status(self) -> dict[str, Any]:
        with self.lock:
            state = self.store.load()
            klippy_state = self.client.klippy_state()
            return {
                "klippy_state": klippy_state,
                "checkpoint": state,
                "motion_enabled": self.config.calibration.calibration_verified and state["status"] != "uncertain" and self.referenced,
                "calibration_verified": self.config.calibration.calibration_verified,
                "extrusion_enabled": self.config.calibration.extrusion_enabled,
                "reference_required": not self.referenced,
                "limits": self.config.limits.__dict__,
                "home_pose": self.config.home_pose.as_dict(),
            }

    def move(self, data: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            if not self.referenced:
                raise RuntimeError("Motion is locked: manually position the mechanism, then call reference-home")
            if data.get("extrude", False):
                raise ValueError("Web bridge does not accept extrusion commands")
            target_data = data.get("target")
            if not isinstance(target_data, dict):
                raise ValueError("target object is required")
            allowed = {"x_mm", "z_mm", "theta1_deg", "theta2_deg"}
            if set(target_data) != allowed:
                raise ValueError("target must contain exactly x_mm, z_mm, theta1_deg, theta2_deg")
            target = Pose(**{key: float(target_data[key]) for key in allowed})
            speed = float(data.get("path_speed_mm_s"))
            plan = self.controller.move_to(target, speed, extrude=False)
            return {
                "target": plan.target.as_dict(),
                "duration_s": plan.duration_s,
                "commands": [command.stepper_name for command in plan.commands],
                "checkpoint": self.store.load(),
            }

    def reference_home(self) -> dict[str, Any]:
        """Record the already-manually-positioned mechanism as the configured home.

        This deliberately performs no movement. The current fixed printer.cfg has
        no endstop pins or automatic homing macro.
        """
        with self.lock:
            self.client.require_ready()
            home = self.config.home_pose
            common = home.x_mm / self.config.calibration.x_mm_per_motor_rev
            differential = home.theta2_deg / self.config.calibration.theta2_deg_per_diff_motor_rev
            script = "\n".join((
                f"MANUAL_STEPPER STEPPER=upper SET_POSITION={(common + differential) * 360.0:.8f}",
                f"MANUAL_STEPPER STEPPER=lower SET_POSITION={(common - differential) * 360.0:.8f}",
                f"MANUAL_STEPPER STEPPER=z_axis SET_POSITION={home.z_mm:.8f}",
                f"MANUAL_STEPPER STEPPER=theta1 SET_POSITION={home.theta1_deg:.8f}",
                "MANUAL_STEPPER STEPPER=filament SET_POSITION=0",
            ))
            self.client.send_gcode(script)
            self.store.reset(home, filament_mm=0.0)
            self.referenced = True
            return {"checkpoint": self.store.load()}

    def emergency_stop(self) -> dict[str, Any]:
        with self.lock:
            self.controller.emergency_stop("web bridge emergency stop")
            return {"checkpoint": self.store.load()}


def run() -> None:
    bridge = Bridge()
    token = os.environ.get("PI2_BRIDGE_TOKEN", "")
    allowed_origins = {item.strip() for item in os.environ.get("PI2_BRIDGE_ORIGINS", "http://127.0.0.1:8765").split(",") if item.strip()}
    host = os.environ.get("PI2_BRIDGE_HOST", "127.0.0.1")
    port = int(os.environ.get("PI2_BRIDGE_PORT", "8766"))
    ui_root = Path(os.environ.get("PI2_WEB_UI_ROOT", PI2_ROOT.parent / "3d-printer-head-movement")).expanduser().resolve()
    static_files = {"index.html", "style.css", "app.js", "mock-api.js", "robot-api.js", "pi2-bridge-api.js", "commissioning-config.js", "commissioning-ui.js"}

    class Handler(BaseHTTPRequestHandler):
        def _authorized(self) -> bool:
            if not token:
                return host in {"127.0.0.1", "localhost", "::1"}
            return hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}")

        def _write(self, status: int, body: dict[str, Any] | None = None) -> None:
            payload = b"" if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            origin = self.headers.get("Origin")
            if origin in allowed_origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if payload:
                self.wfile.write(payload)

        def do_OPTIONS(self) -> None:  # noqa: N802
            origin = self.headers.get("Origin")
            if origin not in allowed_origins:
                self._write(HTTPStatus.FORBIDDEN, {"error": "origin is not allowed"})
                return
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            name = urlparse(self.path).path.lstrip("/") or "index.html"
            if name in static_files:
                source = ui_root / name
                if not source.is_file():
                    self._write(HTTPStatus.NOT_FOUND, {"error": "web UI file not found"})
                    return
                body = source.read_bytes()
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", mimetypes.guess_type(name)[0] or "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if not self._authorized():
                self._write(HTTPStatus.UNAUTHORIZED, {"error": "authorization required"})
                return
            if self.path == "/api/v1/status":
                try:
                    self._write(HTTPStatus.OK, bridge.status())
                except Exception as error:  # keep the browser response structured
                    self._write(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(error)})
                return
            self._write(HTTPStatus.NOT_FOUND, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802
            if not self._authorized():
                self._write(HTTPStatus.UNAUTHORIZED, {"error": "authorization required"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > 4096:
                    raise ValueError("invalid request length")
                data = json.loads(self.rfile.read(length) or b"{}")
                if not isinstance(data, dict):
                    raise ValueError("JSON object required")
                if self.path == "/api/v1/move":
                    self._write(HTTPStatus.OK, bridge.move(data))
                elif self.path == "/api/v1/reference-home":
                    self._write(HTTPStatus.OK, bridge.reference_home())
                elif self.path == "/api/v1/emergency-stop":
                    self._write(HTTPStatus.OK, bridge.emergency_stop())
                else:
                    self._write(HTTPStatus.NOT_FOUND, {"error": "not found"})
            except (ValueError, RuntimeError) as error:
                self._write(HTTPStatus.CONFLICT, {"error": str(error)})
            except Exception as error:
                self._write(HTTPStatus.BAD_GATEWAY, {"error": str(error)})

        def log_message(self, format: str, *args: object) -> None:  # noqa: A002
            print("[bridge] " + (format % args))

    print(f"pi2 web bridge listening on http://{host}:{port}")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    run()
