#include "actuator.h"
#include "config.h"

void initActuators() {
  pinMode(PUMP_PIN, OUTPUT);
  pinMode(VALVE1_PIN, OUTPUT);
  pinMode(VALVE2_PIN, OUTPUT);
  pinMode(VALVE3_PIN, OUTPUT);

  // Fail-safe: pump off on boot
  digitalWrite(PUMP_PIN, LOW);
  digitalWrite(VALVE1_PIN, LOW);
  digitalWrite(VALVE2_PIN, LOW);
  digitalWrite(VALVE3_PIN, LOW);
}

void applyActuatorState(const ActuatorState& state) {
  digitalWrite(PUMP_PIN, state.pump ? HIGH : LOW);
  digitalWrite(VALVE1_PIN, state.valve1 ? HIGH : LOW);
  digitalWrite(VALVE2_PIN, state.valve2 ? HIGH : LOW);
  digitalWrite(VALVE3_PIN, state.valve3 ? HIGH : LOW);
}
