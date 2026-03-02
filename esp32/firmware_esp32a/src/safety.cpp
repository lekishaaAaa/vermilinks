#include "safety.h"
#include "config.h"

void initFloatSensor() {
  pinMode(FLOAT_PIN, INPUT_PULLUP);
}

int readFloatRaw() {
  return digitalRead(FLOAT_PIN);
}

bool floatIsLow() {
  return readFloatRaw() == FLOAT_LOW;
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
