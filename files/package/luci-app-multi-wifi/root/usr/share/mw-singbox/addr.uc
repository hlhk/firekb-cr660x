#!/usr/bin/ucode
// addr.uc <json-file>  ->  server|port
import { readfile } from "fs";

let raw = "";
try {
	raw = readfile(ARGV[0]);
} catch (e) {
	print("-|");
	exit(0);
}
let j = {};
try {
	j = json(raw);
} catch (e) {
	print("-|");
	exit(0);
}
let port = j.server_port;
if (port == null)
	port = "";
print((j.server || "-") + "|" + port);
