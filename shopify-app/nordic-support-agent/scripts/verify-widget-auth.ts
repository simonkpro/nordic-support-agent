import 'dotenv/config';
import { signWidgetToken, verifyWidgetToken } from '../app/lib/widget-token.ts';

const SHOP = 'demo-shop.myshopify.com';

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(22)} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

console.log('\n=== widget-token end-to-end test ===\n');

console.log('1. Sign a token for', SHOP);
const token = signWidgetToken(SHOP);
line('token preview:', token.slice(0, 60) + '…');
line('token length:', token.length);

console.log('\n2. Verify the valid token');
const valid = verifyWidgetToken(token);
line('result:', valid);
if (!valid.ok || valid.shop !== SHOP) {
  console.error('  ✗ FAIL: valid token should round-trip');
  process.exit(1);
}
console.log('  ✓ PASS: round-trips with correct shop');

console.log('\n3. Tamper with one character (flip last char)');
const last = token[token.length - 1]!;
const flipped = last === 'A' ? 'B' : 'A';
const tampered = token.slice(0, -1) + flipped;
const verified = verifyWidgetToken(tampered);
line('result:', verified);
if (verified.ok || verified.reason !== 'bad_signature') {
  console.error('  ✗ FAIL: tampered token must be rejected with bad_signature');
  process.exit(1);
}
console.log('  ✓ PASS: tampered token rejected with bad_signature');

console.log('\n4. Malformed token (no dot separator)');
const malformed = verifyWidgetToken('this-is-not-a-jwt');
line('result:', malformed);
if (malformed.ok || malformed.reason !== 'malformed') {
  console.error('  ✗ FAIL: malformed token should report malformed');
  process.exit(1);
}
console.log('  ✓ PASS: malformed rejected');

console.log('\n5. Expired token (issued with -10s TTL)');
const expired = signWidgetToken(SHOP, -10);
const expVerify = verifyWidgetToken(expired);
line('result:', expVerify);
if (expVerify.ok || expVerify.reason !== 'expired') {
  console.error('  ✗ FAIL: expired token should report expired');
  process.exit(1);
}
console.log('  ✓ PASS: expired rejected');

console.log('\n=== all checks passed ===\n');
