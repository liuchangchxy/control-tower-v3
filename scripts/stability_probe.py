#!/usr/bin/env python3
"""One-shot stability probe for the local vLLM 27B server (run on debian103).

Read-only against the deployment: does not touch profiles, config, or processes.
Performs exactly one test: warmup -> one long streaming generation ->
post-flight health checks (1-token request, /health, vllm PIDs, nvidia-smi).
Exit code 0 = stable, 1 = failure/crash detected. All output is JSON + a
human summary on stdout, so the log is self-contained for diagnosis.
"""
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8000"
LONG_TIMEOUT = 600  # seconds, whole long-generation window


def http_get(path, timeout=15):
    req = urllib.request.Request(BASE + path)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def get_model_name():
    _, body = http_get("/v1/models")
    data = json.loads(body)["data"]
    return data[0]["id"]


def vllm_pids():
    try:
        out = subprocess.run(
            ["pgrep", "-f", "vllm.entrypoints"], capture_output=True, text=True, timeout=10
        ).stdout.split()
        return [int(p) for p in out if p.strip().isdigit()]
    except Exception:
        return None


def nvidia_smi_snapshot():
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,name,temperature.gpu,utilization.gpu,memory.used,utilization.memory,ecc.errors.corrupted.aggregate.count",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if out.returncode != 0:
            return {"error": out.stderr.strip()[:200]}
        return [line.split(",") for line in out.stdout.strip().splitlines() if line.strip()]
    except Exception as e:
        return {"error": str(e)[:200]}


def chat_nonstream(model, messages, max_tokens):
    payload = json.dumps(
        {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0,
            "chat_template_kwargs": {"enable_thinking": False},
        }
    ).encode()
    req = urllib.request.Request(
        BASE + "/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read().decode()
    dt = (time.monotonic() - t0) * 1000
    return json.loads(body), dt


def warmup(model):
    try:
        body, dt = chat_nonstream(
            model, [{"role": "user", "content": "你好，请用一句话回答：什么是推理引擎？"}], 32
        )
        return {"ok": True, "latencyMs": round(dt, 1), "answer": body["choices"][0]["message"]["content"][:80]}
    except Exception as e:
        return {"ok": False, "error": str(e)[: 300]}


PARAGRAPH = (
    "大语言模型的推理服务化部署涉及多个层面的工程优化：分词器设计的差异直接影响上下文长度与"
    "内存占用的平衡；KV cache 的量化方案从半精度到 int8 再到更激进的张量量化，每一步都在"
    "显存压力与输出质量之间做取舍；投机解码通过小模型或自回归头预测后续 token，再以并行验证"
    "的方式确认，能把解码吞吐量提升一到数倍，前提是接受率足够高；CUDA graph 将重复的解码"
    "调用序列捕获为图状态，消除内核启动开销，但在批大小变化时需要多份捕获状态；多卡张量"
    "并行下 NVLink 带宽决定了 all-reduce 的成本，消费级显卡 ise 带宽受限时需要 pipeline "
    "并行或混合策略补偿。迁移学习、量化感知训练、以及针对 moe 架构的专家调度，则构成了此类"
    "系统持续演进的长期主线。以上每一条都对应真实的工程取舍，而非单纯的理论概念，值得在部署"
    "前逐项评估。"
)
# ~210 chars/rep; 18 reps ~3.8K chars, roughly 4-5K tokens after tokenization.
LONG_PROMPT = (
    "以下是关于分布式推理系统优化的一份内部技术笔记，共18段：\n\n"
    + "\n\n".join([PARAGRAPH] * 18)
    + "\n\n请基于以上笔记，撰写一篇不少于1500字的综述性文章，要求：1. 覆盖笔记中提到的全部"
    "技术主题并按逻辑重新组织；2. 补充你认为缺失的重要因素；3. 用小标题分节；4. 最后给出"
    "三条可落地的部署建议。现在开始写作，不要复述笔记原文。"
)


def long_generation(model):
    payload = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": LONG_PROMPT}],
            "max_tokens": 2048,
            "temperature": 0,
            "stream": True,
            "stream_options": {"include_usage": True},
            "chat_template_kwargs": {"enable_thinking": False},
        }
    ).encode()
    req = urllib.request.Request(
        BASE + "/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    result = {
        "promptChars": len(LONG_PROMPT),
        "ttftMs": None,
        "tokens": 0,
        "itlMs": [],
        "maxItlMs": 0,
        "stallsOver5s": 0,
        "repetitionRatio": None,
        "textTail": None,
        "usage": None,
        "error": None,
    }
    text_parts = []
    try:
        t0 = time.monotonic()
        last = t0
        with urllib.request.urlopen(req, timeout=LONG_TIMEOUT) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                chunk = json.loads(data)
                if chunk.get("usage"):
                    result["usage"] = chunk["usage"]
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content")
                reasoning = delta.get("reasoning_content")
                if content:
                    now = time.monotonic()
                    gap_ms = (now - last) * 1000
                    if result["ttftMs"] is None:
                        result["ttftMs"] = (now - t0) * 1000
                    else:
                        result["itlMs"].append(gap_ms)
                        if gap_ms > result["maxItlMs"]:
                            result["maxItlMs"] = gap_ms
                        if gap_ms > 5000:
                            result["stallsOver5s"] += 1
                    last = now
                    result["tokens"] += 1
                    text_parts.append(content)
                elif reasoning:
                    last = time.monotonic()  # thinking tokens also keep the stream alive
        now = time.monotonic()
        full_text = "".join(text_parts)
        result["e2eMs"] = round((now - t0) * 1000)
        result["stablePerSec"] = round(
            result["tokens"] / max(1e-6, (now - t0) - (result["ttftMs"] or 0) / 1000), 2
        )
        result["textTail"] = full_text[-200:]
        grams_4 = [full_text[i : i + 4] for i in range(max(0, len(full_text) - 3))]
        if len(grams_4) > 32:
            result["repetitionRatio"] = round(1 - len(set(grams_4)) / len(grams_4), 3)
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {str(e)[: 300]}"
    # Keep the tail of whatever was generated for degenerate-output inspection.
    if not result["textTail"]:
        # re-read is impossible on a closed stream; capture from a fresh minimal request instead
        pass
    return result


def post_flight(model, pre_pids):
    checks = {}
    try:
        body, dt = chat_nonstream(
            model, [{"role": "user", "content": "回答OK"}], 1
        )
        checks["oneTokenRequest"] = {"ok": True, "latencyMs": round(dt, 1)}
    except Exception as e:
        checks["oneTokenRequest"] = {"ok": False, "error": str(e)[: 300]}

    try:
        status, _ = http_get("/health")
        checks["healthEndpoint"] = {"ok": status == 200, "status": status}
    except Exception as e:
        checks["healthEndpoint"] = {"ok": False, "error": str(e)[: 300]}

    post_pids = vllm_pids()
    checks["vllmPids"] = {
        "before": pre_pids,
        "after": post_pids,
        "unchanged": pre_pids == post_pids,
        "alive": bool(post_pids),
    }
    return checks


def main():
    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model": None,
        "gpuBefore": nvidia_smi_snapshot(),
        "phase1_warmup": None,
        "phase2_longGen": None,
        "gpuAfter": None,
        "phase3_postFlight": None,
        "verdict": "FAILED",
    }

    try:
        report["model"] = get_model_name()
    except Exception as e:
        report["verdict"] = "FAILED: cannot reach /v1/models"
        report["error"] = str(e)[: 300]
        print(json.dumps(report, ensure_ascii=False, indent=2))
        print(f"\n[stability-probe] FAILED: {report['error']}")
        return 1

    pre_pids = vllm_pids()
    print(f"\n[stability-probe] model={report['model']}  vllm_pids={pre_pids}", flush=True)

    report["phase1_warmup"] = warmup(report["model"])
    print(json.dumps(report["phase1_warmup"], ensure_ascii=False), flush=True)

    report["phase2_longGen"] = long_generation(report["model"])
    lg = report["phase2_longGen"]
    print(
        f"\n[stability-probe] longGen done: tokens={lg['tokens']} "
        f"ttft_ms={lg['ttftMs']} e2e_ms={lg.get('e2eMs')} "
        f"stable_tps={lg.get('stablePerSec')} max_itl_ms={lg['maxItlMs']:.0f} "
        f"stalls5s={lg['stallsOver5s']} repeat={lg.get('repetitionRatio')} "
        f"prompt_tokens={(lg.get('usage') or {}).get('prompt_tokens')} error={lg['error']}",
        flush=True,
    )

    report["gpuAfter"] = nvidia_smi_snapshot()
    report["phase3_postFlight"] = post_flight(report["model"], pre_pids)
    print(
        "\n[stability-probe] postFlight:",
        json.dumps(report["phase3_postFlight"], ensure_ascii=False),
        flush=True,
    )

    pf = report["phase3_postFlight"]
    if (
        lg["error"] is None
        and pf["vllmPids"].get("alive")
        and pf.get("oneTokenRequest", {}).get("ok")
    ):
        report["verdict"] = "STABLE"
    else:
        report["verdict"] = "FAILED"

    print("\n" + "=" * 70)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print("=" * 70)
    print(f"\n[stability-probe] VERDICT: {report['verdict']}")
    return 0 if report["verdict"] == "STABLE" else 1


if __name__ == "__main__":
    sys.exit(main())
