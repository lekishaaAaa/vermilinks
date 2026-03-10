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
static unsigned long lastWifiAttemptMs = 0;
static unsigned long lastMqttAttemptMs = 0;
static bool wifiReconnectLogged = false;
static bool mqttReconnectLogged = false;

static const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
static const unsigned long MQTT_RETRY_INTERVAL_MS = 3000;

static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiReconnectLogged) {
      Serial.println("WiFi reconnected");
      wifiReconnectLogged = false;
    }
    return;
  }

  const unsigned long now = millis();
  if (!wifiReconnectLogged) {
    Serial.println("WiFi disconnected. Reconnecting...");
    wifiReconnectLogged = true;
  }

  if (lastWifiAttemptMs != 0 && (now - lastWifiAttemptMs) < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  lastWifiAttemptMs = now;
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 10) {
    delay(300);
    retries += 1;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi reconnected");
    wifiReconnectLogged = false;
  } else {
    Serial.println("WiFi reconnect failed");
  }
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

  if (mqttConnected()) {
    if (mqttReconnectLogged) {
      Serial.println("MQTT reconnected");
      mqttReconnectLogged = false;
    }
    return;
  }

  const unsigned long now = millis();
  if (!mqttReconnectLogged) {
    Serial.println("MQTT disconnected. Reconnecting...");
    mqttReconnectLogged = true;
  }

  if (lastMqttAttemptMs != 0 && (now - lastMqttAttemptMs) < MQTT_RETRY_INTERVAL_MS) {
    return;
  }

  lastMqttAttemptMs = now;
  mqttEnsureConnected();

  if (mqttConnected()) {
    Serial.println("MQTT reconnected");
    mqttReconnectLogged = false;
  } else {
    Serial.println("MQTT reconnect failed");
  }
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
    currentState.forcePumpOverride != lastPublishedState.forcePumpOverride ||
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
