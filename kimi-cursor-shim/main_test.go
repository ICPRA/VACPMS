package main

import (
	"encoding/json"
	"testing"
)

func TestNativeSessionRequestsAreNotAcknowledgedLocally(t *testing.T) {
	for _, method := range []string{"session/set_model", "session/set_config_option", "session/new", "session/load", "session/resume", "session/cancel"} {
		response, intercepted := localResponse(json.RawMessage(`17`), method)
		if intercepted || response != nil {
			t.Fatalf("%s must reach Kimi unchanged, got local response %v", method, response)
		}
	}
}

func TestCursorModelDiscoveryStillRespondsLocally(t *testing.T) {
	response, intercepted := localResponse(json.RawMessage(`"discovery"`), "cursor/list_available_models")
	if !intercepted || response["result"] == nil {
		t.Fatalf("missing Cursor-private discovery response: %v", response)
	}
	if string(response["id"].(json.RawMessage)) != `"discovery"` {
		t.Fatalf("request identity changed: %v", response)
	}
}
