#include "state_store.h"

ActuatorState getDefaultState() {
  ActuatorState state;
  state.pump = false;
  state.valve1 = false;
  state.valve2 = false;
  state.valve3 = false;
  state.floatState = "UNKNOWN";
  state.requestId = "";
  state.source = "boot";
  return state;
}
