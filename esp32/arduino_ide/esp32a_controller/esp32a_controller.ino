#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ESP32-A: actuator controller + float safety
// Install libraries in Arduino IDE:
// - PubSubClient by Nick O'Leary
// - ArduinoJson by Benoit Blanchon

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

static const char* DEVICE_ID = "esp32A";

static const char* TOPIC_STATE = "vermilinks/esp32a/state";
static const char* TOPIC_STATUS = "vermilinks/esp32a/status";
static const char* TOPIC_COMMAND = "vermilinks/esp32a/command";
static const char* TOPIC_ACK = "vermilinks/esp32a/ack";
static const char* TOPIC_LWT = "vermilinks/device_status/esp32a";

static const int FLOAT_PIN = 14;
static const int PUMP_PIN = 5;
static const int VALVE1_PIN = 25;
static const int VALVE2_PIN = 26;
static const int VALVE3_PIN = 27;
static const int STATUS_LED_PIN = 13;

static const int FLOAT_LOW = 0;
static const unsigned long STATUS_INTERVAL_MS = 30000UL;
static const unsigned long FLOAT_SAMPLE_MS = 300UL;
static const unsigned long WIFI_RETRY_INTERVAL_MS = 5000UL;
static const unsigned long MQTT_RETRY_INTERVAL_MS = 3000UL;

struct ActuatorState {
  bool pump;
  bool valve1;
  bool valve2;
  bool valve3;
  String floatState;
  String requestId;
  String source;
};

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);
ActuatorState currentState;
ActuatorState lastPublishedState;

unsigned long lastStatusMs = 0;
unsigned long lastFloatCheckMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;

bool wifiReconnectLogged = false;
bool mqttReconnectLogged = false;
bool mqttClientIdReady = false;
char mqttClientId[48];

void printBootDiagnostics() {
  Serial.println("[ESP32-A] VermiLinks controller boot");
  Serial.printf("[ESP32-A] Device ID: %s\n", DEVICE_ID);
  Serial.printf("[ESP32-A] MQTT broker: %s:%u\n", MQTT_HOST, MQTT_PORT);
  Serial.printf("[ESP32-A] Topics: command=%s state=%s ack=%s status=%s\n", TOPIC_COMMAND, TOPIC_STATE, TOPIC_ACK, TOPIC_STATUS);
  Serial.printf("[ESP32-A] Pins: float=%d pump=%d valve1=%d valve2=%d valve3=%d led=%d\n", FLOAT_PIN, PUMP_PIN, VALVE1_PIN, VALVE2_PIN, VALVE3_PIN, STATUS_LED_PIN);
  Serial.printf("[ESP32-A] Initial float raw=%d\n", digitalRead(FLOAT_PIN));
}

ActuatorState getDefaultState() {
  ActuatorState state;
  state.pump = false;
  state.valve1 = false;
  state.valve2 = false;
  state.valve3 = false;
  state.floatState = "UNKNOWN";
  state.requestId = "";
  state.source = "boot";
  return state;
}

void initActuators() {
  pinMode(PUMP_PIN, OUTPUT);
  pinMode(VALVE1_PIN, OUTPUT);
  pinMode(VALVE2_PIN, OUTPUT);
  pinMode(VALVE3_PIN, OUTPUT);

  digitalWrite(PUMP_PIN, LOW);
  digitalWrite(VALVE1_PIN, LOW);
  digitalWrite(VALVE2_PIN, LOW);
  digitalWrite(VALVE3_PIN, LOW);
}

void applyActuatorState(const ActuatorState& state) {
  digitalWrite(PUMP_PIN, state.pump ? HIGH : LOW);
  digitalWrite(VALVE1_PIN, state.valve1 ? HIGH : LOW);
  digitalWrite(VALVE2_PIN, state.valve2 ? HIGH : LOW);
  digitalWrite(VALVE3_PIN, state.valve3 ? HIGH : LOW);
}

void initFloatSensor() {
  pinMode(FLOAT_PIN, INPUT_PULLUP);
}

bool floatIsLow() {
  return digitalRead(FLOAT_PIN) == FLOAT_LOW;
}

void enforceFloatSafety(ActuatorState& state) {
  if (floatIsLow()) {
    state.pump = false;
    state.floatState = "LOW";
    state.source = "safety_override";
  } else {
    state.floatState = "HIGH";
  }
}

bool mqttConnected() {
  return mqttClient.connected();
}

void ensureTimeSync() {
  static bool synced = false;
  if (synced || WiFi.status() != WL_CONNECTED) {
    return;
  }
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  synced = true;
}

void publishJson(const char* topic, JsonDocument& doc, bool retained) {
  char buffer[512];
  const size_t written = serializeJson(doc, buffer, sizeof(buffer));
  if (written > 0) {
    mqttClient.publish(topic, buffer, retained);
  }
}

void mqttPublishState(const ActuatorState& state, bool retained) {
  if (!mqttConnected()) {
    return;
  }

  StaticJsonDocument<384> doc;
  const long unixTs = static_cast<long>(time(nullptr));
  doc["deviceId"] = DEVICE_ID;
  doc["device_id"] = DEVICE_ID;
  doc["temperature"] = nullptr;
  doc["humidity"] = nullptr;
  doc["soil_moisture"] = nullptr;
  doc["soil_temperature"] = nullptr;
  doc["pump"] = state.pump;
  doc["valve1"] = state.valve1;
  doc["valve2"] = state.valve2;
  doc["valve3"] = state.valve3;
  doc["float"] = state.floatState;
  doc["requestId"] = state.requestId;
  doc["source"] = state.source;
  doc["timestamp"] = unixTs;
  doc["ts"] = unixTs;
  publishJson(TOPIC_STATE, doc, retained);
}

void mqttPublishAck(const ActuatorState& state) {
  if (!mqttConnected()) {
    return;
  }

  StaticJsonDocument<320> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["device_id"] = DEVICE_ID;
  doc["requestId"] = state.requestId;
  doc["ack"] = true;
  doc["pump"] = state.pump;
  doc["valve1"] = state.valve1;
  doc["valve2"] = state.valve2;
  doc["valve3"] = state.valve3;
  doc["source"] = state.source;
  doc["ts"] = static_cast<long>(time(nullptr));
  publishJson(TOPIC_ACK, doc, false);
}

void mqttPublishStatus(bool online) {
  if (!mqttConnected()) {
    return;
  }

  StaticJsonDocument<256> doc;
  const long unixTs = static_cast<long>(time(nullptr));
  doc["deviceId"] = DEVICE_ID;
  doc["device_id"] = DEVICE_ID;
  doc["online"] = online;
  doc["rssi"] = WiFi.RSSI();
  doc["uptime"] = millis() / 1000UL;
  doc["timestamp"] = unixTs;
  doc["ts"] = unixTs;
  publishJson(TOPIC_STATUS, doc, false);
}

void handleCommandPayload(const char* payload) {
  StaticJsonDocument<320> doc;
  const DeserializationError error = deserializeJson(doc, payload);
  if (error) {
    return;
  }

  if (!doc.containsKey("pump") || !doc.containsKey("valve1") || !doc.containsKey("valve2") || !doc.containsKey("valve3") || !doc.containsKey("requestId")) {
    return;
  }

  if (!doc["pump"].is<bool>() || !doc["valve1"].is<bool>() || !doc["valve2"].is<bool>() || !doc["valve3"].is<bool>() || !doc["requestId"].is<const char*>()) {
    return;
  }

  const char* requestId = doc["requestId"].as<const char*>();
  if (!requestId || strlen(requestId) == 0) {
    return;
  }

  currentState.pump = doc["pump"].as<bool>();
  currentState.valve1 = doc["valve1"].as<bool>();
  currentState.valve2 = doc["valve2"].as<bool>();
  currentState.valve3 = doc["valve3"].as<bool>();
  currentState.requestId = String(requestId);
  currentState.source = "applied";

  enforceFloatSafety(currentState);
  applyActuatorState(currentState);
  mqttPublishState(currentState, true);
  mqttPublishAck(currentState);
  lastPublishedState = currentState;
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (String(topic) != TOPIC_COMMAND) {
    return;
  }

  String raw;
  raw.reserve(length + 1);
  for (unsigned int index = 0; index < length; index += 1) {
    raw += static_cast<char>(payload[index]);
  }
  handleCommandPayload(raw.c_str());
}

void mqttInit() {
  secureClient.setInsecure();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  if (!mqttClientIdReady) {
    const unsigned long long mac = static_cast<unsigned long long>(ESP.getEfuseMac());
    snprintf(mqttClientId, sizeof(mqttClientId), "vermilinks-esp32a-%llX", mac);
    mqttClientIdReady = true;
  }
}

void mqttEnsureConnected() {
  if (mqttConnected() || WiFi.status() != WL_CONNECTED) {
    return;
  }

  const unsigned long now = millis();
  if (lastMqttAttemptMs != 0 && (now - lastMqttAttemptMs) < MQTT_RETRY_INTERVAL_MS) {
    return;
  }
  lastMqttAttemptMs = now;

  const bool connected = mqttClient.connect(
    mqttClientId,
    MQTT_USER,
    MQTT_PASS,
    TOPIC_LWT,
    1,
    true,
    "offline"
  );

  if (!connected) {
    digitalWrite(STATUS_LED_PIN, LOW);
    return;
  }

  digitalWrite(STATUS_LED_PIN, HIGH);
  mqttClient.publish(TOPIC_LWT, "online", true);
  mqttClient.subscribe(TOPIC_COMMAND);
  mqttPublishState(currentState, true);
}

void mqttLoop() {
  if (!mqttConnected()) {
    digitalWrite(STATUS_LED_PIN, LOW);
    return;
  }
  digitalWrite(STATUS_LED_PIN, HIGH);
  mqttClient.loop();
}

void ensureWifi() {
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
}

void setup() {
  Serial.begin(115200);
  currentState = getDefaultState();
  lastPublishedState = getDefaultState();

  initActuators();
  initFloatSensor();
  mqttInit();
  printBootDiagnostics();

  currentState.pump = false;
  applyActuatorState(currentState);

  ensureWifi();
  ensureTimeSync();
}

void loop() {
  ensureWifi();
  ensureTimeSync();
  mqttEnsureConnected();
  mqttLoop();

  const unsigned long now = millis();
  if (now - lastFloatCheckMs >= FLOAT_SAMPLE_MS) {
    lastFloatCheckMs = now;
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
