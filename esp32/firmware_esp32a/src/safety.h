#pragma once
#include <Arduino.h>
#include "state_store.h"

void initFloatSensor();
int readFloatRaw();
bool floatIsLow();
void enforceFloatSafety(ActuatorState& state);
