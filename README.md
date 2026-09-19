# 4축 프린터 시운전 프로그램

순수 HTML / CSS / JavaScript로 만든 하드웨어 단위 테스트용 웹 UI입니다. 기본 실행은 **Mock**이며 실제 장비에 자동 연결하지 않습니다. 통합 디스플레이, AI 제어, 슬라이싱 및 역기구학은 이번 구현 범위에 포함하지 않습니다.

## 실행

Node.js 22 이상(검증: 24.18.0)에서 저장소 폴더를 열고:

```powershell
node serve.js
```

브라우저에서 `http://127.0.0.1:8765`를 엽니다. 서버는 이 프로젝트의 UI 파일만 loopback으로 제공하며 장비 API를 프록시하지 않습니다. 파일을 직접 열어도 Mock 사용은 가능하지만 실제 연결은 HTTP로 실행하세요.

## Mock으로 확인하기

1. 시작 시 READY, SIMULATED 표시와 네 축 원점을 확인합니다.
2. Tool 0 / Bed의 Active 또는 Standby 온도를 입력하고 해당 버튼을 누릅니다. 입력만 변경하면 적용되지 않습니다. Current는 모의 측정 온도, Target은 적용 목표입니다.
3. 차트의 실선은 현재 온도, 점선은 목표입니다. 빨강은 Tool 0, 파랑은 Bed입니다. 1초 주기로 최대 180개 표본을 보관하며 모드 변경·재연결 시 초기화합니다.
4. Fan 1 / Fan 2의 %를 입력하고 APPLY 또는 OFF를 누릅니다. 표시값은 출력 설정이며 RPM 센서값이 아닙니다.
5. 네 매크로를 실행합니다. 일반 명령은 중복 실행할 수 없지만 비상정지는 항상 가능합니다.

| 매크로 | Mock 동작 |
|---|---|
| 01-Test_IR_PD_Homing | 4축 모의 원점 복귀 |
| 02-Test_Fans | 각 팬을 50%로 0.9초 동작 후 OFF |
| 03-Test_Heaters | 두 히터에 45°C 목표를 적용하여 2.2초 모의 가열 후 OFF |
| 04-Test_motors | 각 축을 1 mm / 1° 이동 후 시작 위치 복귀. 상한에서는 음의 방향 선택 |

Mock 실내 온도는 22°C, 가열 12°C/s, 냉각 4°C/s이며 개발용 상한은 Tool 0 280°C / Bed 110°C입니다. **이 수치는 실제 기계 사양이 아니며 Moonraker 모드로 전달되지 않습니다.** 히터 테스트는 시간 기반 시뮬레이션이며 실제 가열 성능 합격 판정을 하지 않습니다. 가열 및 팬 매크로는 종료·실패 후 해당 출력을 OFF로 정리합니다.

Mock E-stop은 진행 중인 이동/매크로를 중단하고 히터 목표 및 팬 출력을 0으로 만듭니다. 잔열은 서서히 식습니다. 중단된 작업이 끝난 후 RESET MOCK E-STOP이 활성화됩니다. Reset은 이전 가열이나 테스트를 재개하지 않습니다.

## 파일 구조와 공통 인터페이스

| 파일 | 책임 |
|---|---|
| `index.html`, `style.css` | 전체 패널 골격과 산업용 데스크톱 UI |
| `app.js` | 연결, 공통 명령 잠금, E-stop, Jog, 위치, 로그 |
| `commissioning-ui.js` | 히터/팬/매크로 패널, 프리셋, 온도 폴링 및 차트 |
| `commissioning-config.js` | 논리 장치 표시명, 실제 장치/매크로 매핑 |
| `mock-api.js` | 네 축·온도·팬·테스트 시뮬레이션. 네트워크 요청 없음 |
| `robot-api.js` | Moonraker 통신·설정 검증·장치 조회·실제 명령 생성 |
| `serve.js` | 의존성 없는 로컬 정적 서버 |
| `tests/` | 기존 회귀 테스트, 제어기 테스트, 브라우저 E2E |

두 제어기는 기존 `connect`, `getStatus`, `jog`, `getPosition`, `home`, `emergencyStop`, `resetEmergencyStop`에 더해 같은 인터페이스를 제공합니다:

```javascript
await robot.getTelemetry();
// { heaters: {tool0, bed}, fans: {fan1, fan2}, macros, macro, simulated, state }
await robot.setHeater('tool0', targetCelsius);
await robot.setFan('fan1', outputPercent);
await robot.runMacro('fans');
```

UI에서 G-code나 특정 장치의 HTTP 요청을 만들지 않습니다. 실제 연결 오류는 URL 경로와 원인을 Event Log에 기록합니다. 로그는 최근 500개까지 보관합니다.

## 실제 Moonraker 연결 설정

실제 기체 테스트는 아직 수행하지 않았습니다. `commissioning-config.js`의 `MOONRAKER_CONFIG`는 기본적으로 비어 있습니다. Mock 값으로 실제 설정을 자동 생성하거나 대체하지 않습니다.

1. `printer.cfg`와 실제 장치 구성을 확인합니다.
2. 아래 스키마에 따라 매핑을 작성한 후 페이지를 새로고침합니다.
3. UI에서 Moonraker를 선택하고 컨트롤러의 HTTP(S) base URL을 입력한 뒤 RECONNECT를 누릅니다. URL에 API 경로나 사용자명·비밀번호를 넣지 않습니다.
4. 연결이 READY이고 해당 장치가 서버 조회 목록에 있을 때만 제어가 활성화됩니다. 실제 모드의 온도 프리셋은 0으로 시작합니다.

| 설정 키 | 값의 의미 |
|---|---|
| `heaters.tool0`, `heaters.bed` | `{ object, minTarget, maxTarget }`. `object`는 검증한 `extruder`, `extruder1` 등 또는 `heater_bed`. `minTarget`/`maxTarget`은 실제 사양에서 확인한 허용 목표 온도. OFF의 0은 별도로 허용 |
| `fans.fan1`, `fans.fan2` | `{ object }`. 지원 대상은 실제 `[fan]`의 `fan`, 또는 `[fan_generic 이름]`의 `fan_generic 이름` |
| `macros.homing`, `.fans`, `.heaters`, `.motors` | 검증 후 Klipper에 등록한 매크로 명령 이름 문자열. 대소문자를 서버 객체명과 맞추고 영문/밑줄만 사용. 화면의 번호·하이픈 포함 이름과 명령 이름은 별개 |
| `linearHomingVerified` | 실제 X/Z 호밍 절차가 검증되었을 때만 `true`. 기본 `false`로 UI HOME 차단 |

미설정, 잘못된 매핑, 서버에 없는 장치 또는 측정값 누락은 `Not configured / unavailable`와 `N/A`로 표시합니다. 자동 제어되는 `heater_fan`/`controller_fan`은 수동 팬 대상으로 지원하지 않습니다. 추가 팬 타입이나 히터 타입이 필요하면 실제 설정 확인 후 API 계층에서 확장합니다.

매크로 본문은 이 프로그램이 생성하지 않습니다. 검증된 `printer.cfg`의 절차를 호출합니다. 실제 매크로는 종료 시의 히터/팬 상태, 가열 대기, 이동 완료 대기, 오류 처리까지 장비 담당자가 명시해야 합니다. HTTP 명령 응답은 물리 테스트 합격이나 모든 동작의 완료를 보장하지 않습니다. 비동기 매크로의 별도 완료 추적은 아직 없습니다.

Theta1/Theta2의 실제 Jog·위치·호밍은 계속 미구성입니다. 매크로에 회전축이 포함된다면 장비 담당자가 실제 구성으로 검증한 서버 매크로만 연결해야 합니다. UI HOME은 기존 `G28 X Z`를 유지합니다.

### 통신과 진단

- 일반 HTTP 요청 제한 시간은 10초, 매크로 요청은 120초입니다. 필요하면 `MoonrakerRobot` 생성 옵션 `timeoutMs` / `macroTimeoutMs`로 변경합니다.
- 자동 명령 재시도는 없습니다. 타임아웃은 서버 작업을 취소하지 않으며 실행 결과가 불명확하다는 뜻입니다. 컨트롤러 상태를 확인한 뒤 재연결합니다.
- E-stop은 일반 명령 대기를 거치지 않고 별도 `/printer/emergency_stop` 요청을 보냅니다. 네트워크가 끊겼다면 물리 정지를 보장할 수 없습니다. 요청 실패를 로그에 표시하고 UI 제어 잠금은 유지합니다.
- 온도 조회 실패 시 현재 값을 N/A로 바꾸고 차트 표본을 끊으며 일반 제어를 차단합니다. RECONNECT가 필요합니다. 새 연결은 장치 목록과 상태를 다시 조회합니다.
- CORS/인증/HTTPS mixed-content 문제는 Moonraker 호스트 설정에서 처리합니다. 현재 UI에는 API 키 입력·로그인 흐름이 없습니다. 주소 및 접근 정책부터 확인하세요.
- 실제 E-stop 복구는 이 UI에서 하지 않습니다. Klipper/호스트에서 정상 복구 후 상태를 다시 확인합니다.

API 기준 문서: [Moonraker printer API](https://moonraker.readthedocs.io/en/latest/external_api/printer/), [Klipper G-codes](https://www.klipper3d.org/G-Codes.html).

## 테스트

```powershell
node --test --test-isolation=none tests/app.test.js tests/mock-robot.test.js tests/moonraker-robot.test.js tests/ui-static.test.js tests/commissioning.test.js
node tests/run-browser.js
```

브라우저 테스트는 Windows Chrome 또는 Edge를 찾고 별도의 임시 프로필로 headless 실행합니다. 다른 위치는 `CHROME_PATH` 환경변수로 지정합니다. 포트 8765/9223을 사용하므로 미리보기 서버를 종료하고 실행하세요. 실제 Moonraker 요청은 테스트 페이지 내부의 응답 fixture로 대체합니다. 결과 이미지는 `tests/artifacts/commissioning-e2e.png`에 저장되며 Git에서 제외합니다.

브라우저 테스트 범위: 기존 4축/키보드/limit/E-stop, Active/Standby/Off, 온도 변화, 팬, 4종 Mock 매크로, 매크로 중 E-stop, 실제 모드의 미구성 차단과 프리셋 분리, API 명령 구성, 통신 장애, startup 상태의 제어 차단.

## 예외 상황 처리 보강 (2026-09-19)

기존 Mock/Moonraker 분리와 시운전 기능을 유지하고 상태 표시·장애 처리만 보강했습니다.

- 상단 기존 작업 상태와 별도로 `CONNECTION`에 연결 상태를 표시합니다. 연결 중/연결됨/연결 끊김과 작업 오류를 구분할 수 있습니다.
- 실제 비상정지는 `STOP REQUESTING` → `STOP ACKNOWLEDGED` 또는 `STOP UNCONFIRMED`로 표시합니다. ACKNOWLEDGED는 서버의 정상 응답 확인이며 물리 정지를 독립적으로 측정한 결과가 아닙니다. 실패해도 일반 제어 잠금은 유지하고 E-stop 버튼을 다시 사용할 수 있습니다. Mock에서는 기존 `EMERGENCY STOP`을 유지합니다.
- 제어 명령 응답이 누락되거나 오류가 발생하면 부분 실행 가능성을 고려하여 `OUTCOME UNKNOWN`으로 표시합니다. 조회 실패와 구분하며 명령은 자동 재전송하지 않습니다. 재연결 성공만으로 잠금은 해제되지 않습니다. 장비 상태를 확인한 후 `STATE CHECKED · UNLOCK`을 눌러야 합니다. 이 버튼은 사용자의 확인 기록이며 하드웨어 자동 검증 기능이 아닙니다.
- 실행 여부 미확인 기록은 현재 페이지 세션 내 같은 연결 주소에 대해 유지됩니다. 페이지 새로고침/종료 후에는 유지되지 않으므로 오류 발생 후 실제 컨트롤러 상태 확인은 필요합니다.
- 위치는 기존 수동/명령 후 조회 방식을 유지하며 마지막 수신 시각과 경과 시간을 표시합니다. 5초 초과 시 과거 스냅샷임을 `STALE`로 표시합니다.
- 온도는 기존 주기 조회를 유지합니다. 5초를 초과해 갱신되지 않으면 현재 표시를 N/A로 바꾸고 과거 수신 시각 및 STALE 표시를 남기며 일반 제어를 차단합니다. 재연결이 필요하며 늦게 도착한 응답은 버립니다. 차트 과거 이력은 보존하고 모드 변경/재연결 시 초기화합니다.
- 통신 장애 재현은 `tests/commissioning.test.js`, `tests/browser-e2e.js`의 모의 응답으로 수행합니다. 실제 모드에 장애 주입 기능을 추가하지 않았습니다. 연결 중 정지, 정지 응답 실패·지연, 명령 타임아웃, 오래된 응답, 모드 전환, 잠금 해제 시 재전송 방지를 검증합니다.

## 남은 실제 검증

최종 핀·전원·전류·기어비·이동 한계·센서·호밍·회전축 매핑, 히터 온도 범위와 보호 설정, 팬 종류, 실제 매크로, Moonraker 접근 정책이 필요합니다. UI 소프트웨어 제한 및 Mock 결과는 Klipper와 물리 안전장치를 대체하지 않습니다. 화면은 데스크톱 중심이며 터치 디스플레이·AI 제어는 후속 작업입니다.
