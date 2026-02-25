#pragma once
#include <Arduino.h>
#include "state_store.h"

void initActuators();
void applyActuatorState(const ActuatorState& state);
