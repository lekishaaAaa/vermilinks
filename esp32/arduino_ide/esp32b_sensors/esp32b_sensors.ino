#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>
#include <time.h>

// ESP32-B: sensor publisher
// Install libraries in Arduino IDE:
// - PubSubClient by Nick O'Leary
// - DHT sensor library by Adafruit
// - Adafruit Unified Sensor
// - OneWire
// - DallasTemperature
// - ArduinoJson by Benoit Blanchon

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

static const char* DEVICE_ID = "esp32B";
static const char* BUILD_TAG = "esp32b-wdtfix-20260311a";

static const char* TOPIC_TELEMETRY = "vermilinks/esp32B/telemetry";
static const char* TOPIC_STATUS = "vermilinks/esp32B/status";
static const char* TOPIC_LWT = "vermilinks/device_status/esp32b";

static const int PIN_DHT1 = 21;
static const int PIN_DHT2 = 22;
static const int PIN_SOIL1 = 34;
static const int PIN_SOIL2 = 35;
static const int PIN_SOIL3 = 36;
static const int PIN_DS18B20_1 = 4;
static const int PIN_DS18B20_2 = 16;
static const int PIN_DS18B20_3 = 17;
static const int PIN_FLOAT_SENSOR = 27;
static const int STATUS_LED_PIN = 13;

static const int SOIL_RAW_DRY = 3000;
static const int SOIL_RAW_WET = 1200;
static const int FLOAT_LOW_THRESHOLD = 1200;
static const int FLOAT_HIGH_THRESHOLD = 2800;
static const int SOIL_FILTER_WINDOW = 5;
static const unsigned long TELEMETRY_INTERVAL_MS = 10000UL;
static const unsigned long STATUS_INTERVAL_MS = 60000UL;
static const unsigned long WIFI_RETRY_INTERVAL_MS = 5000UL;
static const unsigned long MQTT_RETRY_INTERVAL_MS = 10000UL;
static const unsigned long MQTT_POST_CONNECT_SETTLE_MS = 1500UL;
static const uint16_t MQTT_SOCKET_TIMEOUT_SEC = 5;

struct SensorSnapshot {
  float ambientTempC;
  float ambientHumidity;
  float binTempC;
  float binHumidity;
  float tempC;
  float humidity;
  float soilLayer[3];
  float soil;
  float soilTempLayer[3];
  float waterTempC;
  int floatLevelState;
  const char* floatStatus;
};

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);
DHT dht1(PIN_DHT1, DHT22);
DHT dht2(PIN_DHT2, DHT22);
OneWire oneWire1(PIN_DS18B20_1);
OneWire oneWire2(PIN_DS18B20_2);
OneWire oneWire3(PIN_DS18B20_3);
DallasTemperature dsBus1(&oneWire1);
DallasTemperature dsBus2(&oneWire2);
DallasTemperature dsBus3(&oneWire3);

const int SOIL_PINS[3] = { PIN_SOIL1, PIN_SOIL2, PIN_SOIL3 };
DallasTemperature* const DS_BUSES[3] = { &dsBus1, &dsBus2, &dsBus3 };
float soilHistory[3][SOIL_FILTER_WINDOW] = { {0} };
int soilHistoryCount[3] = { 0, 0, 0 };
int soilHistoryIndex[3] = { 0, 0, 0 };

unsigned long lastTelemetryMs = 0;
unsigned long lastStatusMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;
char mqttClientId[48];
bool mqttClientIdReady = false;
bool wifiReconnectLogged = false;
bool mqttOnlineAnnouncePending = false;
unsigned long lastMqttConnectMs = 0;

const char* mqttStateLabel(int state) {
  switch (state) {
    case -4:
      return "MQTT_CONNECTION_TIMEOUT";
    case -3:
      return "MQTT_CONNECTION_LOST";
    case -2:
      return "MQTT_CONNECT_FAILED";
    case -1:
      return "MQTT_DISCONNECTED";
    case 0:
      return "MQTT_CONNECTED";
    case 1:
      return "MQTT_BAD_PROTOCOL";
    case 2:
      return "MQTT_BAD_CLIENT_ID";
    case 3:
      return "MQTT_UNAVAILABLE";
    case 4:
      return "MQTT_BAD_CREDENTIALS";
    case 5:
      return "MQTT_UNAUTHORIZED";
    default:
      return "MQTT_UNKNOWN";
  }
}

void printBootDiagnostics() {
  Serial.println("[ESP32-B] VermiLinks sensor node boot");
  Serial.printf("[ESP32-B] Build: %s\n", BUILD_TAG);
  Serial.printf("[ESP32-B] Device ID: %s\n", DEVICE_ID);
  Serial.printf("[ESP32-B] MQTT broker: %s:%u\n", MQTT_HOST, MQTT_PORT);
  Serial.printf("[ESP32-B] Topics: telemetry=%s status=%s lwt=%s\n", TOPIC_TELEMETRY, TOPIC_STATUS, TOPIC_LWT);
  Serial.printf(
    "[ESP32-B] Pins: dht1=%d dht2=%d soil1=%d soil2=%d soil3=%d ds1=%d ds2=%d ds3=%d float=%d led=%d\n",
    PIN_DHT1,
    PIN_DHT2,
    PIN_SOIL1,
    PIN_SOIL2,
    PIN_SOIL3,
    PIN_DS18B20_1,
    PIN_DS18B20_2,
    PIN_DS18B20_3,
    PIN_FLOAT_SENSOR,
    STATUS_LED_PIN
  );
  Serial.printf("[ESP32-B] Soil calibration: wet=%d dry=%d\n", SOIL_RAW_WET, SOIL_RAW_DRY);
}

void printSnapshotDiagnostics(const SensorSnapshot& snapshot) {
  Serial.printf(
    "[ESP32-B] Snapshot ambient=%.1fC/%.1f%% bin=%.1fC/%.1f%% soil(L1/L2/L3)=%.1f/%.1f/%.1f%% soilTemp(L1/L2/L3)=%.1f/%.1f/%.1fC float=%s rssi=%d\n",
    snapshot.ambientTempC,
    snapshot.ambientHumidity,
    snapshot.binTempC,
    snapshot.binHumidity,
    snapshot.soilLayer[0],
    snapshot.soilLayer[1],
    snapshot.soilLayer[2],
    snapshot.soilTempLayer[0],
    snapshot.soilTempLayer[1],
    snapshot.soilTempLayer[2],
    snapshot.floatStatus,
    WiFi.RSSI()
  );
  Serial.printf(
    "[ESP32-B] Snapshot aggregate temp=%.1fC humidity=%.1f%% soil=%.1f%% soilTemp=%.1fC\n",
    snapshot.tempC,
    snapshot.humidity,
    snapshot.soil,
    snapshot.waterTempC
  );
}

float clampPercent(float value) {
  if (value < 0.0f) {
    return 0.0f;
  }
  if (value > 100.0f) {
    return 100.0f;
  }
  return value;
}

float averageValid(const float* values, int count, float fallback = NAN) {
  float sum = 0.0f;
  int validCount = 0;

  for (int index = 0; index < count; index += 1) {
    const float value = values[index];
    if (!isnan(value)) {
      sum += value;
      validCount += 1;
    }
  }

  if (validCount == 0) {
    return fallback;
  }

  return sum / static_cast<float>(validCount);
}

void ensureTimeSync() {
  static bool synced = false;
  if (synced || WiFi.status() != WL_CONNECTED) {
    return;
  }

  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  synced = true;
}

void initSensors() {
  dht1.begin();
  dht2.begin();

  analogSetPinAttenuation(PIN_SOIL1, ADC_11db);
  analogSetPinAttenuation(PIN_SOIL2, ADC_11db);
  analogSetPinAttenuation(PIN_SOIL3, ADC_11db);

  dsBus1.begin();
  dsBus2.begin();
  dsBus3.begin();
  dsBus1.setResolution(10);
  dsBus2.setResolution(10);
  dsBus3.setResolution(10);
  pinMode(PIN_FLOAT_SENSOR, INPUT);
}

float readSoilLayerFiltered(int layerIndex) {
  if (layerIndex < 0 || layerIndex >= 3) {
    return NAN;
  }

  const int soilRange = SOIL_RAW_DRY - SOIL_RAW_WET;
  const int soilRaw = analogRead(SOIL_PINS[layerIndex]);
  if (soilRange == 0) {
    return NAN;
  }

  float soilPct = (static_cast<float>(SOIL_RAW_DRY - soilRaw) / static_cast<float>(soilRange)) * 100.0f;
  soilPct = clampPercent(soilPct);

  soilHistory[layerIndex][soilHistoryIndex[layerIndex]] = soilPct;
  soilHistoryIndex[layerIndex] = (soilHistoryIndex[layerIndex] + 1) % SOIL_FILTER_WINDOW;
  if (soilHistoryCount[layerIndex] < SOIL_FILTER_WINDOW) {
    soilHistoryCount[layerIndex] += 1;
  }

  float sum = 0.0f;
  for (int i = 0; i < soilHistoryCount[layerIndex]; i += 1) {
    sum += soilHistory[layerIndex][i];
  }
  if (soilHistoryCount[layerIndex] == 0) {
    return NAN;
  }

  return sum / static_cast<float>(soilHistoryCount[layerIndex]);
}

const char* classifyFloatStatusFromRaw(int rawValue) {
  if (rawValue < 0) {
    return "UNKNOWN";
  }
  if (rawValue <= FLOAT_LOW_THRESHOLD) {
    return "LOW";
  }
  if (rawValue >= FLOAT_HIGH_THRESHOLD) {
    return "HIGH";
  }
  return "SAFE";
}

int floatStatusToState(const char* status) {
  if (!status) {
    return 1;
  }
  if (strcmp(status, "LOW") == 0) {
    return 0;
  }
  if (strcmp(status, "HIGH") == 0) {
    return 2;
  }
  return 1;
}

void setJsonNumberOrNull(JsonDocument& doc, const char* key, float value) {
  if (isnan(value)) {
    doc[key] = nullptr;
    return;
  }
  doc[key] = value;
}

void setJsonIntOrNull(JsonDocument& doc, const char* key, int value, bool hasValue) {
  if (!hasValue) {
    doc[key] = nullptr;
    return;
  }
  doc[key] = value;
}

void readSoilTemperatureLayers(float outTemps[3]) {
  for (int index = 0; index < 3; index += 1) {
    outTemps[index] = NAN;
  }

  for (int index = 0; index < 3; index += 1) {
    DS_BUSES[index]->requestTemperatures();
    const float waterTemp = DS_BUSES[index]->getTempCByIndex(0);
    if (waterTemp != DEVICE_DISCONNECTED_C) {
      outTemps[index] = waterTemp;
    }
    delay(1);
  }
}

SensorSnapshot readSensors() {
  SensorSnapshot snapshot;

  snapshot.ambientTempC = dht1.readTemperature();
  snapshot.ambientHumidity = dht1.readHumidity();
  snapshot.binTempC = dht2.readTemperature();
  snapshot.binHumidity = dht2.readHumidity();

  const float dhtTemps[2] = { snapshot.ambientTempC, snapshot.binTempC };
  const float dhtHumidity[2] = { snapshot.ambientHumidity, snapshot.binHumidity };
  snapshot.tempC = averageValid(dhtTemps, 2, NAN);
  snapshot.humidity = averageValid(dhtHumidity, 2, NAN);
  delay(1);

  for (int index = 0; index < 3; index += 1) {
    snapshot.soilLayer[index] = readSoilLayerFiltered(index);
    delay(1);
  }
  snapshot.soil = averageValid(snapshot.soilLayer, 3, NAN);

  readSoilTemperatureLayers(snapshot.soilTempLayer);
  snapshot.waterTempC = averageValid(snapshot.soilTempLayer, 3, NAN);

  const int floatRaw = analogRead(PIN_FLOAT_SENSOR);
  snapshot.floatStatus = classifyFloatStatusFromRaw(floatRaw);
  snapshot.floatLevelState = floatStatusToState(snapshot.floatStatus);

  return snapshot;
}

bool mqttConnected() {
  return mqttClient.connected();
}

void mqttInit() {
  WiFi.setSleep(false);
  secureClient.setInsecure();
  secureClient.setTimeout(MQTT_SOCKET_TIMEOUT_SEC * 1000U);
  secureClient.setHandshakeTimeout(MQTT_SOCKET_TIMEOUT_SEC);
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setBufferSize(1024);
  mqttClient.setKeepAlive(30);
  mqttClient.setSocketTimeout(MQTT_SOCKET_TIMEOUT_SEC);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  if (!mqttClientIdReady) {
    const unsigned long long mac = static_cast<unsigned long long>(ESP.getEfuseMac());
    snprintf(mqttClientId, sizeof(mqttClientId), "vermilinks-esp32B-%llX", mac);
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

  Serial.printf("[ESP32-B] Attempting MQTT connection to %s:%u as %s\n", MQTT_HOST, MQTT_PORT, mqttClientId);

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
    Serial.printf(
      "[ESP32-B] MQTT connect failed state=%d (%s) wifi=%d\n",
      mqttClient.state(),
      mqttStateLabel(mqttClient.state()),
      WiFi.status()
    );
    digitalWrite(STATUS_LED_PIN, LOW);
    return;
  }

  Serial.println("[ESP32-B] MQTT connected");
  digitalWrite(STATUS_LED_PIN, HIGH);
  lastMqttConnectMs = millis();
  mqttOnlineAnnouncePending = true;
}

void mqttLoop() {
  if (!mqttConnected()) {
    digitalWrite(STATUS_LED_PIN, LOW);
    return;
  }

  digitalWrite(STATUS_LED_PIN, HIGH);
  mqttClient.loop();

  if (mqttOnlineAnnouncePending && (millis() - lastMqttConnectMs) >= MQTT_POST_CONNECT_SETTLE_MS) {
    if (!mqttClient.publish(TOPIC_LWT, "online", true)) {
      Serial.printf(
        "[ESP32-B] MQTT LWT online publish failed state=%d (%s)\n",
        mqttClient.state(),
        mqttStateLabel(mqttClient.state())
      );
      mqttClient.disconnect();
      digitalWrite(STATUS_LED_PIN, LOW);
      return;
    }
    mqttOnlineAnnouncePending = false;
    delay(1);
  }
}

void publishJson(const char* topic, JsonDocument& doc, bool retained) {
  if (!mqttConnected()) {
    return;
  }

  if ((millis() - lastMqttConnectMs) < MQTT_POST_CONNECT_SETTLE_MS) {
    return;
  }

  char buffer[768];
  const size_t written = serializeJson(doc, buffer, sizeof(buffer));
  Serial.printf("[ESP32-B] MQTT publish attempt topic=%s bytes=%u\n", topic, static_cast<unsigned int>(written));

  if (written == 0) {
    return;
  }

  const bool published = mqttClient.publish(topic, buffer, retained);
  if (!published) {
    Serial.printf(
      "[ESP32-B] MQTT publish failed topic=%s state=%d (%s) connected=%d bytes=%u\n",
      topic,
      mqttClient.state(),
      mqttStateLabel(mqttClient.state()),
      mqttClient.connected() ? 1 : 0,
      static_cast<unsigned int>(written)
    );
    mqttClient.disconnect();
    digitalWrite(STATUS_LED_PIN, LOW);
  }
  delay(1);
}

void mqttPublishTelemetry(const SensorSnapshot& snapshot) {
  if (!mqttConnected()) {
    return;
  }

  StaticJsonDocument<1024> doc;
  const long unixTs = static_cast<long>(time(nullptr));
  doc["deviceId"] = DEVICE_ID;
  doc["device_id"] = DEVICE_ID;
  setJsonNumberOrNull(doc, "temperature", snapshot.tempC);
  setJsonNumberOrNull(doc, "humidity", snapshot.humidity);
  setJsonNumberOrNull(doc, "ambient_temperature", snapshot.ambientTempC);
  setJsonNumberOrNull(doc, "ambient_humidity", snapshot.ambientHumidity);
  setJsonNumberOrNull(doc, "bin_temperature", snapshot.binTempC);
  setJsonNumberOrNull(doc, "bin_humidity", snapshot.binHumidity);
  setJsonNumberOrNull(doc, "soil_moisture", snapshot.soil);
  setJsonNumberOrNull(doc, "soil_temperature", snapshot.waterTempC);
  setJsonNumberOrNull(doc, "soil_moisture_layer1", snapshot.soilLayer[0]);
  setJsonNumberOrNull(doc, "soil_moisture_layer2", snapshot.soilLayer[1]);
  setJsonNumberOrNull(doc, "soil_moisture_layer3", snapshot.soilLayer[2]);
  setJsonNumberOrNull(doc, "soil_temperature_layer1", snapshot.soilTempLayer[0]);
  setJsonNumberOrNull(doc, "soil_temperature_layer2", snapshot.soilTempLayer[1]);
  setJsonNumberOrNull(doc, "soil_temperature_layer3", snapshot.soilTempLayer[2]);
  setJsonNumberOrNull(doc, "soilMoisture", snapshot.soil);
  setJsonNumberOrNull(doc, "soilTemp", snapshot.waterTempC);
  setJsonNumberOrNull(doc, "ambientTemperature", snapshot.ambientTempC);
  setJsonNumberOrNull(doc, "ambientHumidity", snapshot.ambientHumidity);
  setJsonNumberOrNull(doc, "binTemperature", snapshot.binTempC);
  setJsonNumberOrNull(doc, "binHumidity", snapshot.binHumidity);
  setJsonNumberOrNull(doc, "soilMoistureLayer1", snapshot.soilLayer[0]);
  setJsonNumberOrNull(doc, "soilMoistureLayer2", snapshot.soilLayer[1]);
  setJsonNumberOrNull(doc, "soilMoistureLayer3", snapshot.soilLayer[2]);
  setJsonNumberOrNull(doc, "soilTemperatureLayer1", snapshot.soilTempLayer[0]);
  setJsonNumberOrNull(doc, "soilTemperatureLayer2", snapshot.soilTempLayer[1]);
  setJsonNumberOrNull(doc, "soilTemperatureLayer3", snapshot.soilTempLayer[2]);
  setJsonIntOrNull(doc, "float_state", snapshot.floatLevelState, true);
  setJsonIntOrNull(doc, "float_sensor", snapshot.floatLevelState, true);
  doc["float_status"] = snapshot.floatStatus;
  doc["floatStatus"] = snapshot.floatStatus;
  doc["signalStrength"] = WiFi.RSSI();
  doc["timestamp"] = unixTs;
  doc["ts"] = unixTs;
  publishJson(TOPIC_TELEMETRY, doc, false);
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

bool mqttReadyForPublish() {
  return mqttConnected() && !mqttOnlineAnnouncePending && (millis() - lastMqttConnectMs) >= MQTT_POST_CONNECT_SETTLE_MS;
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (wifiReconnectLogged) {
      Serial.printf("[ESP32-B] WiFi reconnected, IP=%s RSSI=%d\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
      wifiReconnectLogged = false;
    }
    return;
  }

  const unsigned long now = millis();
  if (!wifiReconnectLogged) {
    Serial.println("[ESP32-B] WiFi disconnected. Reconnecting...");
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
  initSensors();
  mqttInit();
  printBootDiagnostics();
  ensureWifi();
  ensureTimeSync();
}

void loop() {
  ensureWifi();
  ensureTimeSync();
  mqttEnsureConnected();
  mqttLoop();

  const unsigned long now = millis();
  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    const SensorSnapshot snapshot = readSensors();
    printSnapshotDiagnostics(snapshot);
    if (mqttReadyForPublish()) {
      mqttPublishTelemetry(snapshot);
    }
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    if (mqttReadyForPublish()) {
      mqttPublishStatus(WiFi.status() == WL_CONNECTED);
    }
  }

  delay(10);
}
