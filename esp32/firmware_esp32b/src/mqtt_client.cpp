#include "mqtt_client.h"
#include "config.h"

static WiFiClient wifiClient;
static PubSubClient mqttClient(wifiClient);
static const char* kLwtTopic = "vermilinks/device_status/esp32b";
static const char* kLwtOfflinePayload = "offline";
static const char* kLwtOnlinePayload = "online";
static const uint8_t kLwtQos = 1;
static const bool kLwtRetained = true;
static unsigned long mqttBackoffMs = 1000UL;
static unsigned long mqttNextAttemptMs = 0UL;
static char mqttClientId[40];
static bool mqttClientIdReady = false;

void mqttInit() {
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);
  if (!mqttClientIdReady) {
    const unsigned long long mac = static_cast<unsigned long long>(ESP.getEfuseMac());
    snprintf(mqttClientId, sizeof(mqttClientId), "vermilinks-esp32b-%llX", mac);
    mqttClientIdReady = true;
  }
}

bool mqttConnected() {
  return mqttClient.connected();
}

void mqttEnsureConnected() {
  if (mqttConnected()) {
    return;
  }

  const unsigned long now = millis();
  if (mqttNextAttemptMs != 0UL && static_cast<long>(now - mqttNextAttemptMs) < 0) {
    return;
  }

  const bool connected = mqttClient.connect(
      mqttClientId,
      MQTT_USER,
      MQTT_PASS,
      kLwtTopic,
      kLwtQos,
      kLwtRetained,
      kLwtOfflinePayload);
  if (!connected) {
    digitalWrite(PIN_STATUS_LED, LOW);
    if (mqttBackoffMs < 30000UL) {
      mqttBackoffMs = mqttBackoffMs * 2UL;
      if (mqttBackoffMs > 30000UL) {
        mqttBackoffMs = 30000UL;
      }
    }
    mqttNextAttemptMs = now + mqttBackoffMs;
    return;
  }

  mqttBackoffMs = 1000UL;
  mqttNextAttemptMs = 0UL;
  digitalWrite(PIN_STATUS_LED, HIGH);
  mqttClient.publish(kLwtTopic, kLwtOnlinePayload, kLwtQos, kLwtRetained);
}

void mqttLoop() {
  if (!mqttConnected()) {
    digitalWrite(PIN_STATUS_LED, LOW);
    return;
  }
  digitalWrite(PIN_STATUS_LED, HIGH);
  mqttClient.loop();
}

void mqttPublishTelemetry(const SensorSnapshot& snapshot) {
  if (!mqttConnected()) {
    return;
  }
  String payload = "{";
  payload += "\"tempC\":" + String(snapshot.tempC, 1) + ",";
  payload += "\"humidity\":" + String(snapshot.humidity, 1) + ",";
  payload += "\"soil\":" + String(snapshot.soil) + ",";
  payload += "\"waterTempC\":" + String(snapshot.waterTempC, 1) + ",";
  payload += "\"ts\":" + String(static_cast<long>(time(nullptr))) + "";
  payload += "}";
  mqttClient.publish(TOPIC_TELEMETRY, payload.c_str(), false);
}

void mqttPublishStatus(bool online) {
  if (!mqttConnected()) {
    return;
  }
  String payload = "{";
  payload += "\"online\":" + String(online ? "true" : "false") + ",";
  payload += "\"rssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"uptime\":" + String(millis() / 1000) + ",";
  payload += "\"ts\":" + String(static_cast<long>(time(nullptr))) + "";
  payload += "}";
  mqttClient.publish(TOPIC_STATUS, payload.c_str(), false);
}
