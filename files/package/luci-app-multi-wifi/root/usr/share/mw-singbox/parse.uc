#!/usr/bin/ucode
// parse.uc - 把代理分享链接解析为 sing-box outbound JSON
// 用法: parse.uc <share-link>
// 输出(单行): OK|<type>|<json>   或   ERR|<reason>

// 内联 base64 解码（本机 ucode 不支持模块 export，故不 import）
function b64decode(s) {
	const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	s = replace(s, "-", "+");
	s = replace(s, "_", "/");
	s = replace(s, "\r", "");
	s = replace(s, "\n", "");
	s = replace(s, "\t", "");
	s = replace(s, " ", "");
	while (length(s) % 4)
		s += "=";
	let charmap = {};
	for (let j = 0; j < length(ALPHABET); j++) {
		let ch = substr(ALPHABET, j, 1);
		charmap[ch] = j;
	}
	let out = "", buf = 0, bits = 0, i = 0;
	while (i < length(s)) {
		let c = substr(s, i++, 1);
		if (c == "=")
			break;
		let v = charmap[c];
		if (v == null)
			continue;
		buf = (buf << 6) | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out += chr((buf >> bits) & 0xff);
		}
	}
	return out;
}

function urldec(x) {
	if (x == null)
		return "";
	let out = "";
	let i = 0;
	let n = length(x);
	while (i < n) {
		let c = substr(x, i, 1);
		if (c == "%" && i + 2 < n) {
			let h = substr(x, i + 1, 2);
			out += chr(hex(h));
			i += 3;
		} else if (c == "+") {
			out += " ";
			i++;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

// 返回 [ path, query-object ]
function qs_split(s) {
	let qs = {};
	let q = index(s, "?");
	if (q < 0)
		return [ s, qs ];
	for (let kv in split(substr(s, q + 1), "&")) {
		let p = index(kv, "=");
		if (p < 0) { qs[kv] = ""; continue; }
		qs[substr(kv, 0, p)] = urldec(substr(kv, p + 1));
	}
	return [ substr(s, 0, q), qs ];
}

function hp_split(hp) {
	let c = rindex(hp, ":");
	if (c < 0)
		return [ hp, 0 ];
	return [ substr(hp, 0, c), int(substr(hp, c + 1)) ];
}

function ok(type, ob) {
	print("OK|" + type + "|" + sprintf("%J", ob) + "\n");
	exit(0);
}

let link = ARGV[0] || "";

/* ---------------- vmess ---------------- */
if (match(link, /^vmess:\/\//)) {
	let j = json(b64decode(substr(link, 8)));
	let ob = {
		type: "vmess", tag: "",
		server: j.add, server_port: int(j.port),
		uuid: j.id, alter_id: int(j.aid ?? 0), security: j.scy ?? "auto"
	};
	if (j.net && j.net != "tcp")
		ob.transport = {
			type: (j.net == "ws") ? "ws" : j.net,
			path: j.path ?? "/",
			headers: (j.host) ? { Host: j.host } : null
		};
	if (j.tls == "tls")
		ob.tls = { enabled: true, server_name: j.sni ?? j.host ?? j.add, insecure: false };
	ok("vmess", ob);
}

/* ---------------- vless ---------------- */
if (match(link, /^vless:\/\//)) {
	let head = split(substr(link, 8), "#")[0];
	let sp = qs_split(head);
	let main = sp[0], qs = sp[1];
	let at = index(main, "@");
	let uuid = substr(main, 0, at);
	let hp = hp_split(substr(main, at + 1));
	let ob = {
		type: "vless", tag: "",
		server: hp[0], server_port: hp[1], uuid: uuid,
		flow: qs.flow ?? ""
	};
	if (qs.security == "tls" || qs.security == "reality") {
		ob.tls = {
			enabled: true,
			server_name: qs.sni ?? "",
			insecure: (qs.allowInsecure == "1")
		};
		if (qs.security == "reality")
			ob.tls.reality = {
				enabled: true,
				public_key: qs.pbk ?? "",
				short_id: qs.sid ?? ""
			};
	}
	if (qs.type == "ws")
		ob.transport = {
			type: "ws", path: urldec(qs.path ?? "/"),
			headers: (qs.host) ? { Host: qs.host } : null
		};
	else if (qs.type == "grpc")
		ob.transport = { type: "grpc", service_name: qs.serviceName ?? "" };
	ok("vless", ob);
}

/* ---------------- trojan ---------------- */
if (match(link, /^trojan:\/\//)) {
	let head = split(substr(link, 9), "#")[0];
	let sp = qs_split(head);
	let main = sp[0], qs = sp[1];
	let at = index(main, "@");
	let pw = substr(main, 0, at);
	let hp = hp_split(substr(main, at + 1));
	let ob = {
		type: "trojan", tag: "",
		server: hp[0], server_port: hp[1], password: pw,
		tls: {
			enabled: true,
			server_name: qs.sni ?? qs.peer ?? "",
			insecure: (qs.allowInsecure == "1")
		}
	};
	if (qs.type == "ws")
		ob.transport = {
			type: "ws", path: qs.path ?? "/",
			headers: (qs.host) ? { Host: qs.host } : null
		};
	ok("trojan", ob);
}

/* ---------------- shadowsocks ---------------- */
if (match(link, /^ss:\/\//)) {
	let body = split(substr(link, 5), "#")[0];
	let method, pass, host, port;
	if (index(body, "@") >= 0) {
		let at = index(body, "@");
		let mp = split(b64decode(substr(body, 0, at)), ":");
		method = mp[0]; pass = mp[1];
		let hp = hp_split(substr(body, at + 1));
		host = hp[0]; port = hp[1];
	} else {
		let d = b64decode(body);
		let at = index(d, "@");
		let mp = split(substr(d, 0, at), ":");
		method = mp[0]; pass = mp[1];
		let hp = hp_split(substr(d, at + 1));
		host = hp[0]; port = hp[1];
	}
	ok("shadowsocks", {
		type: "shadowsocks", tag: "",
		server: host, server_port: port,
		method: method, password: pass
	});
}

/* ---------------- hysteria2 ---------------- */
if (match(link, /^hysteria2:\/\//) || match(link, /^hy2:\/\//)) {
	link = replace(link, /^hy2:\/\//, "hysteria2://");
	let head = split(substr(link, 12), "#")[0];
	let sp = qs_split(head);
	let main = sp[0], qs = sp[1];
	let at = index(main, "@");
	let auth = substr(main, 0, at);
	let hp = hp_split(substr(main, at + 1));
	ok("hysteria2", {
		type: "hysteria2", tag: "",
		server: hp[0], server_port: hp[1], password: auth,
		tls: {
			enabled: true,
			server_name: qs.sni ?? "",
			insecure: (qs.insecure == "1")
		}
	});
}

/* ---------------- tuic ---------------- */
if (match(link, /^tuic:\/\//)) {
	let head = split(substr(link, 7), "#")[0];
	let sp = qs_split(head);
	let main = sp[0], qs = sp[1];
	let at = index(main, "@");
	let cred = split(substr(main, 0, at), ":");
	let hp = hp_split(substr(main, at + 1));
	ok("tuic", {
		type: "tuic", tag: "",
		server: hp[0], server_port: hp[1],
		uuid: cred[0], password: cred[1],
		tls: {
			enabled: true,
			server_name: qs.sni ?? "",
			insecure: (qs.allow_insecure == "1")
		},
		congestion_control: "bbr"
	});
}

/* ---------------- socks ---------------- */
if (match(link, /^socks5?:\/\//)) {
	let head = split(replace(link, /^socks5?:\/\//, ""), "#")[0];
	let sp = qs_split(head);
	let main = sp[0];
	let at = index(main, "@");
	if (at < 0) {
		let hp = hp_split(main);
		ok("socks", { type: "socks", tag: "", server: hp[0], server_port: hp[1] });
	}
	let cred = split(substr(main, 0, at), ":");
	let hp = hp_split(substr(main, at + 1));
	ok("socks", {
		type: "socks", tag: "",
		server: hp[0], server_port: hp[1],
		username: cred[0], password: cred[1]
	});
}

print("ERR|unsupported scheme\n");
exit(1);
