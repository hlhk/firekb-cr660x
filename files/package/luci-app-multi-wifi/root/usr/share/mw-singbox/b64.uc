#!/usr/bin/ucode
// b64.uc - base64 解码（自包含）
// 用法: b64.uc <输入文件>   或   b64.uc - （从 stdin 的临时文件读）

import { readfile } from "fs";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64decode(s) {
	s = replace(s, "-", "+");
	s = replace(s, "_", "/");
	s = replace(s, /[\r\n\t ]/g, "");
	while (length(s) % 4)
		s += "=";
	let charmap = {};
	for (let j = 0; j < length(ALPHABET); j++)
		charmap[substr(ALPHABET, j, 1)] = j;
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

let f = ARGV[0];
if (!f || !length(f)) {
	warn("用法: b64.uc <file>");
	exit(1);
}

let data;
try {
	data = readfile(f);
} catch (e) {
	warn("读取失败: " + e);
	exit(1);
}

try {
	print(b64decode(data));
} catch (e) {
	warn("解码失败: " + e);
	exit(1);
}
