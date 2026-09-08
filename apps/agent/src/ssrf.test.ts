import { describe, expect, it } from 'vitest';
import { checkUpstream, isPrivateAddress } from './ssrf';

const strict = { allowLocalhost: false };
const dev = { allowLocalhost: true };

describe('checkUpstream (spec 06 §6.2)', () => {
  it('allows public https endpoints', () => {
    for (const url of [
      'https://api.openai.com/v1/chat/completions',
      'https://api.moonshot.cn/v1/chat/completions',
      'https://172.32.0.1/v1/x',
      'https://[2606:4700::1111]/v1',
    ]) {
      expect(checkUpstream(url, strict)).toMatchObject({ ok: true });
    }
  });

  it('allows loopback only when the deployment says so, over http or https', () => {
    for (const url of [
      'http://localhost:11434/v1/chat/completions',
      'http://127.0.0.1:8080/v1/x',
      'http://127.0.0.2/v1/x',
      'http://[::1]:11434/v1',
      'https://my.localhost/v1',
    ]) {
      expect(checkUpstream(url, dev)).toMatchObject({ ok: true });
      expect(checkUpstream(url, strict)).toEqual({ ok: false, reason: 'localhost' });
    }
  });

  it('rejects plain http to anything but loopback', () => {
    expect(checkUpstream('http://api.openai.com/v1', dev)).toEqual({ ok: false, reason: 'scheme' });
    expect(checkUpstream('ftp://files.example.com/x', dev)).toEqual({
      ok: false,
      reason: 'scheme',
    });
    expect(checkUpstream('ws://localhost:1/x', dev)).toEqual({ ok: false, reason: 'scheme' });
  });

  it('rejects credentials in the url and unparsable urls', () => {
    expect(checkUpstream('https://user:pw@api.example.com/v1', dev)).toEqual({
      ok: false,
      reason: 'userinfo',
    });
    expect(checkUpstream('not a url', dev)).toEqual({ ok: false, reason: 'invalid' });
    expect(checkUpstream('', dev)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects private, link-local and unspecified addresses even over https', () => {
    for (const url of [
      'https://10.0.0.5/v1',
      'https://172.16.3.4/v1',
      'https://172.31.255.255/v1',
      'https://192.168.1.1/v1',
      'https://169.254.169.254/latest/meta-data',
      'https://100.64.1.1/v1',
      'https://0.0.0.0/v1',
      'https://[fd00::1]/v1',
      'https://[fe80::1]/v1',
      'https://[::]/v1',
      'https://[::ffff:10.0.0.1]/v1',
      'https://[::ffff:192.168.0.9]/v1',
    ]) {
      expect(checkUpstream(url, dev)).toEqual({ ok: false, reason: 'private' });
    }
  });

  it('treats a mapped loopback as loopback', () => {
    expect(checkUpstream('https://[::ffff:127.0.0.1]/v1', strict)).toEqual({
      ok: false,
      reason: 'localhost',
    });
  });
});

describe('isPrivateAddress', () => {
  it('classifies literal hosts without touching DNS', () => {
    expect(isPrivateAddress('10.1.2.3')).toBe(true);
    expect(isPrivateAddress('localhost')).toBe(true);
    expect(isPrivateAddress('[fc00::1]')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('api.openai.com')).toBe(false);
    expect(isPrivateAddress('[2001:db8::1]')).toBe(false);
  });
});
