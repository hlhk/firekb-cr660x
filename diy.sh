#!/bin/bash
# 组装最终 .config：target 种子 + 本地已验证的包选择 + 品牌覆盖
# 由 GitHub Actions 在 openwrt 源码根目录调用
set -e

WS="$GITHUB_WORKSPACE"

echo "=========================================="
echo " 组装 Firekb CR660X 配置"
echo "=========================================="

# ---------- 1. target ----------
echo ">>> 1/4 写入 target（ramips/mt7621，三型号）"
cat > .config <<'EOF'
CONFIG_TARGET_ramips=y
CONFIG_TARGET_ramips_mt7621=y
CONFIG_TARGET_MULTI_PROFILE=y
CONFIG_TARGET_DEVICE_ramips_mt7621_DEVICE_xiaomi_mi-router-cr6606=y
CONFIG_TARGET_DEVICE_ramips_mt7621_DEVICE_xiaomi_mi-router-cr6608=y
CONFIG_TARGET_DEVICE_ramips_mt7621_DEVICE_xiaomi_mi-router-cr6609=y
CONFIG_TARGET_ROOTFS_SQUASHFS=y
CONFIG_TARGET_ROOTFS_UBI=y
EOF

# ---------- 2. 包选择（从 WD830M 已验证配置提取） ----------
echo ">>> 2/4 叠加包选择"
if [ -f "$WS/config.packages" ]; then
  cat "$WS/config.packages" >> .config
  echo "    追加 $(wc -l < "$WS/config.packages") 行"
else
  echo "    警告：config.packages 不存在，跳过"
fi

# ---------- 3. 品牌与编译选项（覆盖前面的） ----------
echo ">>> 3/4 品牌与编译选项"
cat >> .config <<'EOF'
CONFIG_IMAGEOPT=y
CONFIG_VERSIONOPT=y
CONFIG_VERSION_DIST="Firekb"
CONFIG_VERSION_NUMBER="25.12.6"
CONFIG_VERSION_CODE="esdli"
CONFIG_VERSION_HOME_URL="https://esdli.github.io/firekb"
CONFIG_VERSION_MANUFACTURER="esdli"
CONFIG_VERSION_MANUFACTURER_URL="https://esdli.github.io/firekb"
CONFIG_VERSION_BUG_URL="https://esdli.github.io/firekb"
CONFIG_VERSION_SUPPORT_URL="https://esdli.github.io/firekb"
CONFIG_VERSION_FILENAMES=y
CONFIG_VERSION_CODE_FILENAMES=y
CONFIG_TARGET_OPTIMIZATION="-Os -pipe -mcpu=24kc"
CONFIG_CCACHE=y
CONFIG_LUCI_LANG_zh_Hans=y
CONFIG_LUCI_JSMIN=y
CONFIG_LUCI_CSSTIDY=y
EOF

# ---------- 4. 校正 ----------
echo ">>> 4/4 defconfig 收敛"
make defconfig 2>&1 | tail -3 || true

echo ""
echo "=========================================="
echo " 校验"
echo "=========================================="
echo "--- target ---"
grep -E 'CONFIG_TARGET_(BOARD|SUBTARGET|ARCH_PACKAGES)=' .config
echo "--- 三型号 ---"
grep -E 'CONFIG_TARGET_DEVICE_ramips_mt7621_DEVICE_xiaomi_mi-router-cr660' .config
echo "--- 版本 ---"
grep -E 'CONFIG_VERSION_(DIST|NUMBER|CODE)=' .config
echo "--- 主题 ---"
grep -E '^CONFIG_PACKAGE_luci-theme-(vantage|bootstrap)=y' .config
echo "--- 启用包总数 ---"
grep -c '=y$' .config

# 硬校验
fail=0
for p in luci-app-passwall luci-app-openclash luci-app-multi-wifi \
         luci-theme-vantage luci-app-ttyd luci-app-upnp; do
  if ! grep -q "^CONFIG_PACKAGE_$p=y" .config; then
    echo "ERROR: 缺少 $p"
    fail=1
  fi
done

# target 必须是 ramips
if ! grep -q '^CONFIG_TARGET_BOARD="ramips"' .config; then
  echo "ERROR: target 不是 ramips"
  grep -E '^CONFIG_TARGET_BOARD' .config || true
  fail=1
fi

if [ "$fail" = "1" ]; then
  echo ""
  echo "配置校验失败"
  exit 1
fi

echo ""
echo "配置校验通过"