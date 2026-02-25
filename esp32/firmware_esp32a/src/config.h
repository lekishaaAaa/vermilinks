#pragma once

// WiFi
static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// MQTT
static const char* MQTT_HOST = "YOUR_MQTT_HOST";
static const int MQTT_PORT = 1883;
static const char* MQTT_USER = "YOUR_MQTT_USER";
static const char* MQTT_PASS = "YOUR_MQTT_PASSWORD";

static const char* TOPIC_STATE = "vermilinks/esp32a/state";
static const char* TOPIC_STATUS = "vermilinks/esp32a/status";
static const char* TOPIC_COMMAND = "vermilinks/esp32a/command";

// GPIO pins (ESP32 DevKit V1 30-pin safe mapping)
// Avoid boot strap pins (0, 2, 12, 15) and avoid direct-load switching on MCU pins.
static const int PIN_FLOAT = 32;
static const int PIN_PUMP = 18;
static const int PIN_VALVE1 = 25;
static const int PIN_VALVE2 = 26;
static const int PIN_VALVE3 = 27;
static const int PIN_STATUS_LED = 13;

// Float sensor logic
// Wiring: float switch between PIN_FLOAT and GND, using INPUT_PULLUP.
static const int FLOAT_LOW = 0;
static const int FLOAT_HIGH = 1;

// Publish intervals (ms)
static const unsigned long STATUS_INTERVAL_MS = 30000;
static const unsigned long FLOAT_SAMPLE_MS = 300;
