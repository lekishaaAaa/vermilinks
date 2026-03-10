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
    state.floatState = "LOW";
    if (!state.forcePumpOverride) {
      state.pump = false;
      state.source = "safety_override";
    } else if (state.source != "forced_manual_override") {
      state.source = "forced_manual_override";
    }
  } else {
    state.floatState = "NORMAL";
    state.forcePumpOverride = false;
  }
}
