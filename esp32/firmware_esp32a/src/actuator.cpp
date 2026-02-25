#include "actuator.h"
#include "config.h"

void initActuators() {
  pinMode(PIN_PUMP, OUTPUT);
  pinMode(PIN_VALVE1, OUTPUT);
  pinMode(PIN_VALVE2, OUTPUT);
  pinMode(PIN_VALVE3, OUTPUT);

  // Fail-safe: pump off on boot
  digitalWrite(PIN_PUMP, LOW);
  digitalWrite(PIN_VALVE1, LOW);
  digitalWrite(PIN_VALVE2, LOW);
  digitalWrite(PIN_VALVE3, LOW);
}

void applyActuatorState(const ActuatorState& state) {
  digitalWrite(PIN_PUMP, state.pump ? HIGH : LOW);
  digitalWrite(PIN_VALVE1, state.valve1 ? HIGH : LOW);
  digitalWrite(PIN_VALVE2, state.valve2 ? HIGH : LOW);
  digitalWrite(PIN_VALVE3, state.valve3 ? HIGH : LOW);
}
