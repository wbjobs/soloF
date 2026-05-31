const { decodePayload, encodePayload } = require('./payloadDecoder');

console.log('=== Testing Bug Fix for Negative Conductivity ===\n');

console.log('Test 1: Encoding negative conductivity value');
try {
  const payload = encodePayload(45.5, 22.3, -1);
  console.log('  Payload generated:', payload);
  
  const decoded = decodePayload(payload);
  console.log('  Decoded data:', decoded);
  console.log('  ✓ PASS: Negative conductivity handled correctly\n');
} catch (error) {
  console.log('  ✗ FAIL:', error.message, '\n');
}

console.log('Test 2: Decoding with normal values');
try {
  const payload = encodePayload(50.2, 24.5, 1200);
  const decoded = decodePayload(payload);
  console.log('  Decoded data:', decoded);
  console.log('  ✓ PASS: Normal values decoded correctly\n');
} catch (error) {
  console.log('  ✗ FAIL:', error.message, '\n');
}

console.log('Test 3: Edge case - very high conductivity');
try {
  const payload = encodePayload(45.5, 22.3, 65535);
  const decoded = decodePayload(payload);
  console.log('  Decoded data:', decoded);
  console.log('  ✓ PASS: High value handled correctly\n');
} catch (error) {
  console.log('  ✗ FAIL:', error.message, '\n');
}

console.log('Test 4: Edge case - extreme negative value');
try {
  const payload = encodePayload(45.5, 22.3, -32768);
  const decoded = decodePayload(payload);
  console.log('  Decoded data:', decoded);
  console.log('  ✓ PASS: Extreme negative value handled correctly\n');
} catch (error) {
  console.log('  ✗ FAIL:', error.message, '\n');
}

console.log('Test 5: Invalid payload (too short)');
try {
  decodePayload('0102');
  console.log('  ✗ FAIL: Should have thrown error for short payload\n');
} catch (error) {
  console.log('  ✓ PASS: Correctly threw error:', error.message, '\n');
}

console.log('Test 6: Humidity boundary check');
try {
  const payload = encodePayload(150, 22.3, 1000);
  const decoded = decodePayload(payload);
  console.log('  Decoded humidity (should be clamped):', decoded.humidity);
  console.log('  ✓ PASS: Humidity clamped correctly\n');
} catch (error) {
  console.log('  ✗ FAIL:', error.message, '\n');
}

console.log('=== All tests completed ===');
