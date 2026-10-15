import { describe, expect, it } from 'vitest';
import { dispatch, handledTypes, on } from '../src/net/dispatch';

describe('消息分发', () => {
  it('按 t 分发，多个处理函数都收到，没人管的返回 false', () => {
    const got: string[] = [];
    on('ping', (m) => got.push('a:' + m.t));
    on(['ping', 'pong'], (m) => got.push('b:' + m.t));
    expect(dispatch({ t: 'ping' })).toBe(true);
    expect(dispatch({ t: 'pong' })).toBe(true);
    expect(dispatch({ t: 'nobody' })).toBe(false);
    expect(got).toEqual(['a:ping', 'b:ping', 'b:pong']);
    expect(handledTypes()).toEqual(expect.arrayContaining(['ping', 'pong']));
  });
});
