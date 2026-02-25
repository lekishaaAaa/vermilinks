#pragma once
#include <Arduino.h>

// Requires libraries: DHT sensor library, OneWire, DallasTemperature
// Snapshot fields are aggregate values:
// - tempC/humidity = average of 2x DHT22
// - soil = average of 4x capacitive moisture probes
// - waterTempC = average of up to 4x DS18B20 sensors on shared one-wire bus

struct SensorSnapshot {
  float tempC;
  float humidity;
  float soil;
  float waterTempC;
};

void initSensors();
SensorSnapshot readSensors();
