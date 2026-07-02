import { describe, it, expect } from 'vitest';
import { isBlockedAddress } from './safe-fetch.ts';

describe('isBlockedAddress — SSRF IP guard', () => {
  it('blocks the cloud metadata endpoint and link-local', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('169.254.0.1')).toBe(true);
  });

  it('blocks loopback', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('127.1.2.3')).toBe(true);
    expect(isBlockedAddress('::1')).toBe(true);
  });

  it('blocks RFC1918 private ranges', () => {
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
  });

  it('does not block just-outside private boundaries', () => {
    expect(isBlockedAddress('172.15.0.1')).toBe(false); // just below 172.16/12
    expect(isBlockedAddress('172.32.0.1')).toBe(false); // just above 172.31
    expect(isBlockedAddress('11.0.0.1')).toBe(false);
  });

  it('blocks CGNAT, "this network", multicast, reserved', () => {
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
    expect(isBlockedAddress('224.0.0.1')).toBe(true);
    expect(isBlockedAddress('240.0.0.1')).toBe(true);
    expect(isBlockedAddress('255.255.255.255')).toBe(true);
  });

  it('allows ordinary public IPv4', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('93.184.216.34')).toBe(false); // example.com
  });

  it('blocks IPv6 loopback, ULA, link-local, and IPv4-mapped tricks', () => {
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('::')).toBe(true);
    expect(isBlockedAddress('fc00::1')).toBe(true); // ULA
    expect(isBlockedAddress('fd12:3456::1')).toBe(true); // ULA
    expect(isBlockedAddress('fe80::1')).toBe(true); // link-local
    expect(isBlockedAddress('ff02::1')).toBe(true); // multicast
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true); // mapped metadata
    expect(isBlockedAddress('64:ff9b::7f00:1')).toBe(true); // NAT64 → loopback
  });

  it('allows global-unicast IPv6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false); // cloudflare
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false); // google
  });

  it('fails closed on garbage', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
  });
});
