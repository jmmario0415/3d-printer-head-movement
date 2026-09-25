# 라즈베리파이·Octopus 준비 안내

이 폴더는 실제 기체가 나오기 전 준비할 수 있는 파일을 모아 둔 곳입니다. `printer.cfg.template`은 **완성 설정 파일이 아니라 체크용 초안**입니다. 핀 번호, 드라이버 전류, 이동 한계, 히터/센서 종류를 추측해 채우지 않았습니다.

## 먼저 준비할 것

- 라즈베리파이 3/4/5 또는 성능이 비슷한 Linux 호스트, 안정적인 전원 어댑터와 microSD 카드
- Octopus의 **정확한 모델과 보드 리비전**, MCU 표기(F446/F429/F407/H723 등), 배선도
- 라즈베리파이와 Octopus를 연결할 USB 케이블(초기 연결은 USB 권장)
- Octopus에 쓸 FAT32 microSD 카드
- 모터·드라이버·엔드스톱·히터·온도센서·팬의 모델과 배선표

`Octopus`라는 이름만으로는 펌웨어 컴파일 설정을 정할 수 없습니다. 보드에 적힌 MCU 모델과 보드 문서를 먼저 확인하세요. BTT의 Octopus 문서는 MCU에 따라 bootloader와 crystal 값이 달라진다고 안내합니다.

## 전체 흐름

1. 라즈베리파이에 Raspberry Pi OS Lite 64-bit를 설치하고, 최초 부팅 전에 Wi-Fi(필요 시), 사용자명, 비밀번호, SSH를 설정한다.
2. 라즈베리파이에서 MainsailOS를 쓰거나 Raspberry Pi OS 위에 Klipper, Moonraker, Mainsail/Fluidd를 설치한다. 처음에는 MainsailOS가 가장 단순하다.
3. 라즈베리파이에서 Octopus용 Klipper 펌웨어를 컴파일한다.
4. `klipper.bin`을 `firmware.bin`으로 바꿔 Octopus microSD 카드의 최상위 폴더에 넣고, Octopus 전원을 켜서 플래시한다.
5. USB로 Pi와 Octopus를 연결하고, Pi에서 고유 시리얼 경로를 찾아 `printer.cfg`의 `[mcu]`에 넣는다.
6. 보드용 기준 설정을 바탕으로 기체 고유 설정을 작성한다. 전원·센서·방향·엔드스톱을 한 항목씩 검증한다.
7. Klipper가 `Ready`가 된 후에만 이 저장소 UI의 Moonraker 연결을 설정한다.

## 라즈베리파이에 설치하는 것

라즈베리파이는 세 프로그램을 실행합니다.

| 구성요소 | 역할 |
|---|---|
| Klipper | 이동 계산을 하고 Octopus MCU에 명령을 보냄 |
| Moonraker | 웹 UI와 Klipper 사이의 HTTP API 서버 |
| Mainsail 또는 Fluidd | 초기 설정, 로그 확인, 수동 테스트용 웹 화면 |

처음 설치에서는 MainsailOS를 microSD에 기록하면 위 구성이 한 번에 준비됩니다. Raspberry Pi OS Lite로 시작한다면 KIAUH 같은 설치 도구로 Klipper·Moonraker·Mainsail을 설치할 수 있습니다. 데스크톱 이미지보다 Lite를 권장하는 이유는 Klipper 공식 설치 문서가 데스크톱의 보조 프로그램이 장치 접근을 방해할 수 있다고 안내하기 때문입니다.

부팅 후 공유기 관리 화면에서 Pi의 IP를 확인하고, Windows PowerShell에서 다음처럼 접속합니다.

```powershell
ssh <Pi사용자명>@<Pi_IP>
```

예: `ssh pi@192.168.0.50`

브라우저에서 `http://<Pi_IP>`를 열어 Mainsail/Fluidd가 뜨면 Pi 쪽 준비가 된 것입니다.

## Octopus에 설치하는 것

Octopus에 설치하는 것은 Linux나 Moonraker가 아니라 **Klipper MCU 펌웨어**입니다. 라즈베리파이에 SSH로 접속한 뒤 다음을 실행합니다.

```bash
cd ~/klipper
make menuconfig
make
```

`make menuconfig`에서 MCU 모델, bootloader offset, crystal, 통신 방식(USB 또는 UART)을 Octopus의 정확한 문서대로 선택합니다. 모델이 다르면 이 값도 다릅니다. 빌드 결과는 보통 `~/klipper/out/klipper.bin`입니다.

1. `klipper.bin`의 이름을 `firmware.bin`으로 바꾼다.
2. FAT32 microSD 카드의 최상위 폴더에 넣는다.
3. Octopus의 전원을 끄고 카드를 넣은 뒤 전원을 켠다.
4. 보드가 지원하는 경우 파일명이 `FIRMWARE.CUR`로 바뀌는지 확인한다.

플래시 중에는 기체의 히터·모터 전원을 무작정 켜서 시험하지 마세요. 우선 Pi와 Octopus의 통신만 확인합니다.

## Pi로 옮기는 파일과 위치

MainsailOS 계열의 일반적인 위치는 다음과 같습니다. 화면의 **Configuration Files** 편집기를 사용하면 경로를 외울 필요가 없습니다.

| 파일 | Pi의 일반 위치 | 하는 일 |
|---|---|---|
| `printer.cfg` | `~/printer_data/config/printer.cfg` | Klipper의 보드·모터·센서·히터·매크로 설정 |
| `moonraker.conf` | `~/printer_data/config/moonraker.conf` | Moonraker 접근 정책과 API 설정 |
| 이 프로젝트의 `commissioning-config.js` | **개발 PC 저장소** | 웹 UI가 Klipper 객체명을 찾도록 매핑 |

`printer.cfg.template`은 Pi에 `printer.cfg`라는 이름으로 복사하기 전에 실제 설정으로 완성해야 합니다. 먼저 Octopus 보드에 맞는 기준 `generic-bigtreetech-octopus.cfg`를 구하고, 그 위에 기체 설정을 작성하세요. BTT 기준 설정도 기체의 thermistor, 엔드스톱, PID, 이동 한계 등을 별도로 확인하라고 명시합니다.

펌웨어 플래시 후 Pi에서 다음을 실행합니다.

```bash
ls /dev/serial/by-id/*
```

출력된 한 줄을 `[mcu]`의 `serial:`에 그대로 복사합니다. `/dev/ttyACM0`처럼 바뀔 수 있는 짧은 경로는 쓰지 않습니다.

## 이 프로젝트와 Moonraker 연결

Klipper가 Ready가 되고 Mainsail/Fluidd에서 상태와 위치 조회가 되는 뒤에 진행합니다.

1. 개발 PC의 `commissioning-config.js`를 연다.
2. 실제 `printer.cfg`에 있는 객체명만 `MOONRAKER_CONFIG`에 넣는다. 예를 들어 `[extruder]`는 `extruder`, `[heater_bed]`는 `heater_bed`다.
3. 개발 PC에서 `node serve.js`를 실행하고 `http://127.0.0.1:8765`를 연다.
4. Moonraker 모드를 고르고 `http://<Pi_IP>:7125`를 입력해 연결한다.

PC 브라우저에서 Pi의 Moonraker에 직접 접속할 때는 Moonraker가 PC IP를 신뢰하고, UI 주소를 CORS origin으로 허용해야 합니다. `moonraker.conf.snippet`의 `trusted_clients`와 `cors_domains`를 실제 사설망 대역 및 UI 주소에 맞춰 `moonraker.conf`에 병합한 뒤 Moonraker를 재시작합니다. 이 UI에는 API 키 로그인 화면이 없으므로, 처음 연결은 외부 공개 없이 같은 사설망에서 수행하세요.

## 처음 검증할 순서

1. `status`에서 Klipper가 `Ready`인지 확인한다.
2. 전원 없이 각 센서가 온도·엔드스톱 상태를 올바르게 읽는지 확인한다.
3. 모터를 매우 짧고 느리게 한 축씩 움직여 방향과 엔드스톱을 확인한다.
4. 히터는 온도센서 값이 정상일 때만, 장비 담당자가 지켜보며 하나씩 확인한다.
5. 팬을 하나씩 확인한다.
6. Mainsail/Fluidd에서의 수동 검증이 끝난 기능만 이 프로젝트 UI의 매핑과 매크로에 연결한다.

theta1/theta2는 표준 Cartesian X/Y/Z/E 축으로 임의 매핑하지 않습니다. 실제 회전축의 기구학과 안전 한계가 확정된 후 Klipper 설정 또는 전용 매크로 설계를 결정합니다.

## 참고 문서

- [Klipper 설치 안내](https://www.klipper3d.org/Installation.html)
- [Moonraker 설정의 authorization](https://moonraker.readthedocs.io/en/latest/configuration/#authorization)
- [BTT Octopus Klipper 안내](https://github.com/bigtreetech/BIGTREETECH-OCTOPUS-V1.0/blob/master/Firmware/Klipper/README.md)
