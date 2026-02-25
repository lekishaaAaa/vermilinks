#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include "config.h"
#include "state_store.h"
#include "actuator.h"
#include "mqtt_client.h"
#include "safety.h"

static ActuatorState currentState = getDefaultState();
static ActuatorState lastPublishedState = getDefaultState();
static unsigned long lastStatusMs = 0;
static unsigned long lastFloatCheck = 0;

static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

static void ensureTimeSync() {
  static bool synced = false;
  if (synced || WiFi.status() != WL_CONNECTED) {
    return;
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  synced = true;
}

static void ensureMqtt() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  mqttEnsureConnected();
}

void setup() {
  Serial.begin(115200);
  initActuators();
  initFloatSensor();
  mqttInit();
  mqttBindState(&currentState);
  ensureWifi();
  ensureTimeSync();

  // Fail-safe: pump off at boot
  currentState.pump = false;
  applyActuatorState(currentState);
}

void loop() {
  ensureWifi();
  ensureTimeSync();
  ensureMqtt();
  mqttLoop();

  const unsigned long now = millis();
  if (now - lastFloatCheck >= FLOAT_SAMPLE_MS) {
    lastFloatCheck = now;
    enforceFloatSafety(currentState);
    applyActuatorState(currentState);
  }

  const bool stateChanged =
    currentState.pump != lastPublishedState.pump ||
    currentState.valve1 != lastPublishedState.valve1 ||
    currentState.valve2 != lastPublishedState.valve2 ||
    currentState.valve3 != lastPublishedState.valve3 ||
    currentState.floatState != lastPublishedState.floatState;

  if (stateChanged && mqttConnected()) {
    mqttPublishState(currentState, true);
    lastPublishedState = currentState;
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    mqttPublishStatus(WiFi.status() == WL_CONNECTED);
  }
}
