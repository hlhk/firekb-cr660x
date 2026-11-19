LuCI app: Multi WiFi
====================

一次性批量创建多个 WiFi SSID (VAP)，并在数量接近/超过硬件上限时给出风险提示。

功能
----
* 选择频段（2.4G / 5G）、填写数量 → 批量生成 SSID
* 生成的 SSID 默认为 <前缀>-<序号>，密码统一
* 已创建的 SSID 可逐个修改名称、密码、启用状态，或删除
* 实时显示每个频段的「理论上限 / 建议上限 / 当前已用」
* 输入数量时即时风险提示：
    - 安全范围内：绿色提示
    - 接近上限：橙色警告（可继续）
    - 超过上限：红色拦截（需二次确认，会警告主 SSID 一起掉线）
* 顶部环境自检（mwcheck）：
    - 检查系统信息、包管理器、依赖、无线驱动 VAP 能力、IP 段冲突、磁盘空间
    - 可分「查看详情 / 收起详情」展开逐项结果
    - 检测到阻碍项（verdict=fail）时，「生成 SSID」按钮自动禁用并显示红色提示，
      避免在不可用环境上误创建
* SSID 列表「在线设备」列：
    - 实时显示每个 SSID 当前连接的终端数量（N 台）
    - 每 15 秒自动刷新
    - 鼠标悬停可查看每个终端的 MAC、信号强度、RX/TX 速率
    - 数据来源：/usr/sbin/mwclients（解析 iwinfo assoclist）

网络模式
--------
* lan 模式：所有 SSID 桥接到 br-lan，共用 192.168.8.x 网段
* iso 隔离模式：每个 SSID 独立的 bridge（br-mwbrN）+ 静态接口（mwN）
  + DHCP 池（192.168.(10+N).x）+ firewall4 独立 zone，仅放行到 WAN，互不可见

硬件上限（MT7981 / mt798x-wmac，本机实测）
------------------------------------------
  2.4G (phy0):  主 SSID + 最多 14 个额外 = 15 个总数
  5G   (phy1):  主 SSID + 最多 15 个额外 = 16 个总数
  建议各留 2 个余量：2.4G ≤ 13，5G ≤ 14（含主 SSID）

超过上限的后果（实测验证）
--------------------------
2.4G 配到 17 个 AP 时，hostapd 报：
    netlink: recvfrom failed: No buffer space available
    hostapd_free_hapd_data: Interface phy0-ap14 wasn't started
然后整个频段所有接口被注销，主 SSID 也掉线，必须重启无线才能恢复。
加大 net/core/rmem_max 无法规避（驱动层 BSS 表边界）。

实现说明
--------
* 本插件创建的 section 都带 mw_managed=1 标记，前缀 mw_，
  「已创建列表」只显示这些，不会碰系统原有的 wifi-iface。
* 通过 ubus network.wireless reload 应用配置。
* 辅助脚本（安装到 /usr/sbin）：
    - mwctl     ：SSID 生成 / 删除 / 列举 / 隔离清理
    - mwcheck   ：环境自检，支持 -q / --info / -j(JSON)
    - mwclients ：输出各 AP 接口的在线终端（JSON），供界面轮询

版本
----
* 1.3.0：新增自检否决项禁用生成按钮、在线设备数实时列
* 1.2.0：集成环境自检状态横幅
* 1.1.0：新增隔离模式 + mwctl
* 1.0.0：仅 LAN 模式批量创建
