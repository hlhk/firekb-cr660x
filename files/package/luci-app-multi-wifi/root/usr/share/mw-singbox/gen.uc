#!/usr/bin/ucode
// gen.uc - 根据绑定关系生成 sing-box 配置
// 输入文件每行: iface|octet|node_id|<json>
// 参数: gen.uc <bindfile> <tproxy_port>
import { readfile } from "fs";

let f = ARGV[0];
let tproxy_port = int(ARGV[1] || 7893);

if (!f || !length(f)) {
	warn("no bind file");
	exit(1);
}

let data;
try {
	data = readfile(f);
} catch (e) {
	warn("read fail: " + e);
	exit(1);
}

let outbounds = [];
let rules = [];
let have = false;

for (let raw in split(data, "\n")) {
	let l = trim(raw);
	if (!length(l))
		continue;

	// 用 split 切出前 3 段，剩余部分重新拼接为 JSON
	let parts = split(l, "|");
	if (length(parts) < 4) {
		warn("bad line: " + l);
		continue;
	}

	let iface = parts[0];
	let octet = parts[1];
	let nid   = parts[2];
	// JSON 可能含 '|'，把第 4 段之后的全部拼回来
	let js = parts[3];
	for (let k = 4; k < length(parts); k++)
		js += "|" + parts[k];

	let ob;
	try {
		ob = json(js);
	} catch (e) {
		warn("bad json node " + nid + ": " + e);
		continue;
	}

	let tag = "mw-" + iface + "-n" + nid;
	ob.tag = tag;
	push(outbounds, ob);
	push(rules, {
		source_ip_cidr: [ "192.168." + octet + ".0/24" ],
		outbound: tag
	});
	have = true;
}

if (!have) {
	warn("no valid binds");
	exit(1);
}

// 兜底直连
push(outbounds, { type: "direct", tag: "direct" });

let cfg = {
	log: { level: "warn", timestamp: true },
	inbounds: [
		{
			type: "tproxy",
			tag: "mw-tproxy",
			listen: "0.0.0.0",
			listen_port: tproxy_port,
			network: [ "tcp", "udp" ]
		}
	],
	outbounds: outbounds,
	route: {
		rules: rules,
		final: "direct",
		auto_detect_interface: true
	}
};

print(sprintf("%J", cfg));
exit(0);
