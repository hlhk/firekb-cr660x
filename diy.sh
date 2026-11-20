#!/bin/bash
# 组装最终 .config
# 用法: bash diy.sh [minimal|full]
#
# minimal: 精简版，只含 LuCI + 中文 + 主题 + 多WiFi插件
#          目的是验证系统能在 CR660X 上正常启动、网络正常
#          initramfs 会回到 7MB 左右，uboot TFTP 也能加载
# full:    完整版，加 PassWall / OpenClash / Xray / Sing-Box 等
set -e

WS="$GITHUB_WORKSPACE"
FLAVOR="${1:-minimal}"

echo "=========================================="
echo " Firekb CR660X 配置组装 [flavor=$FLAVOR]"
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
# initramfs 保留（uboot TFTP 恢复要用）
CONFIG_TARGET_ROOTFS_INITRAMFS=y
EOF

# ---------- 2. 包选择 ----------
if [ "$FLAVOR" = "full" ]; then
  echo ">>> 2/4 [full] 叠加完整包选择"
  if [ -f "$WS/config.packages" ]; then
    cat "$WS/config.packages" >> .config
    echo "    追加 $(wc -l < "$WS/config.packages") 行"
  else
    echo "    ERROR: config.packages 不存在"
    exit 1
  fi
else
  echo ">>> 2/4 [minimal] 只装基础 LuCI + 主题 + 多WiFi"
  cat >> .config <<'EOF'
CONFIG_PACKAGE_luci=y
CONFIG_PACKAGE_luci-app-firewall=y
CONFIG_PACKAGE_luci-app-package-manager=y
CONFIG_PACKAGE_luci-app-ttyd=y
CONFIG_PACKAGE_luci-app-uhttpd=y
CONFIG_PACKAGE_luci-app-upnp=y
CONFIG_PACKAGE_luci-app-wol=y
CONFIG_PACKAGE_luci-app-multi-wifi=y
CONFIG_PACKAGE_luci-theme-bootstrap=y
CONFIG_PACKAGE_luci-theme-vantage=y
CONFIG_PACKAGE_luci-app-vantage=y
EOF
fi

# ---------- 3. 品牌与通用选项 ----------
echo ">>> 3/4 品牌与通用选项"
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
CONFIG_CCACHE=y
CONFIG_LUCI_LANG_zh_Hans=y
CONFIG_LUCI_JSMIN=y
CONFIG_LUCI_CSSTIDY=y
EOF

# 绝对不要设置 CONFIG_TARGET_OPTIMIZATION
# OpenWrt 对 ramips/mt7621 默认是：
#   -Os -pipe -mno-branch-likely -mips32r2 -mtune=24kc
# 之前误写成 -mcpu=24kc，改变了指令集基线，MT7621 是 MIPS 1004Kc，
# 有生成不兼容指令的风险。交给 OpenWrt 自己决定。

# ---------- 4. defconfig 收敛 ----------
echo ">>> 4/4 defconfig 收敛"
make defconfig 2>&1 | tail -3 || true

echo ""
echo "=========================================="
echo " 校验"
echo "=========================================="
echo "--- target ---"
grep -E '^CONFIG_TARGET_(BOARD|SUBTARGET|ARCH_PACKAGES)=' .config || true
echo "--- 三型号 ---"
grep -cE '^CONFIG_TARGET_DEVICE_ramips_mt7621_DEVICE_xiaomi_mi-router-cr660[689]=y' .config
echo "--- 版本 ---"
grep -E '^CONFIG_VERSION_(DIST|NUMBER|CODE)=' .config || true
echo "--- 编译优化（应为空，用默认） ---"
grep -E '^CONFIG_TARGET_OPTIMIZATION=' .config || echo "  (未设置，使用默认值 ✓)"
echo "--- 启用包总数 ---"
grep -c '=y$' .config

# ---------- 硬校验 ----------
fail=0

if ! grep -q '^CONFIG_TARGET_BOARD="ramips"' .config; then
  echo "ERROR: target 不是 ramips"
  fail=1
fi

if ! grep -q '^CONFIG_TARGET_SUBTARGET="mt7621"' .config; then
  echo "ERROR: subtarget 不是 mt7621"
  fail=1
fi

n=$(grep -cE '^CONFIG_TARGET_DEVICE_ramips_mt7621_DEVICE_xiaomi_mi-router-cr660[689]=y' .config)
if [ "$n" != "3" ]; then
  echo "ERROR: 三型号未全部选中（当前 $n）"
  fail=1
fi

for p in luci-theme-vantage luci-app-multi-wifi; do
  if ! grep -q "^CONFIG_PACKAGE_$p=y" .config; then
    echo "ERROR: 缺少 $p"
    fail=1
  fi
done

if [ "$FLAVOR" = "full" ]; then
  for p in luci-app-passwall luci-app-openclash; do
    if ! grep -q "^CONFIG_PACKAGE_$p=y" .config; then
      echo "ERROR: 缺少 $p"
      fail=1
    fi
  done
fi

if [ "$fail" = "1" ]; then
  echo ""
  echo "配置校验失败"
  exit 1
fi

echo ""
echo "配置校验通过 [flavor=$FLAVOR]"