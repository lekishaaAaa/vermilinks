#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include "sensors.h"

void mqttInit();
void mqttEnsureConnected();
void mqttLoop();
bool mqttConnected();
void mqttPublishTelemetry(const SensorSnapshot& snapshot);
void mqttPublishStatus(bool online);
