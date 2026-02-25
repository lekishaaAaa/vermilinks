#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include "state_store.h"

void mqttInit();
void mqttBindState(ActuatorState* state);
void mqttEnsureConnected();
void mqttLoop();
void mqttPublishState(const ActuatorState& state, bool retained);
void mqttPublishStatus(bool online);
bool mqttConnected();
void mqttHandleCommand(const char* payload);
