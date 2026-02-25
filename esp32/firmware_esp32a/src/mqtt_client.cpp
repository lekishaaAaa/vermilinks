#include "mqtt_client.h"
#include <ArduinoJson.h>
#include "config.h"
#include "actuator.h"
#include "safety.h"

static WiFiClient wifiClient;
static PubSubClient mqttClient(wifiClient);
static ActuatorState* stateRef = nullptr;
static const char* kLwtTopic = "vermilinks/device_status/esp32a";
static const char* kLwtOfflinePayload = "offline";
static const char* kLwtOnlinePayload = "online";
static const uint8_t kLwtQos = 1;
static const bool kLwtRetained = true;
static unsigned long mqttBackoffMs = 1000UL;
static unsigned long mqttNextAttemptMs = 0UL;
static char mqttClientId[40];
static bool mqttClientIdReady = false;

static ActuatorState lastState;

static void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  if (String(topic) != TOPIC_COMMAND) {
    return;
  }

  String raw;
  for (unsigned int i = 0; i < length; i += 1) {
    raw += static_cast<char>(payload[i]);
  }

  mqttHandleCommand(raw.c_str());
}

void mqttInit() {
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  pinMode(PIN_STATUS_LED, OUTPUT);
  digitalWrite(PIN_STATUS_LED, LOW);
  if (!mqttClientIdReady) {
    const unsigned long long mac = static_cast<unsigned long long>(ESP.getEfuseMac());
    snprintf(mqttClientId, sizeof(mqttClientId), "vermilinks-esp32a-%llX", mac);
    mqttClientIdReady = true;
  }
}

void mqttBindState(ActuatorState* state) {
  stateRef = state;
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

  mqttClient.subscribe(TOPIC_COMMAND);

  if (stateRef) {
    mqttPublishState(*stateRef, true);
  }
}

void mqttPublishState(const ActuatorState& state, bool retained) {
  if (!mqttConnected()) {
    return;
  }
  String payload = "{";
  payload += "\"pump\":" + String(state.pump ? "true" : "false") + ",";
  payload += "\"valve1\":" + String(state.valve1 ? "true" : "false") + ",";
  payload += "\"valve2\":" + String(state.valve2 ? "true" : "false") + ",";
  payload += "\"valve3\":" + String(state.valve3 ? "true" : "false") + ",";
  payload += "\"float\":\"" + state.floatState + "\",";
  payload += "\"requestId\":\"" + state.requestId + "\",";
  payload += "\"source\":\"" + state.source + "\",";
  payload += "\"ts\":" + String(static_cast<long>(time(nullptr))) + "";
  payload += "}";
  mqttClient.publish(TOPIC_STATE, payload.c_str(), retained);
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

void mqttLoop() {
  if (!mqttConnected()) {
    digitalWrite(PIN_STATUS_LED, LOW);
    return;
  }
  digitalWrite(PIN_STATUS_LED, HIGH);
  mqttClient.loop();
}

void mqttHandleCommand(const char* payload) {
  if (!stateRef) {
    return;
  }

  StaticJsonDocument<256> doc;
  const DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    return;
  }

  if (!doc.containsKey("pump") ||
      !doc.containsKey("valve1") ||
      !doc.containsKey("valve2") ||
      !doc.containsKey("valve3") ||
      !doc.containsKey("requestId")) {
    return;
  }

  if (!doc["pump"].is<bool>() ||
      !doc["valve1"].is<bool>() ||
      !doc["valve2"].is<bool>() ||
      !doc["valve3"].is<bool>() ||
      !doc["requestId"].is<const char*>()) {
    return;
  }

  const char* requestId = doc["requestId"].as<const char*>();
  if (!requestId || String(requestId).length() == 0) {
    return;
  }

  stateRef->pump = doc["pump"].as<bool>();
  stateRef->valve1 = doc["valve1"].as<bool>();
  stateRef->valve2 = doc["valve2"].as<bool>();
  stateRef->valve3 = doc["valve3"].as<bool>();
  stateRef->requestId = String(requestId);
  stateRef->source = "applied";

  enforceFloatSafety(*stateRef);
  applyActuatorState(*stateRef);
  mqttPublishState(*stateRef, true);
}
