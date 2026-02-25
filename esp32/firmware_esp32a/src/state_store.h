#pragma once
#include <Arduino.h>

struct ActuatorState {
  bool pump;
  bool valve1;
  bool valve2;
  bool valve3;
  String floatState;
  String requestId;
  String source;
};

ActuatorState getDefaultState();
