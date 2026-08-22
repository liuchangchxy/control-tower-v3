import sys

filepath = "/home/chang/control-tower/launcher_wrapper.sh"
with open(filepath, "r") as f:
    content = f.read()

lines = content.split("\n")
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if line.strip() == "cmd_status() {":
        start_idx = i
    if start_idx is not None and i > start_idx and line.strip() == "}":
        end_idx = i
        break

if start_idx is None or end_idx is None:
    print("ERROR: could not find cmd_status function")
    sys.exit(1)

print(f"Found cmd_status at lines {start_idx+1}-{end_idx+1}")

new_func = r'''cmd_status() {
    local pid pid_file log_file
    if pid=$(find_vllm_pid); then
        pid_file=$(find_pid_file 2>/dev/null || true)
        log_file=$(find_log_file "${pid_file:-}")

        local uptime_sec=0
        if [[ -f "/proc/$pid/stat" ]]; then
            local start_ticks hz boot_time now start_sec
            start_ticks=$(awk '{print $22}' /proc/$pid/stat 2>/dev/null || echo 0)
            hz=$(getconf CLK_TCK 2>/dev/null || echo 100)
            boot_time=$(awk '/^btime/ {print $2}' /proc/stat 2>/dev/null || echo 0)
            now=$(date +%s)
            start_sec=$(( boot_time + start_ticks / hz ))
            uptime_sec=$(( now - start_sec ))
            (( uptime_sec < 0 )) && uptime_sec=0
        fi

        local profile served_name
        profile=$(read_state_value PROFILE || true)
        served_name=$(read_state_value SERVED_NAME || true)

        local port
        if [[ -r "/proc/$pid/cmdline" ]]; then
            port=$(tr '\0' '\n' < "/proc/$pid/cmdline" | grep -A1 '^--port$' | tail -1 || true)
        fi
        port="${port:-$PORT}"

        local health="loading"
        local http_code
        http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://localhost:${port:-8000}/health" 2>/dev/null || echo '000')
        if [[ "$http_code" == '200' ]]; then
            health="ready"
        elif (( uptime_sec > 30 )); then
            if [[ -n "$log_file" ]] && grep -q 'OutOfMemoryError\|EngineDeadError\|CUDA.*error\|EngineCore failed' "$log_file" 2>/dev/null; then
                health="error"
            else
                health="loading"
            fi
        else
            health="starting"
        fi

        printf '{"running":true,"health":"%s","pid":%s,"uptime_sec":%s,"profile":"%s","served_name":"%s","port":%s,"log_file":"%s","pid_file":"%s"}\n' \
            "$health" "$pid" "$uptime_sec" "${profile:-unknown}" "${served_name:-unknown}" "$port" "${log_file:-}" "${pid_file:-}"
    else
        printf '{"running":false,"health":"stopped","pid":null,"uptime_sec":0,"profile":null,"served_name":null,"port":%s,"log_file":null}\n' "$PORT"
    fi
}'''

new_lines = lines[:start_idx] + new_func.split("\n") + lines[end_idx+1:]
with open(filepath, "w") as f:
    f.write("\n".join(new_lines))

print("Fixed cmd_status function")
