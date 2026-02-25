#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include "config.h"
#include "sensors.h"
#include "mqtt_client.h"

static unsigned long lastTelemetryMs = 0;
static unsigned long lastStatusMs = 0;

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
  initSensors();
  mqttInit();
  ensureWifi();
  ensureTimeSync();
}

void loop() {
  ensureWifi();
  ensureTimeSync();
  ensureMqtt();
  mqttLoop();

  const unsigned long now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    const SensorSnapshot snapshot = readSensors();
    mqttPublishTelemetry(snapshot);
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    mqttPublishStatus(WiFi.status() == WL_CONNECTED);
  }
}
