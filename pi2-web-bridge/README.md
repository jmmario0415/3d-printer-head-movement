# Pi2 웹 브리지

이 프로그램은 고정된 `pi2-motor-control` 폴더 **안이 아니라 옆에** 설치합니다. 브리지는 해당 프로젝트의 `MotionController`를 불러오므로, 웹 UI는 논리 좌표만 요청하며 원시 G-code를 직접 전송하지 않습니다.

## 라즈베리파이에서 처음 실행하기

1. `3d-printer-head-movement` 프로젝트 전체를 라즈베리파이의 `~/3d-printer-head-movement` 경로에 복사합니다.
2. 고정된 하드웨어 프로젝트와 Python 패키지가 `~/pi2-motor-control`에 준비되어 있는지 확인합니다.
3. 라즈베리파이 터미널에서 아래 명령을 실행합니다.

```bash
cd ~/3d-printer-head-movement/pi2-web-bridge
export PI2_MOTOR_CONTROL_DIR="$HOME/pi2-motor-control"
export PI2_WEB_UI_ROOT="$HOME/3d-printer-head-movement"
export MOONRAKER_HOST=127.0.0.1
python3 bridge.py
```

기본 설정에서 브리지는 `http://127.0.0.1:8766`에서만 실행되며, `~/3d-printer-head-movement`의 웹 UI 파일도 함께 제공합니다. 시운전 중에는 이 터미널을 열어 둔 뒤, 라즈베리파이의 브라우저에서 `http://127.0.0.1:8766`을 엽니다. 제어 방식에서 **Pi2 Bridge**를 선택하면 브리지 URL은 이미 올바르게 설정되어 있습니다.

`REFERENCE HOME / ZERO` 버튼은 기체를 자동 원점 복귀시키지 않습니다. 작업자가 기구부를 실제 기준 위치에 직접 맞춘 뒤 누르면, 설정된 홈 좌표를 Klipper의 5개 수동 스테퍼에 기록합니다.

`calibration_verified` 값은 `~/pi2-motor-control/config/machine.json`에서만 관리합니다. 이 값이 `false`이면 브리지는 상태 조회는 제공하지만 모든 이동 요청을 거부합니다.

## 외부 PC에서 조작하기

외부 PC에서 조작할 때도 라즈베리파이의 기존 내부망 IP는 바꾸지 않습니다. 대신 브리지에 네트워크 수신 설정과 토큰을 추가한 뒤 실행합니다.

```bash
cd ~/3d-printer-head-movement/pi2-web-bridge
export PI2_MOTOR_CONTROL_DIR="$HOME/pi2-motor-control"
export PI2_WEB_UI_ROOT="$HOME/3d-printer-head-movement"
export MOONRAKER_HOST=127.0.0.1
export PI2_BRIDGE_HOST=0.0.0.0
export PI2_BRIDGE_TOKEN='충분히긴임의의비밀번호'
export PI2_BRIDGE_ORIGINS='http://라즈베리파이IP:8766'
python3 bridge.py
```

라즈베리파이의 IP는 아래 명령으로 확인할 수 있습니다.

```bash
hostname -I
```

예를 들어 Pi의 IP가 `192.168.0.50`이면 외부 PC 브라우저에서 `http://192.168.0.50:8766`을 엽니다. 화면의 토큰 입력란에는 `PI2_BRIDGE_TOKEN`에 입력한 값을 넣습니다.

`127.0.0.1`은 현재 사용 중인 기기 자신을 의미합니다. 따라서 외부 PC에서는 사용하면 안 됩니다. `0.0.0.0`은 브리지가 Pi의 모든 네트워크 연결에서 요청을 받도록 하는 실행 설정이며, 브라우저에 입력하는 주소가 아닙니다.
