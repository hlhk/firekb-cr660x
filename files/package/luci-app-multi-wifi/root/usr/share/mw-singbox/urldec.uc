#!/usr/bin/ucode
let s = ARGV[0] ?? "";
let out = "";
let i = 0, n = length(s);
while (i < n) {
	let c = substr(s, i, 1);
	if (c == "%" && i + 2 < n + 1) {
		let h = substr(s, i + 1, 2);
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
print(out);
