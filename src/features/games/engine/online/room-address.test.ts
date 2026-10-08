import { expect, test } from "vitest";

import { parseRoomAddress } from "./room-address";

test("解析主机、IPv4 与带方括号的 IPv6", () => {
  expect(parseRoomAddress(" 192.168.1.2:9021 ")).toEqual({
    host: "192.168.1.2",
    port: 9021,
  });
  expect(parseRoomAddress("mftp.local:9021")).toEqual({
    host: "mftp.local",
    port: 9021,
  });
  expect(parseRoomAddress("[::1]:9021")).toEqual({ host: "::1", port: 9021 });
});

test("拒绝额外段、指数端口和越界端口，不静默连接另一地址", () => {
  for (const value of [
    "host:12:34",
    "host:1e3",
    "host:0",
    "host:65536",
    "::1:9021",
    "host :9021",
    "host",
    ":9021",
  ])
    expect(parseRoomAddress(value)).toBeNull();
});
