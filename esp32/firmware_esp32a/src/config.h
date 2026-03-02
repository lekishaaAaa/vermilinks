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
static const char* TOPIC_ACK = "vermilinks/esp32a/ack";

// Actuator GPIO hard-lock (do not override)
#if defined(FLOAT_PIN) || defined(PUMP_PIN) || defined(VALVE1_PIN) || defined(VALVE2_PIN) || defined(VALVE3_PIN)
#error "Actuator GPIO pin macros must not be pre-defined before config.h"
#endif

#define FLOAT_PIN 14
#define PUMP_PIN 5
#define VALVE1_PIN 25
#define VALVE2_PIN 26
#define VALVE3_PIN 27

static constexpr int kExpectedFloatPin = 14;
static constexpr int kExpectedPumpPin = 5;
static constexpr int kExpectedValve1Pin = 25;
static constexpr int kExpectedValve2Pin = 26;
static constexpr int kExpectedValve3Pin = 27;

static_assert(FLOAT_PIN == kExpectedFloatPin, "GPIO lock violation: FLOAT_PIN");
static_assert(PUMP_PIN == kExpectedPumpPin, "GPIO lock violation: PUMP_PIN");
static_assert(VALVE1_PIN == kExpectedValve1Pin, "GPIO lock violation: VALVE1_PIN");
static_assert(VALVE2_PIN == kExpectedValve2Pin, "GPIO lock violation: VALVE2_PIN");
static_assert(VALVE3_PIN == kExpectedValve3Pin, "GPIO lock violation: VALVE3_PIN");
static_assert(PUMP_PIN != VALVE1_PIN && PUMP_PIN != VALVE2_PIN && PUMP_PIN != VALVE3_PIN, "GPIO lock violation: pump pin overlap");
static_assert(VALVE1_PIN != VALVE2_PIN && VALVE1_PIN != VALVE3_PIN && VALVE2_PIN != VALVE3_PIN, "GPIO lock violation: valve pin overlap");

static const int PIN_STATUS_LED = 13;

// Float sensor logic
// Wiring: float switch between FLOAT_PIN and GND, using INPUT_PULLUP.
static const int FLOAT_LOW = 0;
static const int FLOAT_HIGH = 1;

// Publish intervals (ms)
static const unsigned long STATUS_INTERVAL_MS = 30000;
static const unsigned long FLOAT_SAMPLE_MS = 300;
