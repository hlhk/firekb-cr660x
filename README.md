# Firekb CR660X 固件（GitHub Actions 云端编译）

小米 CR6606 / CR6608 / CR6609（MT7621 + MT7915E）的 Firekb 固件。

**不占用本地磁盘**，全部编译在 GitHub Actions 完成。

## 设备

| 项 | 值 |
|---|---|
| SoC | MediaTek MT7621 |
| 无线 | MT7915E（2.4G + 5G，802.11ax） |
| 内存 | 256 MB |
| 闪存 | 128 MB NAND (Samsung) |
| 分区 | `kernel` 4MB @0x200000，`ubi` 121.5MB @0x600000 |
| 管理地址 | `192.168.9.1`（刷完） |
| WiFi | `Firekb_2.4G` / `Firekb_5G`，密码 `12345678` |
| root 密码 | 无（首次登录直接进） |

三个型号 **DTS 完全相同**，镜像是同一份内容，只是文件名不同。

## 包含内容

- **LuCI** 中文 + Vantage 主题
- **自研 `luci-app-multi-wifi`**：多 WiFi 独立出口（配合 mw-singbox）
- **PassWall**（Xray / SingBox / Haproxy / Geoview / Simple-Obfs / SS-Rust / SSR-Libev / V2ray-Plugin）
- **OpenClash**
- 工具：firewall、package-manager、ttyd、uhttpd、upnp、wol、nlbwmon
- 内核模块：mt7915-firmware、tun、nft-tproxy、nft-socket、inet-diag、nf-conntrack-netlink

## 怎么编译

### 方式一：网页点一下

1. 打开本仓库 **Actions** 标签
2. 左侧选 **Build Firekb CR660X**
3. 点 **Run workflow** → **Run workflow**
4. 等约 60–90 分钟

### 方式二：改完配置推送自动编

改 `diy.sh` / `files/**` / `config.seed` 后 push 到 `main`，自动触发。

## 取固件

编译完成后，在 Actions 运行详情页底部 **Artifacts** 下载：

```
Firekb-CR660X-<run_number>.zip
```

解压得到：

```
openwrt-ramips-mt7621-xiaomi_mi-router-cr6606-squashfs-sysupgrade.bin
openwrt-ramips-mt7621-xiaomi_mi-router-cr6608-squashfs-sysupgrade.bin
openwrt-ramips-mt7621-xiaomi_mi-router-cr6609-squashfs-sysupgrade.bin
```

## 刷机

**用 `sysupgrade.bin`，不要用 `factory.bin`。**

前提：路由器已经在跑 OpenWrt/Kwrt（当前这台是 Kwrt 25.12-SNAPSHOT）。

### LuCI 方式
系统 → 备份/刷写固件 → 选择 `xxx-squashfs-sysupgrade.bin` → 不保留配置 → 刷写

### SSH 方式
```sh
scp openwrt-ramips-mt7621-...-sysupgrade.bin root@192.168.9.1:/tmp/
ssh root@192.168.9.1
sysupgrade -n /tmp/openwrt-ramips-mt7621-...-sysupgrade.bin
```

`-n` 表示不保留原配置（推荐，避免 Kwrt 的残留配置冲突）。

刷完路由器地址变为 **192.168.9.1**。

## 目录结构

```
.github/workflows/build.yml   编译流程
diy.sh                        编译定制（品牌、包、优化）
config.seed                   target 种子配置
files/
  package/luci-app-multi-wifi/ 自研多 WiFi 出口插件
  uci-defaults/99-firekb-custom 出厂默认配置
```

## 注意

- 首次编译约 60–90 分钟（要构建 mipsel 工具链）
- 有 ccache 缓存，后续编译会快很多
- 如果只想编一个型号，可在 workflow 的 `profile` 输入框选具体型号