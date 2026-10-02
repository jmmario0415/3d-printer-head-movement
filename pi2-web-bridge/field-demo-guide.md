# 현장 시운전 순서

이 절차는 `pi2-motor-control`을 수정하지 않고 Pi2 Bridge 웹 UI로 기구 이동을 확인하는 방법이다. 압출·히터 시험은 포함하지 않는다.

## 1. 출발 전: Pi에 파일 배치

Pi의 홈 폴더에 두 폴더가 있어야 한다.

```text
~/pi2-motor-control
~/3d-printer-head-movement
```

두 번째 폴더에는 이 저장소의 최신 파일과 `pi2-web-bridge` 폴더가 포함되어야 한다. Pi에서 다음을 실행한다.

```bash
cd ~/pi2-motor-control
python3 -m pip install -r requirements.txt
python3 -m unittest discover -s tests -v
ls /dev/serial/by-id/*
```

`ls` 출력은 고정 `klipper/printer.cfg`의 `[mcu] serial:`과 일치해야 한다. Mainsail에서 `FIRMWARE_RESTART`를 실행하고 Klipper가 `Ready`인지 확인한다.

## 2. 실측 전: Mainsail Console로 낮은 수준의 방향 확인

처음에는 `config/machine.json`의 두 잠금을 유지한다.

```json
"calibration_verified": false,
"extrusion_enabled": false
```

모터축·벨트·회전부 주변을 비우고, 각 모터를 아주 짧고 느리게 확인한다. 자동 원점 복귀를 실행하지 않는다. 이 고정 `printer.cfg`에는 엔드스톱 핀과 자동 홈 매크로가 없다.

물리적으로 기준 위치에 맞춘 뒤 Console에 다음을 넣어 좌표만 0으로 등록한다. 이 명령은 이동하지 않는다.

```gcode
MANUAL_STEPPER STEPPER=upper SET_POSITION=0
MANUAL_STEPPER STEPPER=lower SET_POSITION=0
MANUAL_STEPPER STEPPER=z_axis SET_POSITION=0
MANUAL_STEPPER STEPPER=theta1 SET_POSITION=0
MANUAL_STEPPER STEPPER=filament SET_POSITION=0
```

UPPER/LOWER를 같은 방향으로 움직였을 때 X 이동인지, 반대 방향일 때 theta2 회전인지 확인한다. Z, theta1도 별도로 확인한다. 측정 결과로 아래 값을 확정한다.

- `x_mm_per_motor_rev`
- `theta2_deg_per_diff_motor_rev`
- Z와 filament의 `rotation_distance`
- 모터 방향, 전류, 실제 이동 한계

## 3. 웹 제어 준비

측정값을 반영한 뒤에만 `calibration_verified`를 `true`로 바꾼다. 압출은 계속 `false`로 둔다.

```bash
cd ~/3d-printer-head-movement/pi2-web-bridge
export PI2_MOTOR_CONTROL_DIR="$HOME/pi2-motor-control"
export PI2_WEB_UI_ROOT="$HOME/3d-printer-head-movement"
export MOONRAKER_HOST=127.0.0.1
python3 bridge.py
```

Pi의 브라우저에서 `http://127.0.0.1:8766`을 열고 Controller에서 **Pi2 Bridge**를 선택한다. Bridge URL은 `http://127.0.0.1:8766`이다.

## 4. 웹 UI 시운전

1. 기구를 물리 기준 위치에 맞춘다.
2. **REFERENCE HOME / ZERO**를 누른다. 이 동작은 자동 이동이 아니라 현재 위치를 Pi2 home 좌표로 등록한다.
3. 작은 이동량으로 X, Z, theta1, theta2를 하나씩 시험한다.
4. X는 UPPER/LOWER 같은 방향, theta2는 반대 방향으로 동작하는지 확인한다.
5. 각 이동 후 화면의 Current Position과 실제 위치를 비교한다.
6. 이상이 있으면 즉시 UI의 **EMERGENCY STOP** 또는 Mainsail의 `M112`를 사용한다.

## 5. 비상정지 후

1. 원인을 제거하고 물리 장비 상태를 확인한다.
2. Mainsail에서 `FIRMWARE_RESTART`를 실행한다.
3. 모든 축을 물리 기준 위치로 다시 맞춘다.
4. 브리지를 종료했다가 다시 시작한다.
5. 웹 UI에서 다시 **REFERENCE HOME / ZERO**를 누른다.

비상정지 이후에는 이전 화면 좌표를 실제 위치로 가정하지 않는다.
