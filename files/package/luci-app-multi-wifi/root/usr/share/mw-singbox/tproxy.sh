#!/bin/sh
# tproxy.sh - 为已绑定 SSID 的隔离网段设置 nftables tproxy 重定向
#   tproxy.sh apply [port]
#   tproxy.sh clear
PORT="${2:-7893}"

BRIDGES=""
if [ -f /tmp/sing-box-mw.binds ]; then
	for ifc in $(cut -d'|' -f1 /tmp/sing-box-mw.binds | sort -u); do
		# ifc 形如 mw1 -> 取数字 1 -> br-mwbr1
		num=$(echo "$ifc" | tr -cd '0-9')
		if [ -n "$num" ] && [ -d "/sys/class/net/br-mwbr${num}" ]; then
			BRIDGES="$BRIDGES br-mwbr${num}"
		elif [ -d "/sys/class/net/br-${ifc}" ]; then
			BRIDGES="$BRIDGES br-${ifc}"
		else
			echo "警告: $ifc 对应的 bridge 不存在" >&2
		fi
	done
fi

case "${1:-}" in
apply)
	nft delete table inet mwtproxy 2>/dev/null
	[ -z "$BRIDGES" ] && { echo "无可用 bridge" >&2; exit 0; }
	{
		echo "table inet mwtproxy {"
		echo "  chain prerouting {"
		echo "    type filter hook prerouting priority mangle; policy accept;"
		for b in $BRIDGES; do
			echo "    iifname \"$b\" meta l4proto { tcp, udp } tproxy ip to :$PORT accept"
		done
		echo "  }"
		echo "}"
	} | nft -f -
	echo "tproxy -> :$PORT  接口:$BRIDGES"
	;;
clear)
	nft delete table inet mwtproxy 2>/dev/null || true
	;;
*)
	echo "用法: tproxy.sh {apply [port]|clear}" >&2
	exit 1
	;;
esac
