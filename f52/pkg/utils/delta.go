package utils

import (
	"reflect"
)

type Delta struct {
	DeviceID string                 `json:"device_id"`
	Delta    map[string]interface{} `json:"delta"`
	Version  int64                  `json:"version"`
}

func CalculateDelta(desired, reported map[string]interface{}) map[string]interface{} {
	delta := make(map[string]interface{})

	for k, v := range desired {
		if reportedVal, ok := reported[k]; ok {
			if !reflect.DeepEqual(v, reportedVal) {
				delta[k] = v
			}
		} else {
			delta[k] = v
		}
	}

	return delta
}

func IsEmptyDelta(delta map[string]interface{}) bool {
	return len(delta) == 0
}
