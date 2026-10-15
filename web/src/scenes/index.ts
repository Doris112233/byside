/* 场景清单。顺序 = dock 上的顺序 = 数字快捷键 1 2 3… */
import { chat } from './chat';
import { gomoku } from './gomoku';
import { origami } from './origami';
import { register } from './registry';

export function registerScenes(): void {
  register(gomoku);
  register(origami);
  register(chat);
}
