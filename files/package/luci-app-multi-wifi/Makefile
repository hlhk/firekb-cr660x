include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-multi-wifi
PKG_VERSION:=1.3.4
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Firekb

LUCI_TITLE:=LuCI app for creating multiple WiFi SSIDs (VAP)
LUCI_DEPENDS:=+luci-base +rpcd-mod-iwinfo +firewall4
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
