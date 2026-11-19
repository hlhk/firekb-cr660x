#!/bin/bash
# Firekb CR660X (MT7621) 编译定制脚本
# 由 GitHub Actions 在 openwrt 源码根目录调用
set -e

echo "=========================================="
echo " Firekb CR660X DIY"
echo "=========================================="

# ---------- 1. 品牌信息 ----------
echo ">>> 写入 Firekb 品牌版本信息"
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
EOF

# ---------- 2. LuCI 中文 + 主题 ----------
echo ">>> LuCI 语言与主题"
cat >> .config <<'EOF'
CONFIG_LUCI_LANG_zh_Hans=y
CONFIG_PACKAGE_luci-i18n-base-zh-cn=y
CONFIG_PACKAGE_luci-theme-bootstrap=y
CONFIG_PACKAGE_luci-theme-vantage=y
CONFIG_LUCI_JSMIN=y
CONFIG_LUCI_CSSTIDY=y
EOF

# ---------- 3. 自研包 ----------
echo ">>> 自研 luci-app-multi-wifi"
cat >> .config <<'EOF'
CONFIG_PACKAGE_luci-app-multi-wifi=y
EOF

# ---------- 4. 代理插件 ----------
echo ">>> PassWall + OpenClash"
cat >> .config <<'EOF'
CONFIG_PACKAGE_luci-app-openclash=y
CONFIG_PACKAGE_luci-app-passwall=y
CONFIG_PACKAGE_luci-app-passwall_Nftables_Transparent_Proxy=y
CONFIG_PACKAGE_luci-app-passwall_INCLUDE_Xray=y
CONFIG_PACKAGE_luci-app-passwall_INCLUDE_SingBox=y
CONFIG_PACKAGE_luci-app-passwall_INCLUDE_Haproxy=y
CONFIG_PACKAGE_luci-app-passwall_INCLUDE_Geoview=y
CONFIG_PACKAGE_luci-app-passwall_INCLUDE_Simple_Obfs=y
CONFIG_PACKAGE_luci-app-passwall_INCLUDE_Shadowsocks_Rust_Client=y
CONFIG_PACKAGE_luci-app-passwall_INCLUDE_ShadowsocksR_Libev_Client=y
CONFIG_PACKAGE_luci-app-passwall_INCLUDE_V2ray_Plugin=y
EOF

# ---------- 5. 常用工具 ----------
echo ">>> 常用 LuCI 应用"
cat >> .config <<'EOF'
CONFIG_PACKAGE_luci-app-firewall=y
CONFIG_PACKAGE_luci-app-package-manager=y
CONFIG_PACKAGE_luci-app-ttyd=y
CONFIG_PACKAGE_luci-app-uhttpd=y
CONFIG_PACKAGE_luci-app-upnp=y
CONFIG_PACKAGE_luci-app-wol=y
CONFIG_PACKAGE_luci-app-nlbwmon=y
EOF

# ---------- 6. 内核 / 系统组件 ----------
echo ">>> 内核与网络组件"
cat >> .config <<'EOF'
CONFIG_PACKAGE_kmod-mt7915-firmware=y
CONFIG_PACKAGE_kmod-tun=y
CONFIG_PACKAGE_kmod-nft-tproxy=y
CONFIG_PACKAGE_kmod-nft-socket=y
CONFIG_PACKAGE_kmod-inet-diag=y
CONFIG_PACKAGE_kmod-nf-conntrack-netlink=y
EOF

# ---------- 7. 编译优化 ----------
echo ">>> 编译优化"
cat >> .config <<'EOF'
CONFIG_TARGET_OPTIMIZATION="-Os -pipe -mcpu=24kc"
CONFIG_CCACHE=y
CONFIG_USE_MKLIBS=y
EOF

echo ""
echo "=========================================="
echo " DIY 完成，当前 target："
echo "=========================================="
grep -E 'CONFIG_TARGET_(BOARD|SUBTARGET)=' .config || true
echo ""
echo "已启用包（LuCI 相关）："
grep -E '^CONFIG_PACKAGE_luci-' .config || true