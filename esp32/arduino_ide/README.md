# Arduino IDE Firmware Entry Points

These sketches are Arduino-IDE-ready entry points for the current VermiLinks MQTT contract.

Folders:
- `esp32/arduino_ide/esp32a_controller/esp32a_controller.ino`
- `esp32/arduino_ide/esp32b_sensors/esp32b_sensors.ino`

## Install Libraries

Install these from Arduino Library Manager:
- `PubSubClient`
- `ArduinoJson`
- `DHT sensor library`
- `Adafruit Unified Sensor`
- `OneWire`
- `DallasTemperature`

## Required Board Setup

Use Arduino IDE with ESP32 board support installed.
Recommended board target:
- `ESP32 Dev Module`

## Before Flashing

Create a local secrets header in each sketch folder before flashing:
- Copy `secrets.example.h` to `secrets.h`
- Fill in your Wi-Fi and MQTT credentials in `secrets.h`

The broker host is already set to the current HiveMQ Cloud endpoint.
The sketches use TLS on port `8883` via `WiFiClientSecure`.

Files to create locally:
- `esp32/arduino_ide/esp32a_controller/secrets.h`
- `esp32/arduino_ide/esp32b_sensors/secrets.h`

These local files should stay machine-local and should not be committed.

## Board Roles

ESP32-A:
- Actuator controller
- Float safety lockout
- Subscribes to `vermilinks/esp32a/command`
- Publishes `vermilinks/esp32a/state`
- Publishes `vermilinks/esp32a/ack`
- Publishes `vermilinks/esp32a/status`

ESP32-B:
- Sensor publisher
- Publishes `vermilinks/esp32b/metrics`
- Publishes `vermilinks/esp32b/status`

## Current Pin Maps

ESP32-A:
- Float: GPIO14
- Pump: GPIO5
- Valve1: GPIO25
- Valve2: GPIO26
- Valve3: GPIO27
- Status LED: GPIO13

ESP32-B:
- DHT22 #1: GPIO4
- DHT22 #2: GPIO16
- Soil #1: GPIO34
- Soil #2: GPIO35
- Soil #3: GPIO32
- Soil #4: GPIO33
- DS18B20 bus: GPIO17
- Status LED: GPIO13

## Important Note

The source firmware files under `esp32/firmware_esp32a/src/` and `esp32/firmware_esp32b/src/` remain the code authority for system behavior.
Some historical docs in `docs/` describe older pin maps; use the sketch pin maps above unless you intentionally rewire the hardware.

## Commissioning Sequence

1. Flash `esp32a_controller.ino` to the actuator board.
2. Open Serial Monitor at `115200` and confirm boot diagnostics print the expected pin map and MQTT host.
3. Flash `esp32b_sensors.ino` to the sensor board.
4. Open Serial Monitor at `115200` and confirm telemetry snapshots are printing every 5 seconds.
5. Verify backend receives `vermilinks/esp32a/status`, `vermilinks/esp32a/state`, `vermilinks/esp32b/status`, and `vermilinks/esp32b/metrics`.
6. Only after both boards appear online should you test dashboard telemetry and actuator control.
