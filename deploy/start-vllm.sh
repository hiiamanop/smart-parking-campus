#!/usr/bin/env bash
# Serve the local plate-reading VLM with vLLM (OpenAI-compatible API).
#
# Defaults assume the runtime lives next to the repo:
#   ~/workspace/vllm-env
#   ~/workspace/models/qwen3-vl-8b-awq
#   ~/workspace/hf-cache
#
# Override with VLLM_ENV / MODEL_DIR / SERVED_NAME / PORT / GPU_MEM_UTIL /
# MAX_MODEL_LEN / MAX_NUM_SEQS, or pass extra `vllm serve` args.
set -euo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-$HOME/workspace}"
VLLM_ENV="${VLLM_ENV:-$WORKSPACE_ROOT/vllm-env}"
MODEL_DIR="${MODEL_DIR:-$WORKSPACE_ROOT/models/qwen3-vl-8b-awq}"
SERVED_NAME="${SERVED_NAME:-qwen3-vl-8b-awq}"
PORT="${PORT:-8001}"

if [[ ! -x "$VLLM_ENV/bin/vllm" ]]; then
  echo "vLLM belum terpasang di $VLLM_ENV" >&2
  exit 1
fi
if [[ ! -f "$MODEL_DIR/config.json" ]]; then
  echo "Model belum ada di $MODEL_DIR" >&2
  exit 1
fi

export HF_HOME="${HF_HOME:-$WORKSPACE_ROOT/hf-cache}"
export VLLM_USE_V1=1
# Host ini tidak punya CUDA toolkit/nvcc; matikan JIT flashinfer.
export VLLM_USE_FLASHINFER_SAMPLER="${VLLM_USE_FLASHINFER_SAMPLER:-0}"

exec "$VLLM_ENV/bin/vllm" serve "$MODEL_DIR" \
  --served-model-name "$SERVED_NAME" \
  --host 0.0.0.0 \
  --port "$PORT" \
  --gpu-memory-utilization "${GPU_MEM_UTIL:-0.90}" \
  --max-model-len "${MAX_MODEL_LEN:-6144}" \
  --max-num-seqs "${MAX_NUM_SEQS:-8}" \
  --limit-mm-per-prompt '{"image":4}' \
  --disable-log-requests \
  "$@"
