export function log(msg: string): void {
  console.log('[' + new Date().toTimeString().slice(0, 8) + '] ' + msg);
}
