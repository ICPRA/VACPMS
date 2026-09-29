// cursor-agent shim: makes Kimi Code CLI (kimi acp) present as Cursor Agent CLI to T3 Code.
//
// Subcommands:
//
//	about [--format json]  -> report a synthetic Cursor CLI identity (passes T3 health gate)
//	[-e <url>] acp         -> ACP stdio proxy to `kimi acp`, intercepting Cursor-private
//	                          extension methods T3 requires and answering them locally.
//
// All other args are accepted and ignored (e.g. -e <api endpoint>).
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
)

const shimVersion = "2026.09.19-kimiacp"

var logFile *os.File

func logf(format string, args ...any) {
	if logFile == nil {
		return
	}
	fmt.Fprintf(logFile, format+"\n", args...)
	logFile.Sync()
}

func openLog() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(home, ".kimi-code", "shim.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		logFile = f
	}
}

// kimiModels mirrors the model list from ~/.kimi-code/config.toml. Ids are what
// T3 will hand back via session/set_model; Kimi validates and applies the
// selection, and its actual response is forwarded to T3.
var kimiModels = []map[string]any{
	{"value": "kimi-code/kimi-for-coding", "name": "K2.9 Preview", "configOptions": []any{}, "capabilities": map[string]any{"optionDescriptors": []any{}}},
	{"value": "kimi-code/kimi-for-coding-highspeed", "name": "K2.7 Code Highspeed", "configOptions": []any{}, "capabilities": map[string]any{"optionDescriptors": []any{}}},
	{"value": "kimi-code/k3", "name": "K3", "configOptions": []any{}, "capabilities": map[string]any{"optionDescriptors": []any{}}},
	{"value": "kimi-code/k3-256k", "name": "K3-256k", "configOptions": []any{}, "capabilities": map[string]any{"optionDescriptors": []any{}}},
}

func printAbout() {
	out, _ := json.Marshal(map[string]any{
		"cliVersion":       shimVersion,
		"userEmail":        "kimi-code@localhost",
		"subscriptionTier": "pro",
	})
	fmt.Println(string(out))
}

type rpcMsg struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
}

// localResponse returns (response, true) for methods the shim answers itself.
func localResponse(id json.RawMessage, method string) (map[string]any, bool) {
	switch method {
	case "cursor/list_available_models":
		return map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{"models": kimiModels}}, true
	case "authenticate":
		// T3's ACP client insists on an auth handshake because kimi advertises a
		// terminal-auth method; kimi would block running an interactive login flow.
		// The user is already logged in on this machine, so ack it locally.
		return map[string]any{"jsonrpc": "2.0", "id": id, "result": map[string]any{}}, true
	}
	return nil, false
}

func findKimi() string {
	if p, err := exec.LookPath("kimi.exe"); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".kimi-code", "bin", "kimi.exe")
}

func runAcpProxy() int {
	openLog()
	if logFile != nil {
		defer logFile.Close()
	}
	kimiPath := findKimi()
	logf("proxy start, kimi=%s", kimiPath)

	cmd := exec.Command(kimiPath, "acp")
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		fmt.Fprintln(os.Stderr, "shim: stdin pipe:", err)
		return 1
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		fmt.Fprintln(os.Stderr, "shim: stdout pipe:", err)
		return 1
	}
	if err := cmd.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "shim: start kimi acp:", err)
		return 1
	}

	var wg sync.WaitGroup

	// client -> kimi, intercepting cursor-private extension requests
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer stdin.Close()
		reader := bufio.NewReader(os.Stdin)
		for {
			line, err := reader.ReadBytes('\n')
			if len(line) > 0 {
				trimmed := bytes.TrimRight(line, "\r\n")
				var msg rpcMsg
				if json.Unmarshal(trimmed, &msg) == nil && msg.Method != "" {
					if resp, ok := localResponse(msg.ID, msg.Method); ok {
						encoded, _ := json.Marshal(resp)
						logf("intercepted %s -> local response", msg.Method)
						os.Stdout.Write(append(encoded, '\n'))
						continue
					}
					logf("forward request %s", msg.Method)
				} else {
					logf("forward line (len=%d)", len(trimmed))
				}
				stdin.Write(line)
			}
			if err != nil {
				return
			}
		}
	}()

	// kimi -> client, pass through verbatim
	wg.Add(1)
	go func() {
		defer wg.Done()
		reader := bufio.NewReader(stdout)
		for {
			line, err := reader.ReadBytes('\n')
			if len(line) > 0 {
				trimmed := bytes.TrimRight(line, "\r\n")
				var msg rpcMsg
				if json.Unmarshal(trimmed, &msg) == nil && msg.Method != "" {
					logf("forward agent->client request %s", msg.Method)
				}
				os.Stdout.Write(line)
			}
			if err != nil {
				return
			}
		}
	}()

	wg.Wait()
	err = cmd.Wait()
	logf("proxy end, err=%v", err)
	if exitErr, ok := err.(*exec.ExitError); ok {
		return exitErr.ExitCode()
	}
	if err != nil {
		return 1
	}
	return 0
}

func main() {
	hasAbout, hasAcp := false, false
	for _, arg := range os.Args[1:] {
		switch arg {
		case "about":
			hasAbout = true
		case "acp":
			hasAcp = true
		}
	}
	switch {
	case hasAbout:
		printAbout()
	case hasAcp:
		os.Exit(runAcpProxy())
	default:
		// Unknown invocation (e.g. bare call); behave like a minimal CLI.
		fmt.Println("Cursor Agent CLI (shim for Kimi Code)")
		fmt.Println("CLI Version        " + shimVersion)
		fmt.Println("User Email         kimi-code@localhost")
	}
}
