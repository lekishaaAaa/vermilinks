#pragma once

// WiFi
static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// MQTT
static const char* MQTT_HOST = "YOUR_MQTT_HOST";
static const int MQTT_PORT = 1883;
static const char* MQTT_USER = "YOUR_MQTT_USER";
static const char* MQTT_PASS = "YOUR_MQTT_PASSWORD";

static const char* TOPIC_TELEMETRY = "vermilinks/esp32b/telemetry";
static const char* TOPIC_STATUS = "vermilinks/esp32b/status";

// GPIO pins (ESP32 DevKit V1 30-pin safe mapping)
// DHT22 data pins (external 10kΩ pull-up from data to 3.3V required per sensor)
static const int PIN_DHT1 = 16;
static const int PIN_DHT2 = 17;

// Soil moisture analog pins (ADC1 only; do NOT use ADC2 with Wi-Fi)
static const int PIN_SOIL1 = 32; // ADC1
static const int PIN_SOIL2 = 33; // ADC1
static const int PIN_SOIL3 = 34; // ADC1, input-only
static const int PIN_SOIL4 = 35; // ADC1, input-only

// DS18B20 one-wire bus pin (all 4 probes share this bus)
// External 4.7kΩ pull-up from one-wire data line to 3.3V is required.
static const int PIN_DS18B20_BUS = 18;

// Optional MQTT status LED
static const int PIN_STATUS_LED = 13;

// Soil sensor calibration (raw ADC). Tune these after deployment.
static const int SOIL_RAW_DRY = 3000;
static const int SOIL_RAW_WET = 1200;

// Publish intervals (ms)
static const unsigned long TELEMETRY_INTERVAL_MS = 5000;
static const unsigned long STATUS_INTERVAL_MS = 30000;
