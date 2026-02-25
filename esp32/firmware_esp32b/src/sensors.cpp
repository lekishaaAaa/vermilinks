#include "sensors.h"
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "config.h"

static DHT dht1(PIN_DHT1, DHT22);
static DHT dht2(PIN_DHT2, DHT22);
static OneWire oneWire(PIN_DS18B20_BUS);
static DallasTemperature waterSensor(&oneWire);

static const int SOIL_PINS[4] = { PIN_SOIL1, PIN_SOIL2, PIN_SOIL3, PIN_SOIL4 };

static float clampPercent(float value) {
  if (value < 0.0f) return 0.0f;
  if (value > 100.0f) return 100.0f;
  return value;
}

static bool isValidDht(float value) {
  return !isnan(value);
}

static float averageValid(const float* values, int count, float fallback = 0.0f) {
  float sum = 0.0f;
  int validCount = 0;
  for (int i = 0; i < count; i += 1) {
    const float value = values[i];
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

void initSensors() {
  dht1.begin();
  dht2.begin();

  analogSetPinAttenuation(PIN_SOIL1, ADC_11db);
  analogSetPinAttenuation(PIN_SOIL2, ADC_11db);
  analogSetPinAttenuation(PIN_SOIL3, ADC_11db);
  analogSetPinAttenuation(PIN_SOIL4, ADC_11db);

  waterSensor.begin();
}

SensorSnapshot readSensors() {
  SensorSnapshot snap;

  const float dhtTemps[2] = {
    dht1.readTemperature(),
    dht2.readTemperature(),
  };
  const float dhtHumidity[2] = {
    dht1.readHumidity(),
    dht2.readHumidity(),
  };

  const float filteredTemps[2] = {
    isValidDht(dhtTemps[0]) ? dhtTemps[0] : NAN,
    isValidDht(dhtTemps[1]) ? dhtTemps[1] : NAN,
  };
  const float filteredHumidity[2] = {
    isValidDht(dhtHumidity[0]) ? dhtHumidity[0] : NAN,
    isValidDht(dhtHumidity[1]) ? dhtHumidity[1] : NAN,
  };

  snap.tempC = averageValid(filteredTemps, 2, 0.0f);
  snap.humidity = averageValid(filteredHumidity, 2, 0.0f);

  const int soilRange = SOIL_RAW_DRY - SOIL_RAW_WET;
  float soilPctValues[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
  for (int i = 0; i < 4; i += 1) {
    const int soilRaw = analogRead(SOIL_PINS[i]);
    float soilPct = 0.0f;
    if (soilRange != 0) {
      soilPct = (static_cast<float>(SOIL_RAW_DRY - soilRaw) / static_cast<float>(soilRange)) * 100.0f;
    }
    soilPctValues[i] = clampPercent(soilPct);
  }
  snap.soil = averageValid(soilPctValues, 4, 0.0f);

  waterSensor.requestTemperatures();
  float dsTemps[4] = { NAN, NAN, NAN, NAN };
  for (int i = 0; i < 4; i += 1) {
    const float waterTemp = waterSensor.getTempCByIndex(i);
    if (waterTemp != DEVICE_DISCONNECTED_C) {
      dsTemps[i] = waterTemp;
    }
  }
  snap.waterTempC = averageValid(dsTemps, 4, 0.0f);

  return snap;
}
