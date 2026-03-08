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

static const char* TOPIC_TELEMETRY = "vermilinks/esp32b/metrics";
static const char* TOPIC_STATUS = "vermilinks/esp32b/status";
static const char* TOPIC_LWT = "vermilinks/device_status/esp32b";

static const int PIN_DHT1 = 4;
static const int PIN_DHT2 = 16;
static const int PIN_SOIL1 = 34;
static const int PIN_SOIL2 = 35;
static const int PIN_SOIL3 = 32;
static const int PIN_SOIL4 = 33;
static const int PIN_DS18B20_BUS = 17;
static const int STATUS_LED_PIN = 13;

static const int SOIL_RAW_DRY = 3000;
static const int SOIL_RAW_WET = 1200;
static const unsigned long TELEMETRY_INTERVAL_MS = 5000UL;
static const unsigned long STATUS_INTERVAL_MS = 30000UL;
static const unsigned long WIFI_RETRY_INTERVAL_MS = 5000UL;
static const unsigned long MQTT_RETRY_INTERVAL_MS = 3000UL;

struct SensorSnapshot {
  float tempC;
  float humidity;
  float soil;
  float waterTempC;
};

WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);
DHT dht1(PIN_DHT1, DHT22);
DHT dht2(PIN_DHT2, DHT22);
OneWire oneWire(PIN_DS18B20_BUS);
DallasTemperature dsBus(&oneWire);

const int SOIL_PINS[4] = { PIN_SOIL1, PIN_SOIL2, PIN_SOIL3, PIN_SOIL4 };

unsigned long lastTelemetryMs = 0;
unsigned long lastStatusMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastMqttAttemptMs = 0;
char mqttClientId[48];
bool mqttClientIdReady = false;

void printBootDiagnostics() {
  Serial.println("[ESP32-B] VermiLinks sensor node boot");
  Serial.printf("[ESP32-B] Device ID: %s\n", DEVICE_ID);
  Serial.printf("[ESP32-B] MQTT broker: %s:%u\n", MQTT_HOST, MQTT_PORT);
  Serial.printf("[ESP32-B] Topics: telemetry=%s status=%s\n", TOPIC_TELEMETRY, TOPIC_STATUS);
  Serial.printf("[ESP32-B] Pins: dht1=%d dht2=%d soil1=%d soil2=%d soil3=%d soil4=%d ds18b20=%d led=%d\n", PIN_DHT1, PIN_DHT2, PIN_SOIL1, PIN_SOIL2, PIN_SOIL3, PIN_SOIL4, PIN_DS18B20_BUS, STATUS_LED_PIN);
  Serial.printf("[ESP32-B] Soil calibration: wet=%d dry=%d\n", SOIL_RAW_WET, SOIL_RAW_DRY);
}

void printSnapshotDiagnostics(const SensorSnapshot& snapshot) {
  Serial.printf("[ESP32-B] Snapshot temp=%.1fC humidity=%.1f%% soil=%.1f%% soilTemp=%.1fC rssi=%d\n",
    snapshot.tempC,
    snapshot.humidity,
    snapshot.soil,
    snapshot.waterTempC,
    WiFi.RSSI());
}

float clampPercent(float value) {
  if (value < 0.0f) return 0.0f;
  if (value > 100.0f) return 100.0f;
  return value;
}

float averageValid(const float* values, int count, float fallback = 0.0f) {
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
  analogSetPinAttenuation(PIN_SOIL4, ADC_11db);

  dsBus.begin();
}

SensorSnapshot readSensors() {
  SensorSnapshot snapshot;

  const float dhtTemps[2] = { dht1.readTemperature(), dht2.readTemperature() };
  const float dhtHumidity[2] = { dht1.readHumidity(), dht2.readHumidity() };
  snapshot.tempC = averageValid(dhtTemps, 2, 0.0f);
  snapshot.humidity = averageValid(dhtHumidity, 2, 0.0f);

  const int soilRange = SOIL_RAW_DRY - SOIL_RAW_WET;
  float soilPctValues[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
  for (int index = 0; index < 4; index += 1) {
    const int soilRaw = analogRead(SOIL_PINS[index]);
    float soilPct = 0.0f;
    if (soilRange != 0) {
      soilPct = (static_cast<float>(SOIL_RAW_DRY - soilRaw) / static_cast<float>(soilRange)) * 100.0f;
    }
    soilPctValues[index] = clampPercent(soilPct);
  }
  snapshot.soil = averageValid(soilPctValues, 4, 0.0f);

  dsBus.requestTemperatures();
  float dsTemps[4] = { NAN, NAN, NAN, NAN };
  for (int index = 0; index < 4; index += 1) {
    const float waterTemp = dsBus.getTempCByIndex(index);
    if (waterTemp != DEVICE_DISCONNECTED_C) {
      dsTemps[index] = waterTemp;
    }
  }
  snapshot.waterTempC = averageValid(dsTemps, 4, 0.0f);

  return snapshot;
}

bool mqttConnected() {
  return mqttClient.connected();
}

void mqttInit() {
  secureClient.setInsecure();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW);

  if (!mqttClientIdReady) {
    const unsigned long long mac = static_cast<unsigned long long>(ESP.getEfuseMac());
    snprintf(mqttClientId, sizeof(mqttClientId), "vermilinks-esp32b-%llX", mac);
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
}

void mqttLoop() {
  if (!mqttConnected()) {
    digitalWrite(STATUS_LED_PIN, LOW);
    return;
  }
  digitalWrite(STATUS_LED_PIN, HIGH);
  mqttClient.loop();
}

void publishJson(const char* topic, JsonDocument& doc, bool retained) {
  char buffer[512];
  const size_t written = serializeJson(doc, buffer, sizeof(buffer));
  if (written > 0) {
    mqttClient.publish(topic, buffer, retained);
  }
}

void mqttPublishTelemetry(const SensorSnapshot& snapshot) {
  if (!mqttConnected()) {
    return;
  }

  StaticJsonDocument<320> doc;
  const long unixTs = static_cast<long>(time(nullptr));
  doc["deviceId"] = DEVICE_ID;
  doc["device_id"] = DEVICE_ID;
  doc["temperature"] = snapshot.tempC;
  doc["humidity"] = snapshot.humidity;
  doc["soil_moisture"] = snapshot.soil;
  doc["soil_temperature"] = snapshot.waterTempC;
  doc["soilMoisture"] = snapshot.soil;
  doc["soilTemp"] = snapshot.waterTempC;
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

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  const unsigned long now = millis();
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
    mqttPublishTelemetry(snapshot);
  }

  if (now - lastStatusMs >= STATUS_INTERVAL_MS) {
    lastStatusMs = now;
    mqttPublishStatus(WiFi.status() == WL_CONNECTED);
  }
}
