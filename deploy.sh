#!/usr/bin/env bash
#
# poker-h5 一键部署脚本
# 用法: ./deploy.sh [commit-sha]
#   不带参数: 部署当前 HEAD
#   带参数:   部署指定 commit
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

CONTAINER_NAME="poker-h5"
NETWORK="atomorbe-net"
VOLUME="poker_h5_data"
PORT=8787

# ── 确定版本 ──────────────────────────────────────────────
if [[ -n "${1:-}" ]]; then
  COMMIT="$1"
  git checkout "$COMMIT" --quiet
else
  COMMIT="$(git rev-parse --short HEAD)"
fi

IMAGE_TAG="$COMMIT"
IMAGE_NAME="$CONTAINER_NAME:$IMAGE_TAG"

echo "╔══════════════════════════════════════════════╗"
echo "║  poker-h5 部署                               ║"
echo "║  版本:  $IMAGE_TAG                           ║"
echo "║  分支:  $(git branch --show-current)         ║"
echo "╚══════════════════════════════════════════════╝"

# ── 检查镜像是否已存在 ────────────────────────────────────
if docker image inspect "$IMAGE_NAME" &>/dev/null; then
  echo "⚡ 镜像 $IMAGE_NAME 已存在，跳过构建"
else
  echo "🔨 构建镜像 $IMAGE_NAME ..."
  DOCKER_BUILDKIT=0 docker build \
    -t "$IMAGE_NAME" \
    --build-arg "APP_RELEASE=$IMAGE_TAG" \
    . 2>&1

  if [[ $? -ne 0 ]]; then
    echo "❌ 构建失败" >&2
    exit 1
  fi
  echo "✅ 构建完成"
fi

# ── 停止旧容器 ────────────────────────────────────────────
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "🛑 停止旧容器 ..."
  docker stop "$CONTAINER_NAME" --timeout 5 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
  echo "✅ 旧容器已移除"
fi

# ── 启动新容器 ────────────────────────────────────────────
echo "🚀 启动新容器 ..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --network "$NETWORK" \
  -v "${VOLUME}:/data" \
  -e PORT="$PORT" \
  -e DATABASE_PATH="/data/poker.db" \
  -e COOKIE_SECURE=false \
  "$IMAGE_NAME"

# ── 健康检查 ──────────────────────────────────────────────
echo "⏳ 等待服务就绪 ..."
for i in $(seq 1 15); do
  sleep 1
  HEALTH="$(docker exec "$CONTAINER_NAME" node -e "
    fetch('http://127.0.0.1:$PORT/api/health')
      .then(r => r.json())
      .then(d => console.log(JSON.stringify(d)))
      .catch(() => {})
  " 2>/dev/null || true)"
  if echo "$HEALTH" | grep -q '"ok":true'; then
    RELEASE="$(echo "$HEALTH" | grep -o '"release":"[^"]*"' | cut -d'"' -f4)"
    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║  ✅ 部署成功                                  ║"
    echo "║  容器: $CONTAINER_NAME                       ║"
    echo "║  版本: $RELEASE                              ║"
    echo "║  地址: http://66.154.100.45                  ║"
    echo "╚══════════════════════════════════════════════╝"
    exit 0
  fi
  printf "."
done

echo ""
echo "❌ 健康检查超时，查看日志:"
docker logs "$CONTAINER_NAME" --tail 20
exit 1
